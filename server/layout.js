'use strict';
// Layout anatômico do cérebro. Determinístico: mesma entrada → mesmas posições.
// Eixo Y para cima, +Z = frente. ~1000 de largura (X), ~820 de profundidade (Z), ~650 de altura (Y).
const { prng } = require('./util');

const HEMI = { cx: 262, cy: 110, rx: 248, ryTopo: 300, ryBase: 205, rz: 410 };
const CEREBELO = { cx: 0, cy: -175, cz: -285, rx: 235, ry: 105, rz: 135 };
const TRONCO = { topo: -40, base: -430, zTopo: -40, zBase: -120, rTopo: 58, rBase: 34 };
const ESPINHA = { topo: -430, base: -920, r: 24 };
const ALFA_MIN = -0.5, ALFA_MAX = 2.45; // do lado medial-topo até a base lateral (lobo temporal)

function giros(u, a, s) {
  return 1
    + 0.038 * Math.sin(u * 41 + a * 7.3 + s * 1.7) * Math.cos(a * 11.2 - u * 23)
    + 0.022 * Math.sin(u * 97 + a * 29 + s)
    + 0.012 * Math.cos(u * 173 - a * 53);
}

// ponto no córtex: s=±1 (hemisfério), u∈[0,1] frente→trás, a=ângulo a partir do topo, prof∈[0,1)
function pontoCortex(s, u, a, prof) {
  const uu = 0.03 + u * 0.94;
  const zN = 1 - 2 * uu; // +1 frente, -1 trás
  const k = Math.max(0.16, Math.sqrt(1 - zN * zN));
  const z = HEMI.rz * zN;
  const ry = Math.cos(a) >= 0 ? HEMI.ryTopo : HEMI.ryBase;
  // lobo temporal: bojo lateral-baixo no terço frontal-médio
  const temporal = a > 1.6 ? 1 + 0.12 * Math.exp(-Math.pow((zN - 0.15) / 0.35, 2)) : 1;
  const cy = HEMI.cy + 35 * zN - (a > 1.9 ? 40 * Math.exp(-Math.pow((zN - 0.1) / 0.4, 2)) : 0);
  const g = giros(uu, a, s) * (1 - prof);
  const x = s * HEMI.cx + s * HEMI.rx * k * Math.sin(a) * g * temporal;
  const y = cy + ry * k * Math.cos(a) * g;
  return [x, y, z * (0.9 + 0.1 * g)];
}

function pontoCerebelo(v, phi, prof) {
  const xN = 2 * v - 1;
  const k = Math.max(0.2, Math.sqrt(1 - xN * xN * 0.92));
  const folia = 1 + 0.06 * Math.sin(phi * 26 + v * 3) + 0.02 * Math.sin(phi * 61);
  const f = folia * (1 - prof);
  // fissura do verme entre os dois lobos
  const xs = CEREBELO.rx * xN * 0.97 + Math.sign(xN || 1) * 8;
  return [xs, CEREBELO.cy + CEREBELO.ry * k * Math.cos(phi) * f, CEREBELO.cz + CEREBELO.rz * k * Math.sin(phi) * f * -1];
}

function pontoEspinha(t, r01, ang) {
  // t=0 base da espinha (mais antigo), t=1 topo do tronco (hoje)
  const yTot = TRONCO.topo - ESPINHA.base;
  const y = ESPINHA.base + t * yTot;
  let raio, zc;
  if (y >= TRONCO.base) {
    const q = (y - TRONCO.base) / (TRONCO.topo - TRONCO.base);
    raio = TRONCO.rBase + (TRONCO.rTopo - TRONCO.rBase) * q;
    zc = TRONCO.zBase + (TRONCO.zTopo - TRONCO.zBase) * q;
  } else {
    const q = (y - ESPINHA.base) / (ESPINHA.topo - ESPINHA.base);
    raio = ESPINHA.r;
    zc = TRONCO.zBase - 45 * Math.sin(q * Math.PI) - 20 * (1 - q);
  }
  const rr = raio * (0.35 + 0.65 * r01);
  return [Math.cos(ang) * rr, y, zc + Math.sin(ang) * rr];
}

// global t∈[0,1): metade direita frente→trás, metade esquerda trás→frente
function tParaHemi(t) {
  if (t < 0.5) return { s: 1, u: t / 0.5 };
  return { s: -1, u: 1 - (t - 0.5) / 0.5 };
}

// nos: [{id, regiao, subregiao, tipo, criado}] — escreve n.pos
// regioes: Map id -> {id, nome}
// retorna Map regiaoId -> {centro, hemisferio}
function calcular(nos, regioesIds) {
  const cortex = new Map(); // regiao -> nós de córtex
  const cereb = new Map(); // regiao -> nós de arquivo
  const dias = [];
  for (const n of nos) {
    if (n.tipo === 'dia') { dias.push(n); continue; }
    const alvo = n.tipo === 'arquivo' ? cereb : cortex;
    if (!alvo.has(n.regiao)) alvo.set(n.regiao, []);
    alvo.get(n.regiao).push(n);
  }
  const info = new Map();

  // ordem: maiores primeiro (desempate por id) → setores contíguos
  const ordem = (m) => [...m.keys()].sort((a, b) => (m.get(b).length - m.get(a).length) || (a < b ? -1 : 1));
  // setor ∝ n^0.7, com piso de 7% do total para projetos pequenos continuarem visíveis
  const pesos = (m) => {
    const w = new Map([...m.entries()].map(([k, v]) => [k, Math.pow(v.length, 0.7)]));
    const soma = [...w.values()].reduce((a, b) => a + b, 0);
    for (const [k, v] of w) w.set(k, Math.max(v, soma * 0.07));
    return w;
  };

  // córtex
  const regsC = ordem(cortex);
  const wC = pesos(cortex);
  const totC = regsC.reduce((s, r) => s + wC.get(r), 0) || 1;
  let acc = 0;
  let ordemReg = 0;
  for (const r of regsC) {
    const lista = cortex.get(r);
    const t0 = acc / totC;
    acc += wC.get(r);
    const t1 = acc / totC;
    const margem = Math.min(0.004, (t1 - t0) * 0.08);
    // subregiões em subsetores
    const subs = new Map();
    for (const n of lista) { if (!subs.has(n.subregiao)) subs.set(n.subregiao, []); subs.get(n.subregiao).push(n); }
    const subOrd = [...subs.keys()].sort((a, b) => (subs.get(b).length - subs.get(a).length) || (a < b ? -1 : 1));
    const totS = lista.length;
    // ranking por idade dentro da região (antigo = fundo)
    const porIdade = lista.slice().sort((a, b) => (a.criado - b.criado) || (a.id < b.id ? -1 : 1));
    const rank = new Map();
    porIdade.forEach((n, i) => rank.set(n.id, porIdade.length > 1 ? i / (porIdade.length - 1) : 1));
    let accS = 0;
    for (const sNome of subOrd) {
      const sl = subs.get(sNome);
      const a0 = t0 + margem + (t1 - t0 - 2 * margem) * (accS / totS);
      accS += sl.length;
      const a1 = t0 + margem + (t1 - t0 - 2 * margem) * (accS / totS);
      for (const n of sl) {
        const rnd = prng(n.id);
        const t = a0 + (a1 - a0) * rnd();
        const { s, u } = tParaHemi(Math.min(0.9999, Math.max(0, t)));
        const alfa = ALFA_MIN + (ALFA_MAX - ALFA_MIN) * Math.pow(rnd(), 0.92);
        const idade = 1 - rank.get(n.id);
        let prof = 0.02 + 0.17 * Math.pow(idade, 0.85) + 0.015 * rnd(); // superfície: giros legíveis
        if (n.tipo === 'branch' || n.tipo === 'worktree') prof = 0.55 + 0.08 * rnd(); // "tálamo"
        n.pos = pontoCortex(s, u, alfa, prof).map((v) => Math.round(v * 10) / 10);
      }
    }
    const tm = (t0 + t1) / 2;
    const { s, u } = tParaHemi(tm);
    const c = pontoCortex(s, u, [0.45, 0.95, 0.2][ordemReg++ % 3], -0.22);
    info.set(r, { centro: c.map(Math.round), hemisferio: s > 0 ? 'D' : 'E', t0, t1 });
  }

  // cerebelo (arquivos dos repositórios)
  const regsB = ordem(cereb);
  const wB = pesos(cereb);
  const totB = regsB.reduce((s, r) => s + wB.get(r), 0) || 1;
  acc = 0;
  for (const r of regsB) {
    const lista = cereb.get(r);
    const v0 = acc / totB; acc += wB.get(r); const v1 = acc / totB;
    const porIdade = lista.slice().sort((a, b) => (a.criado - b.criado) || (a.id < b.id ? -1 : 1));
    porIdade.forEach((n, i) => {
      const rnd = prng(n.id);
      const v = v0 + (v1 - v0) * (0.05 + 0.9 * rnd());
      const phi = -0.35 * Math.PI + rnd() * 1.55 * Math.PI;
      const idade = porIdade.length > 1 ? 1 - i / (porIdade.length - 1) : 0;
      const prof = 0.03 + 0.22 * Math.pow(idade, 0.9) + 0.02 * rnd();
      n.pos = pontoCerebelo(v, phi, prof).map((x) => Math.round(x * 10) / 10);
    });
    if (!info.has(r)) {
      const c = pontoCerebelo((v0 + v1) / 2, 0.2 * Math.PI, -0.35);
      info.set(r, { centro: c.map(Math.round), hemisferio: c[0] >= 0 ? 'D' : 'E', t0: 0, t1: 0 });
    }
  }

  // espinha: dias em ordem cronológica
  dias.sort((a, b) => a.criado - b.criado);
  dias.forEach((n, i) => {
    const rnd = prng(n.id);
    const t = dias.length > 1 ? i / (dias.length - 1) : 1;
    n.pos = pontoEspinha(t, rnd(), i * 2.399963 + rnd() * 0.4).map((x) => Math.round(x * 10) / 10);
  });
  info.set('r_tronco', { centro: [150, -560, -150], hemisferio: 'TRONCO', t0: 0, t1: 0 });

  for (const id of regioesIds) if (!info.has(id)) info.set(id, { centro: [0, 520, 0], hemisferio: 'D', t0: 0, t1: 0 });
  return info;
}

module.exports = { calcular, pontoCortex, pontoCerebelo, pontoEspinha, HEMI, CEREBELO, TRONCO, ESPINHA };
