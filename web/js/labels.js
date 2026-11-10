// Rótulos densos por nível de zoom: regiões, neurônios, sinapses e anel de metadados.
import { esc, fmtData, fmtDataHora, fmtN, fmtRel, spark, FONTE_ROT, TIPO_ROT } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const MAX_NR = 180, MAX_SL = 44;

export class Rotulos {
  constructor(cerebro, raiz, svg) {
    this.c = cerebro; this.raiz = raiz; this.svg = svg;
    this.rg = new Map(); this.nr = []; this.sl = []; this.atual = new Int32Array(MAX_NR).fill(-1);
    for (let i = 0; i < MAX_NR; i++) { const e = document.createElement('div'); e.className = 'nr'; e.style.display = 'none'; raiz.appendChild(e); this.nr.push(e); }
    for (let i = 0; i < MAX_SL; i++) { const e = document.createElement('div'); e.className = 'sl'; e.style.display = 'none'; raiz.appendChild(e); this.sl.push(e); }
    this.quadros = 0; this.nivel = 'CÉREBRO'; this.areaSegura = { l: 320, r: 300, t: 100, b: 66 };
    this.detalhe = null; this.anelId = null;
  }
  setGrafo(g) {
    for (const [, e] of this.rg) e.remove(); this.rg.clear();
    for (const r of g.regioes) {
      const e = document.createElement('div'); e.className = 'rg';
      e.innerHTML = `<div class="mira"></div><div class="haste"></div><div class="cx"><div class="nm"></div><div class="ln"></div></div>`;
      this.raiz.prepend(e); this.rg.set(r.id, { e, r, nm: e.querySelector('.nm'), ln: e.querySelector('.ln'), chave: '' });
    }
    // subregiões: centros calculados aqui a partir das posições reais
    for (const e of this.subEls || []) e.e.remove(); this.subEls = [];
    const acc = new Map(); g.nos.forEach(n => { if (n.tipo === 'dia') return; const k = n.regiao + '|' + (n.subregiao || ''); let a = acc.get(k); if (!a) acc.set(k, a = { r: n.regiao, s: n.subregiao || '—', n: 0, x: 0, y: 0, z: 0, ult: 0, cri: Infinity }); a.n++; a.x += n.pos[0]; a.y += n.pos[1]; a.z += n.pos[2]; a.ult = Math.max(a.ult, n.modificado || 0); a.cri = Math.min(a.cri, n.criado || Infinity); });
    const subs = [...acc.values()].filter(a => a.n >= 3).sort((a, b) => b.n - a.n).slice(0, 90);
    for (const a of subs) { const e = document.createElement('div'); e.className = 'rg sub'; e.innerHTML = `<div class="mira"></div><div class="cx"><div class="nm">${esc(String(a.s).split('/').pop().toUpperCase().slice(0, 22))}<span>${fmtN(a.n)}</span></div></div>`; e.style.display = 'none'; this.raiz.prepend(e); this.subEls.push({ e, centro: [a.x / a.n, a.y / a.n, a.z / a.n], a, cri: a.cri }); }
    this.atual.fill(-1); this.anelId = null;
  }
  // largura real de um caractere da fonte dos rótulos (9px), medida uma vez no DOM
  _medir() {
    if (this.cw && this._cwOk) return this.cw;
    const e = document.createElement('div'); e.className = 'nr'; e.style.visibility = 'hidden'; e.innerHTML = '<span class="c">' + 'M'.repeat(40) + '</span>'; this.raiz.appendChild(e);
    const w = e.firstChild.getBoundingClientRect().width; e.remove(); this.cw = w > 0 ? (w - 6) / 40 : 5.6; this._cwOk = document.fonts ? document.fonts.status === 'loaded' : true; return this.cw;
  }
  // ------------------------------------------------------------
  atualizar(forcar) {
    const c = this.c, g = c.g; if (!g) return; this.quadros++;
    const mudou = c.mudouQuadro || forcar || this.quadros % 20 === 0; if (!mudou) { this._anelPos(); return; }
    if (!c.mudouQuadro) c.projetar();
    const W = c.w, H = c.h, A = this.areaSegura; const d = c.dist(), d0 = c.distInicial || 2500;
    const z = d / d0; this.nivel = c.foco >= 0 && d < 700 ? 'NEURÔNIO' : z < 0.6 ? 'REGIÃO' : 'CÉREBRO';
    // grade de ocupação (células 6x6 px)
    const CW = 6, cols = Math.ceil(W / CW), rows = Math.ceil(H / CW); const occ = new Uint8Array(cols * rows);
    const livre = (x, y, w, h) => { const x0 = Math.max(0, (x / CW) | 0), y0 = Math.max(0, (y / CW) | 0), x1 = Math.min(cols - 1, ((x + w) / CW) | 0), y1 = Math.min(rows - 1, ((y + h) / CW) | 0); for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (occ[yy * cols + xx]) return false; return true; };
    const marca = (x, y, w, h) => { const x0 = Math.max(0, (x / CW) | 0), y0 = Math.max(0, (y / CW) | 0), x1 = Math.min(cols - 1, ((x + w) / CW) | 0), y1 = Math.min(rows - 1, ((y + h) / CW) | 0); for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) occ[yy * cols + xx] = 1; };
    const pa = document.body.classList.contains('painel-aberto'); A.r = pa ? 566 : 300;
    marca(0, 0, A.l, H); marca(W - A.r, 0, A.r, H); marca(0, 0, W, A.t); marca(0, H - A.b - 4, W, A.b + 4);
    marca(A.l, H - A.b - 52, 640, 52); marca(W - A.r - 400, H - A.b - 56, 400, 56);
    const dentro = (x, y) => x > A.l + 6 && x < W - A.r - 6 && y > A.t + 6 && y < H - A.b - 6;
    if (this.anelAtivo) { const p = this._focoXY(); if (p) { marca(p[0] - 210, p[1] - 165, 420, 385); marca(p[0] - 340, p[1] - 115, 680, 190); } }
    // regiões ------------------------------------------------
    this._vivas = null; if (c.tempo < 1e8) { this._vivas = new Set(); for (let i = 0; i < g.nos.length; i++) if (c.sz[i] >= 0) this._vivas.add(g.nos[i].regiao); }
    const regs = [...this.rg.values()].map(o => { const p = c.proj3(o.r.centro); return { o, p }; }).sort((a, b) => b.o.r.neuronios - a.o.r.neuronios);
    let cheias = 0; const limiteCheias = this.nivel === 'CÉREBRO' ? 14 : 6;
    for (const { o, p } of regs) {
      if (!p || !dentro(p[0], p[1]) || (c.tempo < 1e8 && !this._regViva(o.r))) { o.e.style.display = 'none'; continue; }
      const cheio = cheias < limiteCheias && this.nivel !== 'NEURÔNIO';
      const chave = (cheio ? 'C' : 'c') + o.r.neuronios + o.r.sinapses + o.r.ultimoPulso + (this.quadros / 60 | 0);
      if (chave !== o.chave) {
        o.chave = chave; o.e.classList.toggle('compacto', !cheio);
        o.nm.innerHTML = `${esc(o.r.nome)}<span>${esc(o.r.serial)}·${o.r.hemisferio}</span>`;
        o.ln.innerHTML = cheio ? `<span>N ${fmtN(o.r.neuronios)}</span><span>S ${fmtN(o.r.sinapses)}</span><span>Δ ${fmtRel(o.r.ultimoPulso)}</span>${spark(o.r.atividade7d || [], 49, 11)}` : '';
        const cx = o.e.querySelector('.cx'); const vis = o.e.style.display; o.e.style.display = ''; o.bw = cx.offsetWidth + 2; o.bh = cx.offsetHeight + 2; o.e.style.display = vis;
      }
      const w = o.bw || (cheio ? 236 : 130), h = o.bh || (cheio ? 40 : 16); const x0 = cheio ? 31 : 19;
      let ok = false;
      for (const [dx, dy] of [[0, -h / 2], [0, -h - 10], [0, 10], [-w - x0 - 12, -h / 2]]) { const bx = p[0] + x0 + dx, by = p[1] + dy; if (!livre(bx, by, w, h)) continue; marca(bx, by, w, h); marca(p[0] - 6, p[1] - 6, x0 + 6, 12); o.dy = dy; o.dx = dx; ok = true; break; }
      if (!ok) { o.e.style.display = 'none'; continue; }
      if (cheio) cheias++;
      o.e.style.display = '';
      o.e.querySelector('.cx').style.transform = `translate(${o.dx}px, ${o.dy - (cheio ? -12 : -8)}px)`;
      o.e.style.transform = `translate3d(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px, 0)`;
    }
    // subregiões ---------------------------------------------
    const cw = this._medir(); let nsub = 0;
    for (const o of this.subEls || []) {
      const p = this.nivel === 'NEURÔNIO' ? null : c.proj3(o.centro);
      if (!p || !dentro(p[0], p[1]) || nsub >= 60 || (c.tempo < 1e8 && (o.cri - c.t0) / 864e5 > c.tempo)) { if (o.e.style.display !== 'none') o.e.style.display = 'none'; continue; }
      const w = 12 + o.e.textContent.length * cw * 1.05; if (!livre(p[0] - 3, p[1] - 7, w, 13)) { if (o.e.style.display !== 'none') o.e.style.display = 'none'; continue; }
      marca(p[0] - 3, p[1] - 7, w, 13); o.e.style.display = ''; o.e.style.transform = `translate3d(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px, 0)`; nsub++;
    }
    this.nSub = nsub;
    // neurônios ----------------------------------------------
    let usados = 0; const escolhidos = [];
    if (this.nivel !== 'CÉREBRO') {
      const N = g.nos.length, sx = c.sx, sy = c.sy, sz = c.sz; const cand = [];
      const vizF = new Map(); if (c.foco >= 0) for (const [v, k] of c.vizinhos(c.foco)) vizF.set(v, g.sinapses[k].peso || 0.1);
      const soViz = this.nivel === 'NEURÔNIO';
      for (let i = 0; i < N; i++) { const w = sz[i]; if (w < 0 || !dentro(sx[i], sy[i]) || i === c.foco) continue; const n = g.nos[i]; const vf = vizF.get(i); if (soViz && vf == null && (i % 5)) continue; cand.push([(Math.sqrt(n.grau || 0) + 1.5) / w + (vf != null ? 1e3 + vf * 100 : 0), i]); }
      cand.sort((a, b) => b[0] - a[0]);
      const maxCheio = this.nivel === 'NEURÔNIO' ? 36 : 48, maxTotal = this.nivel === 'NEURÔNIO' ? 110 : MAX_NR; let cheios = 0;
      for (let k = 0; k < cand.length && usados < maxTotal; k++) {
        const i = cand[k][1]; const n = g.nos[i]; const x = sx[i], y = sy[i];
        if (!livre(x - 3, y - 3, 6, 6)) continue; // o próprio marcador precisa de espaço
        const meta = `${fmtData(n.criado)} · ${fmtN(n.palavras)}${n.tipo === 'commit' ? 'L' : 'P'} · G${n.grau} · ${FONTE_ROT[n.fonte] || ''}`;
        const tL = n.titulo.length > 42 ? n.titulo.slice(0, 41) + '…' : n.titulo, tC = n.titulo.length > 20 ? n.titulo.slice(0, 19) + '…' : n.titulo;
        const camadas = [cheios < maxCheio ? 0 : -1, 1, 2].filter(v => v >= 0); let nivel = -1, w = 0;
        for (const v of camadas) { const txt = v === 0 ? `${n.idCurto} ${tL} ${meta}` : v === 1 ? `${n.idCurto} ${tC}` : n.idCurto; w = Math.ceil(txt.length * cw + 8); if (livre(x - 3, y - 6, w + 6, 12)) { nivel = v; break; } }
        if (nivel < 0) continue; marca(x - 3, y - 6, w + 6, 12); if (nivel === 0) cheios++;
        const e = this.nr[usados]; const chave = i * 4 + nivel;
        if (this.atual[usados] !== chave) {
          this.atual[usados] = chave;
          e.className = 'nr f-' + n.fonte + (nivel === 0 ? '' : nivel === 1 ? ' peq' : ' peq marc');
          e.innerHTML = nivel === 0 ? `<span class="c"><b>${n.idCurto}</b> ${esc(tL)} <i>${meta}</i></span>` : nivel === 1 ? `<span class="c"><b>${n.idCurto}</b> ${esc(tC)}</span>` : `<span class="c"><b>${n.idCurto}</b></span>`;
          e.firstChild.style.maxWidth = w + 'px';
        }
        e.style.display = ''; e.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        escolhidos.push(i); usados++;
      }
    }
    for (let k = usados; k < MAX_NR; k++) if (this.atual[k] !== -1 || this.nr[k].style.display !== 'none') { this.nr[k].style.display = 'none'; this.atual[k] = -1; }
    // sinapses rotuladas entre neurônios rotulados ----------
    let ns = 0;
    if (escolhidos.length) {
      const set = new Set(escolhidos); const vistos = new Set(); const lista = [];
      for (const i of escolhidos.slice(0, 90)) for (const [v, k] of c.vizinhos(i)) { if (c.sz[v] < 0 || vistos.has(k) || !dentro(c.sx[v], c.sy[v])) continue; vistos.add(k); lista.push(k); }
      lista.sort((a, b) => (set.has(g.sinapses[b].a) && set.has(g.sinapses[b].b)) - (set.has(g.sinapses[a].a) && set.has(g.sinapses[a].b)));
      for (const k of lista) { if (ns >= MAX_SL) break; const s = g.sinapses[k]; const x = (c.sx[s.a] + c.sx[s.b]) / 2, y = (c.sy[s.a] + c.sy[s.b]) / 2; const dx = c.sx[s.a] - c.sx[s.b], dy = c.sy[s.a] - c.sy[s.b]; if (dx * dx + dy * dy < 2500) continue; const txt = `${s.tipo} ${(s.peso ?? 0).toFixed(2)}`; const w = Math.ceil(txt.length * cw * 0.84 + 7); if (!livre(x - w / 2, y - 6, w, 12)) continue; marca(x - w / 2, y - 6, w, 12);
        const e = this.sl[ns]; if (e.textContent !== txt) e.textContent = txt; e.style.display = ''; e.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - 5).toFixed(1)}px, 0)`; ns++; }
    }
    for (let k = ns; k < MAX_SL; k++) this.sl[k].style.display = 'none';
    this.nRotulos = usados; this.nSin = ns;
    this._anelPos();
  }
  _regViva(r) { return !this._vivas || this._vivas.has(r.id); }
  _focoXY() { const c = this.c; if (c.foco < 0 || !c.sx) return null; if (c.sz[c.foco] < 0) return null; return [c.sx[c.foco], c.sy[c.foco]]; }
  // ------------------------------------------------------------ anel
  setDetalhe(d) { this.detalhe = d; this.anelId = null; }
  _anelPos() {
    const c = this.c; const g = c.g; const f = c.foco; const svg = this.svg;
    if (f < 0 || !g) { if (this.anelAtivo) { svg.innerHTML = ''; this.anelAtivo = false; this.anelId = null; } return; }
    const n = g.nos[f]; const p = this._focoXY();
    if (!p) { svg.style.display = 'none'; return; } svg.style.display = '';
    if (this.anelId !== n.id + (this.detalhe ? 'd' : '')) this._anelMontar(n);
    const LV = this._livre(); const cr = this.clipR; cr.setAttribute("x", LV.l); cr.setAttribute("y", LV.t); cr.setAttribute("width", LV.r - LV.l); cr.setAttribute("height", LV.b - LV.t);
    this.anelG.setAttribute('transform', `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`);
    this.anelG.querySelector('.giro').setAttribute('transform', `rotate(${(c.relogio * 6) % 360})`);
    // linhas até os vizinhos
    const viz = this.vizAnel || []; const L = this.linhasViz;
    viz.forEach((v, k) => { const ln = L[k]; if (!ln) return; const i = v.i; if (c.sz[i] < 0) { ln.l.setAttribute('opacity', 0); ln.t.setAttribute('opacity', 0); return; }
      const x = c.sx[i] - p[0], y = c.sy[i] - p[1]; const d = Math.hypot(x, y); if (d < 128) { ln.l.setAttribute('opacity', 0); ln.t.setAttribute('opacity', 0); return; }
      const ux = x / d, uy = y / d; ln.l.setAttribute('x1', ux * 122); ln.l.setAttribute('y1', uy * 122); ln.l.setAttribute('x2', x); ln.l.setAttribute('y2', y); ln.l.setAttribute('opacity', 0.25 + v.f * 0.7);
      const tapa = (Math.abs(x) < 330 && y > -150 && y < 150) || (Math.abs(x) < 210 && y > 110 && y < 210);
      ln.t.setAttribute('x', x + 6); ln.t.setAttribute('y', y + 12); ln.t.setAttribute('opacity', tapa ? 0 : 0.9); });
  }
  // área livre do canvas: entre log, status (ou painel aberto), topo e linha do tempo
  _livre() { const W = this.c.w, H = this.c.h; const pa = document.body.classList.contains('painel-aberto'); return { l: 314, r: W - (pa ? 562 : 294), t: 94, b: H - 60 }; }
  _anelMontar(n) {
    const svg = this.svg; svg.innerHTML = ''; this.anelAtivo = true; this.anelId = n.id + (this.detalhe ? 'd' : '');
    const d = this.detalhe && this.detalhe.no && this.detalhe.no.id === n.id ? this.detalhe : null;
    const add0 = (tag, at, pai) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); pai.appendChild(e); return e; };
    const defs = add0('defs', {}, svg); const cp = add0('clipPath', { id: 'clip-anel' }, defs); this.clipR = add0('rect', { x: 0, y: 0, width: 10, height: 10 }, cp);
    const gc = add0('g', { 'clip-path': 'url(#clip-anel)' }, svg);
    const g = document.createElementNS(NS, 'g'); gc.appendChild(g); this.anelG = g;
    const add = (tag, at, pai = g) => add0(tag, at, pai);
    const Lv = this._livre(); const meia = (Lv.r - Lv.l) / 2; const cw = (this.cw || 5.6) * (9.5 / 9);
    const maxCampo = Math.max(10, Math.floor((Math.min(260, meia - 118 - 52)) / cw)); // caracteres que cabem de cada lado
    const ctx = this._ctx || (this._ctx = document.createElement('canvas').getContext('2d')); ctx.font = '9.5px "Martian Mono Variable", monospace';
    const maxPx = Math.max(60, Math.min(260, meia - 118 - 54));
    const corta = (v, k) => { v = String(v); if (ctx.measureText(v).width <= maxPx) return v; const cam = k === 'CAMINHO'; let t = v; while (t.length > 1 && ctx.measureText('…' + t).width > maxPx) t = cam ? t.slice(1) : t.slice(0, -1); return cam ? '…' + t : t + '…'; };
    const R = 118;
    add('circle', { r: R + 14, class: 'f-fx' });
    add('circle', { r: R, fill: 'none', class: 's-t', 'stroke-width': 1 });
    add('circle', { r: R - 16, fill: 'none', class: 's-l', 'stroke-width': 1 });
    add('circle', { r: 7, fill: 'none', class: 's-v', 'stroke-width': 2 });
    add('line', { x1: -24, y1: 0, x2: -10, y2: 0, class: 's-v' }); add('line', { x1: 10, y1: 0, x2: 24, y2: 0, class: 's-v' }); add('line', { x1: 0, y1: -24, x2: 0, y2: -10, class: 's-v' }); add('line', { x1: 0, y1: 10, x2: 0, y2: 24, class: 's-v' });
    const giro = add('g', { class: 'giro' });
    for (let k = 0; k < 120; k++) { const a = k / 120 * Math.PI * 2, l = k % 10 === 0 ? 10 : k % 5 === 0 ? 6 : 3; add('line', { x1: Math.cos(a) * R, y1: Math.sin(a) * R, x2: Math.cos(a) * (R + l), y2: Math.sin(a) * (R + l), class: k % 10 === 0 ? 's-t' : 's-a', 'stroke-width': 1 }, giro); }
    // texto circular com hash/id
    const pid = 'arco' + n.idCurto; add('path', { id: pid, d: `M ${-(R - 8)} 0 A ${R - 8} ${R - 8} 0 1 1 ${R - 8} 0 A ${R - 8} ${R - 8} 0 1 1 ${-(R - 8)} 0`, fill: 'none' }, giro);
    const tx = add('text', { class: 'f-c', 'font-size': 7.5, 'letter-spacing': 1.5, 'font-family': 'Martian Mono Variable, monospace' }, giro);
    const tp = add('textPath', { href: '#' + pid }, tx); tp.textContent = `ID ${n.id} · HASH ${n.hash} · ${TIPO_ROT[n.tipo] || n.tipo} · ${FONTE_ROT[n.fonte]} · G${n.grau} · CL${n.cluster} · `.repeat(2).toUpperCase().slice(0, 150);
    // arcos de grau / palavras
    const arco = (r, f, cor, w) => { const a = Math.min(0.999, f) * Math.PI * 2; add('path', { d: `M 0 ${-r} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${Math.sin(a) * r} ${-Math.cos(a) * r}`, fill: 'none', class: cor, 'stroke-width': w }); };
    arco(R - 22, Math.min(1, n.grau / 60), 's-v', 3); arco(R - 28, Math.min(1, Math.log10(1 + n.palavras) / 4.5), 's-m', 2);
    // campos radiais
    const tags = (d?.maquina?.tags || n.tags || []).slice(0, 5).join(' ').toUpperCase();
    const campos = [
      ['HASH', n.hash], ['AUTOR', n.autor], ['CRIADO', fmtDataHora(n.criado)], ['MODIF.', fmtDataHora(n.modificado) + ' · ' + fmtRel(n.modificado)],
      ['TAGS MÁQ.', tags || '—'], ['CAMINHO', n.caminho || '—'], ['REGIÃO', n.regiao + ' / ' + (n.subregiao || '')], ['GRAU · PALAVRAS', `${n.grau} · ${fmtN(n.palavras)}`]
    ];
    const angs = [-56, -30, -4, 22, 48, 160, 196, 222];
    campos.forEach(([k, v], j) => {
      const a = angs[j] * Math.PI / 180; const dir = Math.cos(a) >= 0 ? 1 : -1; const x0 = Math.cos(a) * (R + 12), y0 = Math.sin(a) * (R + 12), x1 = dir * (R + 46), y1 = y0;
      add('line', { x1: Math.cos(a) * R, y1: Math.sin(a) * R, x2: x0, y2: y0, class: 's-t', 'stroke-width': 1 });
      add('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 's-a', 'stroke-width': 1 });
      const wl = Math.ceil(Math.max(k.length * 0.85 * cw, ctx.measureText(corta(v, k)).width) + 10); add('rect', { x: dir > 0 ? x1 + 2 : x1 - 2 - wl, y: y1 - 10, width: wl, height: 23, class: 'f-f' });
      const t1 = add('text', { x: x1 + dir * 4, y: y1 - 2, 'text-anchor': dir > 0 ? 'start' : 'end', class: 'f-c', 'font-size': 7.5, 'letter-spacing': 1.2, 'font-family': 'Martian Mono Variable, monospace' }); t1.textContent = k;
      const t2 = add('text', { x: x1 + dir * 4, y: y1 + 9, 'text-anchor': dir > 0 ? 'start' : 'end', class: 'f-t', 'font-size': 9.5, 'font-family': 'Martian Mono Variable, monospace' }); t2.textContent = corta(v, k);
    });
    // título e trecho
    const t = add('text', { x: 0, y: -R - 30, 'text-anchor': 'middle', class: 'f-t', 'font-size': 15, 'font-weight': 800, 'font-stretch': '75%', 'font-family': 'Martian Mono Variable, monospace' }); t.textContent = (n.idCurto + ' ' + n.titulo).slice(0, 56).toUpperCase();
    const bg = add('rect', { x: -6, y: -R - 46, width: 12, height: 4, class: 'f-v' });
    const trecho = d?.conteudo?.corpo ? d.conteudo.corpo.replace(/^---[\s\S]*?---/, '').replace(/[#>*`\[\]_|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    if (trecho) add('rect', { x: -200, y: R + 12, width: 400, height: 62, class: 'f-f' });
    if (trecho) { const linhas = trecho.match(/.{1,60}(\s|$)/g) || []; linhas.slice(0, 4).forEach((l, k) => { const e = add('text', { x: 0, y: R + 34 + k * 12, 'text-anchor': 'middle', class: k ? 'f-c' : 'f-t', 'font-size': 9, 'font-family': 'Martian Mono Variable, monospace' }); e.textContent = (k === 0 ? '“' : '') + l.trim() + (k === Math.min(3, linhas.length - 1) ? '”' : ''); }); add('text', { x: 0, y: R + 22, 'text-anchor': 'middle', class: 'f-v', 'font-size': 7.5, 'letter-spacing': 1.5, 'font-family': 'Martian Mono Variable, monospace' }).textContent = 'TRECHO // ORIGINAL INTACTO'; }
    // vizinhos por força
    const c = this.c; const vz = (d?.vizinhos || c.vizinhos(c.foco).map(([v, k]) => ({ id: c.g.nos[v].id, titulo: c.g.nos[v].titulo, forca: c.g.sinapses[k].peso || 0 })).sort((a, b) => b.forca - a.forca)).slice(0, 8);
    this.vizAnel = vz.map(v => ({ i: c.ids.get(v.id), f: v.forca, t: v.titulo })).filter(v => v.i != null);
    this.linhasViz = this.vizAnel.map((v, k) => ({ l: add('line', { class: k < 3 ? 's-v' : 's-t', 'stroke-width': k < 3 ? 1.5 : 1, 'stroke-dasharray': k < 3 ? '' : '3 3' }), t: Object.assign(add('text', { class: 'f-t', 'font-size': 8.5, 'font-family': 'Martian Mono Variable, monospace' }), { textContent: `#${k + 1} F${v.f.toFixed(2)} ${v.t.slice(0, 26)}` }) }));
  }
  esconderTudo() { for (const [, o] of this.rg) o.e.style.display = 'none'; }
}
