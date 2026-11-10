// HUD permanente: contadores, log, status, minimapa, réguas, avisos.
import * as tema from './tema.js';
const U = () => tema.ui();
import { $, el, esc, fmtN, fmtK, fmtMs, fmtData, FONTE_ROT } from './util.js';

export class Hud {
  constructor(cerebro) {
    this.c = cerebro; this.logEl = $('#log-linhas'); this.nLog = 0; this.linhas = []; this.fpsHist = new Array(128).fill(0); this.status = {};
    this.regua = $('#regua'); this.rctx = this.regua.getContext('2d'); this.mini = $('#mini'); this.mctx = this.mini.getContext('2d');
    this.fpsG = $('#fps-graf').getContext('2d');
    this.onClicarLog = null; this._resize(); addEventListener('resize', () => this._resize());
    this.contEl = $('#contadores');
    const defs = [['NOTAS', 'notas'], ['COMMITS', 'commits'], ['LINHAS', 'linhas'], ['SESSÕES', 'sessoes'], ['HORAS IA', 'horasIA'], ['NEURÔNIOS', 'neuronios', 1], ['SINAPSES', 'sinapses']];
    this.cont = defs.map(([r, k, v], j) => { const d = el('div', 'cont', `<div class="rot"><span>${r}</span><span>C-${String(j + 1).padStart(2, '0')}</span></div><div class="num${v ? ' v' : ''}">0</div><div class="det"></div>`); this.contEl.appendChild(d); return { k, num: d.querySelector('.num'), det: d.querySelector('.det'), v: 0, alvo: 0 }; });
    this.stEl = $('#status-grade');
    const sts = [['CPU APP', 'cpu', '%'], ['MEMÓRIA', 'mem', 'MB'], ['FPS', 'fps', ''], ['QUADRO', 'ms', 'MS'], ['NÓS RENDER', 'nos', ''], ['SINAPSES', 'sin', ''], ['FILA', 'fila', ''], ['EVT/S', 'evs', ''], ['RÓTULOS', 'rot', ''], ['PULSOS', 'pul', ''], ['UPTIME', 'up', ''], ['GRAFO', 'ver', '']];
    this.st = Object.fromEntries(sts.map(([k, id, u]) => { const d = el('div', 'st', `<div class="k">${k}</div><div class="v">—<small>${u}</small></div>`); this.stEl.appendChild(d); return [id, { v: d.querySelector('.v'), u }]; }));
    this.miniBase = null;
  }
  _resize() { const dpr = Math.min(devicePixelRatio, 2); this.dpr = dpr; this.regua.width = innerWidth * dpr; this.regua.height = innerHeight * dpr; }
  setGrafo(g) { this.g = g; for (const c of this.cont) c.alvo = g.contadores[c.k] || 0; this._detalhes(); this.miniBase = null; }
  _detalhes() {
    const g = this.g, k = g.contadores; const reg = g.regioes.length;
    const d = { notas: `${fmtN(k.arquivos)} ARQ · ${reg} REGIÕES`, commits: `${g.nos.filter(n => n.tipo === 'branch').length} BRANCHES · ${g.nos.filter(n => n.tipo === 'worktree').length} WT`, linhas: `+/− ACUMULADO`, sessoes: `${fmtN(k.ferramentas)} FERRAMENTAS`, horasIA: `EM SESSÕES REAIS`, neuronios: `${g.dias.length} DIAS NA ESPINHA`, sinapses: `${(k.sinapses / Math.max(1, k.neuronios)).toFixed(2).replace('.', ',')} POR NEURÔNIO` };
    for (const c of this.cont) c.det.textContent = d[c.k] || '';
  }
  // ---------------------------------------------------------------- log
  log(ev, novo = true) {
    const d = el('div', 'll ' + ev.nivel + (novo ? ' novo' : '') + (ev.id ? ' clic' : ''));
    d.innerHTML = `<span class="t">${fmtMs(ev.t)}</span><span class="n">${ev.nivel}</span><span class="m"><i>${(FONTE_ROT[ev.fonte] || ev.fonte || 'SYS').toUpperCase()}</i> ${esc(ev.msg)}${ev.hash ? ` <b>#${esc(String(ev.hash).slice(0, 8))}</b>` : ''}</span>`;
    if (ev.id) d.onclick = () => this.onClicarLog && this.onClicarLog(ev.id);
    this.logEl.prepend(d); this.linhas.push(d); if (novo) setTimeout(() => d.classList.remove('novo'), 900);
    if (this.linhas.length > 220) this.linhas.shift().remove();
    $('#log-n').textContent = fmtN(++this.nLog) + ' EVT';
  }
  // ---------------------------------------------------------------- por quadro
  quadro(dt, fps, ms, extra) {
    for (const c of this.cont) { if (c.v !== c.alvo) { c.v += (c.alvo - c.v) * Math.min(1, dt * 3.5); if (Math.abs(c.alvo - c.v) < 0.5) c.v = c.alvo; const val = c.k === 'horasIA' ? c.v.toFixed(1).replace('.', ',') : (c.v >= 1e5 ? fmtK(c.v) : fmtN(c.v)); if (c.num.textContent !== val) c.num.textContent = val; } }
    this.fpsHist.push(fps); this.fpsHist.shift();
    this._t = (this._t || 0) + dt; if (this._t > 0.25) { this._t = 0; this._status(fps, ms, extra); this._fpsGraf(); }
    this._regua(); this._minimapa();
    const r = new Date(); $('#relogio').textContent = fmtMs(r);
  }
  _set(id, v) { const s = this.st[id]; const h = `${v}<small>${s.u}</small>`; if (s._h !== h) { s.v.innerHTML = h; s._h = h; } }
  _status(fps, ms, x) {
    const s = this.status; this._set('cpu', s.cpu != null ? s.cpu.toFixed(1).replace('.', ',') : '—'); this._set('mem', s.memMB != null ? fmtN(s.memMB) : '—');
    this._set('fps', Math.round(fps)); this._set('ms', ms.toFixed(1).replace('.', ',')); this._set('nos', fmtN(x.nos)); this._set('sin', fmtK(x.sin)); this._set('fila', s.fila ?? '—');
    this._set('evs', s.eventosSeg != null ? s.eventosSeg.toFixed(1).replace('.', ',') : '—'); this._set('rot', x.rot); this._set('pul', x.pul);
    const up = s.uptime || 0; this._set('up', `${Math.floor(up / 3600)}:${String(Math.floor(up / 60) % 60).padStart(2, '0')}:${String(Math.floor(up) % 60).padStart(2, '0')}`); this._set('ver', 'V' + (this.g?.versao ?? '—'));
  }
  _fpsGraf() { const c = this.fpsG, w = 256, h = 34; c.fillStyle = U().fundo; c.fillRect(0, 0, w, h); c.fillStyle = U().grade; c.fillRect(0, h - 1 - 60 / 70 * (h - 4), w, 1); const bw = w / this.fpsHist.length; this.fpsHist.forEach((v, i) => { const bh = Math.min(1, v / 70) * (h - 4); c.fillStyle = v < 30 ? U().acento : U().cinza; c.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh); }); c.fillStyle = U().apagado; c.font = '8px Martian Mono Variable, monospace'; c.fillText('FPS 0–70 · LINHA 60', 4, 9); }
  // réguas nas bordas com coordenadas reais da cena no plano do alvo
  _regua() {
    const c = this.c; if (!c.mudouQuadro && this._rOk) return; this._rOk = true;
    const ctx = this.rctx, d = this.dpr, W = innerWidth, H = innerHeight; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
    const cam = c.camera, t = c.controls.target; const dist = c.dist(); const vh = 2 * Math.tan(cam.fov * Math.PI / 360) * dist; const upp = vh / H; // unidades por pixel no plano do alvo
    ctx.font = '8px Martian Mono Variable, monospace'; ctx.fillStyle = U().apagado; ctx.strokeStyle = U().apagado; ctx.lineWidth = 1;
    const passo = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(p => p / upp > 9) || 5000;
    const x0 = 312, x1 = W - 292, y0 = 92, y1 = H - 58; const cx = W / 2 + (c.offset || 0) * -1, cy = H / 2;
    ctx.beginPath();
    for (let u = Math.ceil(((x0 - cx) * upp) / passo) * passo; (cx + u / upp) < x1; u += passo) { const x = Math.round(cx + u / upp) + 0.5; const big = Math.round(u / passo) % 5 === 0; ctx.moveTo(x, y0); ctx.lineTo(x, y0 + (big ? 9 : 4)); ctx.moveTo(x, y1); ctx.lineTo(x, y1 - (big ? 9 : 4)); if (big) { ctx.fillText(Math.round(u + t.x), x + 2, y0 + 17); ctx.fillText(Math.round(u + t.x), x + 2, y1 - 11); } }
    for (let v = Math.ceil(((y0 - cy) * upp) / passo) * passo; (cy + v / upp) < y1; v += passo) { const y = Math.round(cy + v / upp) + 0.5; const big = Math.round(v / passo) % 5 === 0; ctx.moveTo(x0, y); ctx.lineTo(x0 + (big ? 9 : 4), y); ctx.moveTo(x1, y); ctx.lineTo(x1 - (big ? 9 : 4), y); if (big) { ctx.fillText(Math.round(t.y - v), x0 + 12, y + 3); const s = String(Math.round(t.y - v)); ctx.fillText(s, x1 - 12 - ctx.measureText(s).width, y + 3); } }
    ctx.stroke();
    // retícula central
    ctx.strokeStyle = tema.rgba(U().acento, .55); ctx.beginPath(); ctx.moveTo(cx - 14, cy + .5); ctx.lineTo(cx - 5, cy + .5); ctx.moveTo(cx + 5, cy + .5); ctx.lineTo(cx + 14, cy + .5); ctx.moveTo(cx + .5, cy - 14); ctx.lineTo(cx + .5, cy - 5); ctx.moveTo(cx + .5, cy + 5); ctx.lineTo(cx + .5, cy + 14); ctx.stroke();
    const p = cam.position; const az = Math.atan2(p.x - t.x, p.z - t.z) * 180 / Math.PI, el2 = Math.asin((p.y - t.y) / dist) * 180 / Math.PI;
    $('#cam-info').textContent = `CAM  X ${p.x.toFixed(1).padStart(8)}  Y ${p.y.toFixed(1).padStart(8)}  Z ${p.z.toFixed(1).padStart(8)}\nALVO X ${t.x.toFixed(1).padStart(8)}  Y ${t.y.toFixed(1).padStart(8)}  Z ${t.z.toFixed(1).padStart(8)}\nAZ ${az.toFixed(2).padStart(7)}°  EL ${el2.toFixed(2).padStart(6)}°  DIST ${dist.toFixed(1)}  FOV ${cam.fov}°  ESCALA 1PX=${upp.toFixed(2)}U  RÉGUA ${passo}U`;
  }
  _minimapa() {
    const c = this.c; const g = this.g; if (!g) return; const ctx = this.mctx, W = 256, H = 128;
    if (!this.miniBase) {
      const o = document.createElement('canvas'); o.width = W; o.height = H; const x = o.getContext('2d'); x.fillStyle = U().fundo; x.fillRect(0, 0, W, H);
      const b = c.bb; const ex = Math.max(b.x1 - b.x0, b.z1 - b.z0) * 1.25; const ey = (b.y1 - c.espinha.y0) * 1.15;
      this.mm = { s1: 120 / ex, s2: Math.min(120 / ey, 120 / ex), cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, cy: (b.y1 + c.espinha.y0) / 2 };
      const m = this.mm; x.fillStyle = tema.rgba(U().texto, .22);
      for (let i = 0; i < g.nos.length; i++) { const p = g.nos[i].pos; x.fillStyle = g.nos[i].fonte === 'git' ? tema.rgba(U().cinza, .35) : g.nos[i].fonte === 'claude' ? tema.rgba(U().maquina, .4) : tema.rgba(U().texto, .2); x.fillRect(64 + (p[0] - m.cx) * m.s1, 64 + (p[2] - m.cz) * m.s1, 1, 1); x.fillRect(192 + (p[2] - m.cz) * m.s2, 64 - (p[1] - m.cy) * m.s2, 1, 1); }
      x.strokeStyle = U().linha; x.strokeRect(.5, .5, 127, 127); x.strokeRect(128.5, .5, 127, 127); x.fillStyle = U().apagado; x.font = '7px Martian Mono Variable, monospace'; x.fillText('TOPO XZ', 4, 10); x.fillText('LADO ZY', 132, 10);
      this.miniBase = o;
    }
    const m = this.mm; ctx.drawImage(this.miniBase, 0, 0);
    const p = c.camera.position, t = c.controls.target;
    const px = 64 + (p.x - m.cx) * m.s1, pz = 64 + (p.z - m.cz) * m.s1, tx = 64 + (t.x - m.cx) * m.s1, tz = 64 + (t.z - m.cz) * m.s1;
    const ang = Math.atan2(tz - pz, tx - px), fov = c.camera.fov * Math.PI / 360 * c.camera.aspect; const L = 90;
    ctx.strokeStyle = U().acento; ctx.fillStyle = tema.rgba(U().acento, .08); ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + Math.cos(ang - fov) * L, pz + Math.sin(ang - fov) * L); ctx.lineTo(px + Math.cos(ang + fov) * L, pz + Math.sin(ang + fov) * L); ctx.closePath(); ctx.fill(); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 128, 128); ctx.clip(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = U().texto; ctx.fillRect(Math.max(1, Math.min(124, px - 2)), Math.max(1, Math.min(124, pz - 2)), 4, 4); ctx.strokeStyle = U().texto; ctx.strokeRect(tx - 3.5, tz - 3.5, 7, 7);
    const sy = 64 - (p.y - m.cy) * m.s2, sz = 192 + (p.z - m.cz) * m.s2, ty = 64 - (t.y - m.cy) * m.s2, tz2 = 192 + (t.z - m.cz) * m.s2;
    ctx.save(); ctx.beginPath(); ctx.rect(128, 0, 128, 128); ctx.clip(); ctx.strokeStyle = U().acento; ctx.beginPath(); ctx.moveTo(sz, sy); ctx.lineTo(tz2, ty); ctx.stroke(); ctx.fillStyle = U().texto; ctx.fillRect(sz - 2, sy - 2, 4, 4); ctx.strokeStyle = U().texto; ctx.strokeRect(tz2 - 3.5, ty - 3.5, 7, 7); ctx.restore();
    if (c.foco >= 0) { const f = g.nos[c.foco].pos; ctx.fillStyle = U().acento; ctx.fillRect(64 + (f[0] - m.cx) * m.s1 - 2, 64 + (f[2] - m.cz) * m.s1 - 2, 4, 4); }
    $('#mini-zoom').textContent = 'Z ' + (c.distInicial / c.dist()).toFixed(2).replace('.', ',') + 'X';
  }
  aviso(txt, ok, sub) { const a = $('#aviso'); const h = esc(txt) + '<span class="cursor">_</span>'; if (a._h !== h) { a.innerHTML = h; a._h = h; } a.classList.toggle('ok', !!ok); if (sub != null) $('#aviso2').innerHTML = sub; }
  nivel(n, extra) { const e = $('#nivel'); const h = `<div class="a">NÍVEL DE ZOOM // ${esc(extra)}</div><div class="b">${esc(n)}</div>`; if (e._h !== h) { e.innerHTML = h; e._h = h; } }
}
