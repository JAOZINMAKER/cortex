'use strict';
// Monta o grafo público (contrato) a partir das leituras de cada fonte.
const path = require('path');
const { sha1, normPath, baseName, dayKey, slug } = require('./util');
const layout = require('./layout');
const classify = require('./classify');

const ORDEM_TIPO = { obsidian: 0, pasta: 1, git: 2, claude: 3 };
const DIA_MS = 86400000;

function idDe(chave) { return sha1(chave).slice(0, 16); }

// parciais: [{ fonte: cfg, r: resultado }]
function montar(parciais, statusFontes) {
  const t0 = Date.now();
  const ps = parciais.filter((p) => p.r).sort((a, b) => ORDEM_TIPO[a.fonte.tipo] - ORDEM_TIPO[b.fonte.tipo]);

  // caminhos de fonte → projeto (para casar sessões do Claude com projetos)
  const caminhosProj = parciais.filter((p) => p.fonte.tipo !== 'claude')
    .map((p) => ({ n: normPath(p.fonte.caminho), projeto: p.fonte.projeto }))
    .sort((a, b) => b.n.length - a.n.length);
  function projetoDoCwd(cwd, bruto) {
    if (cwd) {
      const n = normPath(cwd);
      for (const c of caminhosProj) if (n === c.n || n.startsWith(c.n + '/')) return c.projeto;
    }
    return bruto || 'sem-projeto';
  }
  // nomes de projeto canônicos (mesmo projeto com caixa diferente cai na mesma região)
  const nomeProj = new Map();
  const canon = (p) => { const k = slug(p); if (!nomeProj.has(k)) nomeProj.set(k, p); return k; };

  // datas reais vindas do git (para notas clonadas, cujo mtime é a data do checkout)
  const datasGit = {};
  const historicoArquivos = new Map();
  for (const p of ps) if (p.r.datasArquivos) {
    Object.assign(datasGit, p.r.datasArquivos);
    for (const [k, v] of p.r.historicoArquivos) historicoArquivos.set(k, (historicoArquivos.get(k) || []).concat(v));
  }

  const nos = [];
  const porChave = new Map();
  const alias = new Map();
  const porCaminho = new Map(); // normPath -> chave (prioridade nota > arquivo > doc)
  const prioridade = { nota: 3, arquivo: 2, doc: 1 };

  for (const p of ps) {
    const projetoFonte = p.fonte.projeto;
    // detecção de "checkout em massa": muitas notas com o mesmo mtime
    let janelaCheckout = null;
    if (p.fonte.tipo === 'obsidian' && p.r.nos.length > 20) {
      const ms = p.r.nos.map((n) => n.modificado).sort((a, b) => a - b);
      const med = ms[Math.floor(ms.length / 2)];
      const perto = ms.filter((m) => Math.abs(m - med) < 120000).length;
      if (perto / ms.length > 0.5) janelaCheckout = [med - 120000, med + 120000];
    }
    for (const n0 of p.r.nos) {
      const n = n0;
      if (n.tipo === 'arquivo' || n.tipo === 'doc') {
        const np = normPath(n.caminho);
        const ja = porCaminho.get(np);
        if (ja) { alias.set(n.chave, ja); continue; }
      }
      if (porChave.has(n.chave)) continue;
      const projeto = n.tipo === 'sessao' ? projetoDoCwd(n.cwd, n.projetoBruto) : projetoFonte;
      n.projeto = canon(projeto);
      if (n.tipo === 'nota') {
        const g = datasGit[normPath(n.caminho)];
        if (g) {
          if (n.datasDoArquivo) n.criado = g.first;
          const noCheckout = janelaCheckout && n.modificado >= janelaCheckout[0] && n.modificado <= janelaCheckout[1];
          n.modificado = noCheckout ? g.last : Math.max(g.last, n.modificado);
        }
        if (n.criado > n.modificado) n.criado = n.modificado;
      }
      porChave.set(n.chave, nos.length);
      nos.push(n);
      if (n.caminho && prioridade[n.tipo]) {
        const np = normPath(n.caminho);
        const ja = porCaminho.get(np);
        if (!ja || prioridade[nos[porChave.get(ja)].tipo] < prioridade[n.tipo]) porCaminho.set(np, n.chave);
      }
    }
  }

  // regiões + correções do usuário
  const correcoes = classify.todasCorrecoes();
  for (const n of nos) {
    n.id = idDe(n.chave);
    n.idCurto = sha1(n.chave).slice(0, 6);
    let reg = 'r_' + n.projeto;
    const c = correcoes[n.id];
    if (c && c.regiao) reg = c.regiao.startsWith('r_') ? c.regiao : 'r_' + canon(c.regiao);
    n.regiao = reg;
  }

  // nós de dia (espinha)
  const contDia = new Map();
  for (const n of nos) {
    if (n.tipo === 'arquivo' || n.tipo === 'branch' || n.tipo === 'worktree') continue;
    const k = dayKey(n.criado);
    contDia.set(k, (contDia.get(k) || 0) + 1);
    n._dia = k;
  }
  const dias = [...contDia.keys()].sort();
  const idxDia = new Map();
  for (const d of dias) {
    const ini = new Date(d + 'T00:00:00').getTime();
    const chave = 'dia:' + d;
    const n = { chave, id: idDe(chave), idCurto: sha1(chave).slice(0, 6), tipo: 'dia', fonte: 'sistema', titulo: d, regiao: 'r_tronco', subregiao: 'ESPINHA',
      criado: ini, modificado: ini + DIA_MS - 1, palavras: contDia.get(d), autor: 'SISTEMA', hash: sha1(chave).slice(0, 12), caminho: null, texto: '', extra: {} };
    idxDia.set(d, nos.length);
    porChave.set(chave, nos.length);
    nos.push(n);
  }
  nomeProj.set('tronco', 'TRONCO // TEMPO');

  // ordem estável por id
  // (os índices de sinapse referem-se a esta ordem final)
  const ordemFinal = nos.map((_, i) => i).sort((a, b) => (nos[a].id < nos[b].id ? -1 : nos[a].id > nos[b].id ? 1 : 0));
  const novoIdx = new Array(nos.length);
  ordemFinal.forEach((velho, novo) => { novoIdx[velho] = novo; });
  const nosOrd = ordemFinal.map((i) => nos[i]);
  const idxDe = (chave) => {
    let k = chave;
    for (let g = 0; g < 3 && alias.has(k); g++) k = alias.get(k);
    const i = porChave.get(k);
    return i === undefined ? -1 : novoIdx[i];
  };

  // sinapses
  const sinapses = [];
  const vistos = new Set();
  function add(a, b, tipo, peso) {
    if (a < 0 || b < 0 || a === b) return;
    const k = a * 4194304 + b + ':' + tipo;
    if (vistos.has(k)) return;
    vistos.add(k);
    sinapses.push({ a, b, tipo, peso: Math.round(peso * 100) / 100 });
  }
  for (const p of ps) {
    for (const l of p.r.links) {
      const a = idxDe(l.de);
      let b;
      if (typeof l.para === 'string') b = idxDe(l.para);
      else {
        const ch = porCaminho.get(normPath(l.para.caminho));
        b = ch ? idxDe(ch) : -1;
      }
      add(a, b, l.tipo, l.peso);
    }
  }
  // SEQ entre sessões consecutivas do mesmo projeto
  const sessPorProj = new Map();
  nosOrd.forEach((n, i) => { if (n.tipo === 'sessao') { if (!sessPorProj.has(n.regiao)) sessPorProj.set(n.regiao, []); sessPorProj.get(n.regiao).push(i); } });
  for (const lista of sessPorProj.values()) {
    lista.sort((a, b) => nosOrd[a].criado - nosOrd[b].criado);
    for (let i = 1; i < lista.length; i++) add(lista[i - 1], lista[i], 'SEQ', 0.5);
  }
  // DIA + coluna da espinha
  nosOrd.forEach((n, i) => { if (n._dia) { add(i, novoIdx[idxDia.get(n._dia)], 'DIA', 0.1); delete n._dia; } });
  for (let i = 1; i < dias.length; i++) add(novoIdx[idxDia.get(dias[i - 1])], novoIdx[idxDia.get(dias[i])], 'SEQ', 0.3);

  // grau, órfãos, adjacência
  const N = nosOrd.length;
  const grau = new Int32Array(N);
  const grauReal = new Int32Array(N);
  const adj = Array.from({ length: N }, () => []);
  for (let e = 0; e < sinapses.length; e++) {
    const s = sinapses[e];
    grau[s.a]++; grau[s.b]++;
    if (s.tipo !== 'DIA') {
      grauReal[s.a]++; grauReal[s.b]++;
      if (!(s.tipo === 'SEQ' && nosOrd[s.a].tipo === 'dia')) { adj[s.a].push(s.b, s.peso); adj[s.b].push(s.a, s.peso); }
    }
  }

  // comunidades por propagação de rótulos (determinística)
  const rot = new Int32Array(N);
  for (let i = 0; i < N; i++) rot[i] = i;
  for (let it = 0; it < 12; it++) {
    let mudou = 0;
    for (let i = 0; i < N; i++) {
      const a = adj[i];
      if (!a.length) continue;
      const cont = new Map();
      for (let j = 0; j < a.length; j += 2) cont.set(rot[a[j]], (cont.get(rot[a[j]]) || 0) + a[j + 1]);
      let melhor = rot[i], mv = -1;
      for (const [r, v] of cont) if (v > mv + 1e-9 || (Math.abs(v - mv) < 1e-9 && r < melhor)) { melhor = r; mv = v; }
      if (melhor !== rot[i]) { rot[i] = melhor; mudou++; }
    }
    if (!mudou) break;
  }
  const tam = new Map();
  for (let i = 0; i < N; i++) if (adj[i].length) tam.set(rot[i], (tam.get(rot[i]) || 0) + 1);
  const renum = new Map([...tam.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([r], i) => [r, i]));

  for (let i = 0; i < N; i++) {
    const n = nosOrd[i];
    n.grau = grau[i];
    n.orfao = (n.tipo === 'nota' || n.tipo === 'doc' || n.tipo === 'arquivo') && grauReal[i] === 0;
    n.cluster = adj[i].length ? renum.get(rot[i]) : -1;
  }

  // organização automática (tags da máquina)
  classify.classificar(nosOrd);

  // layout
  const regIds = [...new Set(nosOrd.map((n) => n.regiao))];
  const info = layout.calcular(nosOrd, regIds);

  // regiões
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const inicio7 = hoje.getTime() - 6 * DIA_MS;
  const regioes = new Map();
  regIds.sort((a, b) => (a === 'r_tronco') - (b === 'r_tronco') || (a < b ? -1 : 1)).forEach((id, i) => {
    const inf = info.get(id) || { centro: [0, 0, 0], hemisferio: 'D' };
    const nomeBase = nomeProj.get(id.slice(2)) || id.slice(2);
    regioes.set(id, { id, nome: String(nomeBase).toUpperCase(), serial: 'RG-' + String(i + 1).padStart(4, '0'), hemisferio: inf.hemisferio,
      centro: inf.centro, neuronios: 0, sinapses: 0, ultimoPulso: 0, atividade7d: [0, 0, 0, 0, 0, 0, 0], _subs: new Map() });
  });
  function marcar(r, t) {
    if (t >= inicio7) { const d = Math.floor((t - inicio7) / DIA_MS); if (d >= 0 && d < 7) r.atividade7d[d]++; }
  }
  for (const n of nosOrd) {
    const r = regioes.get(n.regiao);
    r.neuronios++;
    r._subs.set(n.subregiao, (r._subs.get(n.subregiao) || 0) + 1);
    if (n.tipo !== 'dia') {
      if (n.modificado > r.ultimoPulso) r.ultimoPulso = n.modificado;
      marcar(r, n.criado);
      if (dayKey(n.modificado) !== dayKey(n.criado)) marcar(r, n.modificado);
    }
  }
  for (const s of sinapses) {
    const ra = regioes.get(nosOrd[s.a].regiao), rb = regioes.get(nosOrd[s.b].regiao);
    ra.sinapses++;
    if (rb !== ra) rb.sinapses++;
  }
  // tool_use das sessões contam como atividade
  const eventosHist = [];
  for (const p of ps) {
    for (const e of p.r.eventos) {
      const i = e.chave ? idxDe(e.chave) : -1;
      const n = i >= 0 ? nosOrd[i] : null;
      if (n && e.fonte === 'claude') marcar(regioes.get(n.regiao), e.t);
      eventosHist.push({ t: e.t, nivel: 'HIST', fonte: e.fonte, msg: e.msg, id: n ? n.id : undefined, hash: e.hash, arquivo: e.arquivo });
    }
  }
  eventosHist.sort((a, b) => a.t - b.t);

  const regioesArr = [...regioes.values()].map((r) => {
    const subregioes = [...r._subs.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ id: r.id + '/' + slug(nome), nome, n }));
    delete r._subs;
    return { ...r, subregioes };
  });

  // contadores
  const cont = { notas: 0, commits: 0, linhas: 0, sessoes: 0, horasIA: 0, neuronios: N, sinapses: sinapses.length, arquivos: 0, regioes: regioesArr.length, ferramentas: 0 };
  for (const n of nosOrd) {
    if (n.tipo === 'nota') cont.notas++;
    else if (n.tipo === 'commit') { cont.commits++; cont.linhas += n.palavras; }
    else if (n.tipo === 'sessao') { cont.sessoes++; cont.horasIA += n.extra.duracaoMs || 0; cont.ferramentas += n.extra.totalFerramentas || 0; }
    else if (n.tipo === 'arquivo' || n.tipo === 'doc') cont.arquivos++;
  }
  cont.horasIA = Math.round(cont.horasIA / 360000) / 10;

  const CAMPOS = ['id', 'idCurto', 'tipo', 'fonte', 'titulo', 'regiao', 'subregiao', 'pos', 'criado', 'modificado', 'palavras', 'grau', 'autor', 'hash', 'caminho', 'tags', 'cluster', 'orfao'];
  const publicos = nosOrd.map((n) => { const o = {}; for (const c of CAMPOS) o[c] = n[c] === undefined ? null : n[c]; o.criado = Math.round(o.criado || 0); o.modificado = Math.round(o.modificado || 0); return o; });

  const porId = new Map();
  nosOrd.forEach((n, i) => porId.set(n.id, i));

  return {
    publico: { versao: 0, geradoEm: Date.now(), regioes: regioesArr, nos: publicos, sinapses, dias, contadores: cont, fontes: statusFontes },
    interno: { nos: nosOrd, porId, adj, historicoArquivos, eventosHist, msBuild: Date.now() - t0 },
  };
}

module.exports = { montar, idDe };
