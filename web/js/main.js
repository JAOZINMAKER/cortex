// CÓRTEX — orquestra cena, HUD, painéis, WebSocket e replay.
import * as tema from './tema.js';
const U = () => tema.ui();
import { Cerebro } from './brain.js';
import { Rotulos } from './labels.js';
import { Hud } from './hud.js';
import { PainelNo, PainelMaquina, Comando, Conectar } from './panels.js';
import { Som } from './sound.js';
import { grafoBench } from './bench.js';
import { Visoes, TUDO, vazia } from './visao.js';
import { Ajustes } from './ajustes.js';
import { $, el, esc, fmtN, fmtK, fmtData, fmtMs, fmtRel, clamp, FONTE_ROT, rotFonte, TIPO_ROT } from './util.js';

const DIA = 864e5;
const params = new URLSearchParams(location.search);
const BENCH = +params.get('bench') || 0;

class Replay {
  constructor(app) {
    this.app = app; this.ativo = false; this.tocando = false; this.vel = 100; this.t = 0;
    this.cv = $('#rp-hist'); this.trilho = this.cv.parentElement; this.cursor = $('#rp-cursor');
    $('#rp-play').onclick = () => this.tocando ? this.pausar() : this.iniciar();
    const vb = $('#rp-vel'); for (const v of [1, 10, 100, 1000]) { const b = el('button', v === this.vel ? 'on' : '', v + 'X'); b.title = `${v} DIA(S) POR SEGUNDO`; b.onclick = () => { this.vel = v; vb.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this._nasc(); }; vb.appendChild(b); }
    let arr = false; const mv = ev => { const r = this.trilho.getBoundingClientRect(); const f = clamp((ev.clientX - r.left) / r.width, 0, 1); this.ir(f * this.total, true); };
    this.trilho.addEventListener('pointerdown', ev => { arr = true; this.trilho.setPointerCapture(ev.pointerId); if (!this.ativo) { this.ativo = true; } this.tocando = false; this._botao(); mv(ev); });
    this.trilho.addEventListener('pointermove', ev => arr && mv(ev)); this.trilho.addEventListener('pointerup', () => { arr = false; if (this.t >= this.total - 0.01) this.parar(); });
    addEventListener('resize', () => this.desenhar());
  }
  setGrafo(g) { const c = this.app.cerebro; this.total = Math.max(1, (c.t1 - c.t0) / DIA); this.hist = null; this.desenhar(); this._info(); if (!this.ativo) this._cursor(1); }
  _nasc() { this.app.cerebro.u.uNascDur.value = this.ativo ? Math.max(0.4, this.vel * 0.9) : 1; }
  iniciar() { if (!this.ativo || this.t >= this.total - 0.01) this.t = 0; this.ativo = true; this.tocando = true; this._nasc(); this._botao(); this.app.desfocar(); this.app.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: `REPLAY INICIADO · ${Math.round(this.total)} DIAS · ${this.vel}X` }); }
  pausar() { this.tocando = false; this._botao(); }
  parar() { this.ativo = false; this.tocando = false; this.app.cerebro.setTempo(1e9, 1); this._botao(); this._info(); this._cursor(1); }
  ir(t, manual) { this.t = clamp(t, 0, this.total); this.app.cerebro.setTempo(this.t, manual ? 0.0001 : undefined); this._cursor(this.t / this.total); this._info(); }
  _botao() { const b = $('#rp-play'); b.textContent = this.tocando ? '❚❚ PAUSA' : this.ativo ? '▶ CONTINUAR' : '▶ REPLAY'; b.classList.toggle('on', this.tocando); }
  _cursor(f) { this.cursor.style.left = (f * 100).toFixed(3) + '%'; this.cursor.classList.toggle('fim', f > 0.85); const c = this.app.cerebro; $('#rp-data').textContent = this.ativo ? fmtData(c.t0 + this.t * DIA) : 'AGORA · ' + fmtData(Date.now()); }
  quadro(dt) { if (!this.tocando) return; this.ir(this.t + dt * this.vel); if (this.t >= this.total) { this.tocando = false; setTimeout(() => this.parar(), 1200); } }
  _info() {
    const c = this.app.cerebro, g = this.app.g; if (!g) return; let n = 0; const lim = this.ativo ? c.t0 + this.t * DIA : Infinity; for (const x of g.nos) if (x.criado <= lim) n++;
    this.vivos = n; $('#rp-info').innerHTML = `<b>${fmtN(n)}</b> / ${fmtN(g.nos.length)} NEURÔNIOS NASCIDOS<br>${this.ativo ? 'REPLAY ' + fmtData(lim) + ' · DIA ' + Math.floor(this.t) + '/' + Math.round(this.total) : 'TEMPO REAL · ' + fmtData(c.t0) + ' → HOJE'} · ${this.vel}X`;
  }
  desenhar() {
    const g = this.app.g, c = this.app.cerebro; if (!g) return; const r = this.trilho.getBoundingClientRect(); const d = Math.min(devicePixelRatio, 2); this.cv.width = r.width * d; this.cv.height = r.height * d; const x = this.cv.getContext('2d'); x.scale(d, d);
    const W = r.width, H = r.height; const B = Math.max(20, Math.floor(W / 3)); const h = new Float32Array(B), hs = new Float32Array(B);
    for (const n of g.nos) { const k = Math.min(B - 1, Math.floor((n.criado - c.t0) / DIA / this.total * B)); if (k >= 0) { h[k]++; if (n.fonte === 'git' || n.fonte === 'claude') hs[k]++; } }
    const m = Math.max(...h) || 1; x.fillStyle = U().fundo; x.fillRect(0, 0, W, H);
    for (let k = 0; k < B; k++) { const v = Math.sqrt(h[k] / m) * (H - 18); x.fillStyle = U().apagado; x.fillRect(k * W / B, H - v, W / B - 1, v); const v2 = Math.sqrt(hs[k] / m) * (H - 18); x.fillStyle = tema.rgba(U().acento, .5); x.fillRect(k * W / B, H - v2, W / B - 1, v2); }
    x.fillStyle = U().cinza; x.font = '8px Martian Mono Variable, monospace'; const anos = new Set();
    for (let k = 0; k <= 8; k++) { const t = c.t0 + this.total * DIA * k / 8; const s = fmtData(t); x.fillRect(k * W / 8, 0, 1, 4); x.fillText(s, Math.min(W - 58, k * W / 8 + 3), 12); }
    x.fillStyle = U().linha; x.fillRect(0, H - 1, W, 1);
  }
}

class App {
  constructor() {
    this.cerebro = new Cerebro($('#gl')); this.rotulos = new Rotulos(this.cerebro, $('#rotulos'), $('#anel')); this.hud = new Hud(this.cerebro);
    this.painel = new PainelNo(this); this.maquina = new PainelMaquina(this); this.comando = new Comando(this); this.conectar = new Conectar(this); this.som = new Som(); this.replay = new Replay(this); this.visoes = new Visoes(this); this.ajustes = new Ajustes(this);
    this.modo = null; this.carregando = true; this.ultEvento = 0; this.evts = []; this.ws = null;
    this.sobre = [{ id: 'calor', nome: 'CALOR DE ATIVIDADE', tecla: 1 }, { id: 'idade', nome: 'IDADE DAS NOTAS', tecla: 2 }, { id: 'cluster', nome: 'CLUSTERS POR TEMA', tecla: 3 }, { id: 'caminho', nome: 'CAMINHO MAIS CURTO', tecla: 4 }, { id: 'orfaos', nome: 'ÓRFÃOS SEM LIGAÇÃO', tecla: 5 }];
    this._sobreUI(); this._entrada();
    this.hud.onClicarLog = id => this.focarId(id);
    this.rotulos.onIsolar = r => { if (r.hemisferio === 'TRONCO') return; if (vazia(this.visoes.atual)) this.visoes.isolarProjeto(r.projeto || r.id.replace(/^r_/, '')); else this.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: 'VISÃO JÁ ISOLADA · ESC VOLTA PARA TUDO' }); };
    $('#btn-visao').onclick = () => this.visoes.alternar(); $('#btn-ajustes').onclick = () => this.ajustes.alternar(); $('#visao-sel [data-ajustes]').onclick = () => this.ajustes.alternar();
    tema.aoTrocar((T, n) => { this.hud.miniBase = null; this.hud._rOk = false; this.replay.desenhar(); if (this.maquina.aberto) this.maquina._barras(); $('#btn-tema').textContent = '[T] TEMA: ' + T.nome; this.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: 'TEMA ' + T.nome + ' APLICADO' }); });
    $('#btn-tema').textContent = '[T] TEMA: ' + tema.atual().nome; $('#btn-tema').onclick = () => this.ajustes.set('tema', tema.NOMES[(tema.NOMES.indexOf(tema.nome()) + 1) % tema.NOMES.length]);
    $('#btn-conectar').onclick = () => this.conectar.abrir(); $('#btn-maquina').onclick = () => this.maquina.alternar(); $('#btn-cmd').onclick = () => this.comando.abrir(); $('#btn-som').onclick = () => this.alternarSom();
    if (BENCH) $('#bench-selo').hidden = false;
    this.carregar().then(async () => { if (BENCH) return; try { const r = await fetch('/api/maquina'); if (r.ok) { const d = await r.json(); this.maquina.atualizar(d); for (const ev of (d.telemetria || []).slice(-160)) { this.hud.log({ ...ev, nivel: ev.nivel === 'INFO' || ev.nivel === 'ALERTA' || ev.nivel === 'PULSO' ? ev.nivel : 'HIST' }, false); this.maquina.evento(ev); } } } catch {} this.conectarWS(); });
    this._loop();
  }
  async carregar() {
    this.carregando = true; this.hud.aviso('PROCESSANDO REGISTROS', false);
    if (BENCH) { this.relayout(); this.aplicarGrafo(grafoBench(BENCH, +params.get('sin') || 3)); this.carregando = false; return; }
    for (let k = 0; ; k++) { try { let r = await fetch('/api/status'); if (r.ok) { const st = await r.json(); this.hud.status = { ...this.hud.status, ...st }; break; } r = await fetch('/api/fontes'); if (r.ok) break; } catch {} this.hud.aviso('AGUARDANDO SERVIDOR · TENTATIVA ' + (k + 1), false); await new Promise(r => setTimeout(r, 1500)); }
    await this.ajustes.carregar(); await this.visoes.carregarListas();
    const vi = this.ajustes.a.visaoInicial; const v0 = this.visoes.daUrl() || (vi && vi !== 'tudo' ? { id: vi, _soId: true } : TUDO);
    for (let k = 0; k < 20 && !this.g; k++) { await this.visoes.aplicar(v0, { url: !!this.visoes.daUrl() }); if (!this.g) await new Promise(r => setTimeout(r, 1500)); }
    this.carregando = false;
  }
  // área livre do canvas conforme os painéis visíveis
  relayout() {
    const B = document.body.classList; this.cerebro.area = { l: B.contains('sem-log') ? 0 : 312, r: B.contains('sem-direita') ? 0 : 292, t: 92, b: B.contains('sem-linhaTempo') ? 0 : 58 };
    this.hud._rOk = false; this.cerebro.camMudou = true; if (this.g) this.replay.desenhar();
  }
  avisoGrande(t1, t2) { const a = $('#aviso-grande'); a.querySelector('.ag1').textContent = t1; a.querySelector('.ag2').textContent = t2 || ''; a.hidden = false; a.style.animation = 'none'; void a.offsetWidth; a.style.animation = ''; clearTimeout(this._agT); this._agT = setTimeout(() => a.hidden = true, 3000); }
  aplicarGrafo(g, opt = {}) {
    for (const n of g.nos) if (n.fonte === 'diario' || (!n.diario && /[\\/]diario[\\/]/i.test(n.caminho || '') && /cortex/i.test(n.caminho || ''))) { n.diario = true; n.fonte = 'diario'; }
    const ant = this.g; this.g = g; this._orf = null; this.cerebro.setGrafo(g, opt); this.rotulos.setGrafo(g); this.hud.setGrafo(g); this.replay.setGrafo(g);
    this.porTitulo = new Map(); this.porCaminho = new Map();
    for (const n of g.nos) { const k = n.titulo.toLowerCase(); if (!this.porTitulo.has(k)) this.porTitulo.set(k, n.id); if (n.caminho) this.porCaminho.set(n.caminho.replace(/\\/g, '/').toLowerCase(), n.id); }
    this._fontesUI();
    const k = g.contadores; this.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: `${ant ? 'GRAFO ATUALIZADO' : 'GRAFO CARREGADO'} V${g.versao} · ${fmtN(k.neuronios)} NEURÔNIOS · ${fmtN(k.sinapses)} SINAPSES · ${g.regioes.length} REGIÕES` });
    if (this.cerebro.foco >= 0 && this.painel.n) this.painel.abrir(this.cerebro.foco);
    this.visoes._seletor();
  }
  acharTitulo(t) { return this.porTitulo.get(String(t).trim().toLowerCase()) || null; }
  acharCaminho(p) { if (!p) return null; const s = String(p).replace(/\\/g, '/').toLowerCase(); if (this.porCaminho.has(s)) return this.porCaminho.get(s); for (const [k, v] of this.porCaminho) if (k.endsWith('/' + s) || s.endsWith(k)) return v; return null; }
  // ---------------------------------------------------------------- WS
  conectarWS() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); this.ws = ws;
    ws.onopen = () => this.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: 'WEBSOCKET CONECTADO /ws' });
    ws.onmessage = m => { let d; try { d = JSON.parse(m.data); } catch { return; } this.mensagem(d); };
    ws.onclose = () => { this.hud.log({ t: Date.now(), nivel: 'ALERTA', fonte: 'sistema', msg: 'WEBSOCKET CAIU · RECONECTANDO EM 2S' }); setTimeout(() => this.conectarWS(), 2000); };
  }
  async mensagem(d) {
    if (d.tipo === 'evento') {
      const i = d.id != null ? this.cerebro.ids.get(d.id) : undefined; const hist = d.nivel === 'HIST';
      this.hud.log(d, !hist); this.maquina.evento(d);
      if (i != null && (!hist || Math.random() < 0.5)) this.cerebro.pulsar(i, d.nivel);
      if (!hist) { this.ultEvento = performance.now(); this.som.clique(d.nivel); this.evts.push(performance.now()); }
    } else if (d.tipo === 'status') this.hud.status = d;
    else if (d.tipo === 'maquina') this.maquina.atualizar(d);
    else if (d.tipo === 'grafo') { if (this.g && d.versao === this.g.versao) return; this.atualizando = true; await this.visoes.recarregar(); this.atualizando = false; }
    else if (d.tipo === 'visao') {
      // logo após conectar o servidor reenvia a visão atual: só adota se a URL não pediu outra, e sem o aviso de sessão externa
      const saudacao = performance.now() - (this._olaEm || 0) < 2000; const v = d.visao || TUDO;
      if (saudacao) { if (!this.visoes.daUrl() && JSON.stringify(v) !== JSON.stringify(this.visoes.atual) && !(vazia(v) && vazia(this.visoes.atual))) this.visoes.aplicar(v); }
      else this.visoes.aplicar(v, { externa: true });
    }
    else if (d.tipo === 'ola') { this._olaEm = performance.now(); if (this.g && d.versao !== this.g.versao) this.mensagem({ tipo: 'grafo', versao: d.versao }); }
  }
  // ---------------------------------------------------------------- foco
  focar(i, voar = true) {
    if (i == null || i < 0) return; const c = this.cerebro;
    if (this.modo === 'caminho' && this.origemCaminho != null && this.origemCaminho !== i) { this.tracar(this.origemCaminho, i); return; }
    c.setFoco(i); this.rotulos.setDetalhe(null); if (voar) c.voarPara(i, 380); this.painel.abrir(i); this.cerebro.pulsar(i, 'PULSO');
    if (this.modo === 'caminho') { this.origemCaminho = i; this.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: 'CAMINHO: ORIGEM ' + c.g.nos[i].idCurto + ' · SHIFT+CLIQUE NO DESTINO' }); }
  }
  focarId(id) { const i = this.cerebro.ids.get(id); if (i != null) { if (this.replay.ativo) this.replay.parar(); this.focar(i); } }
  desfocar() { this.cerebro.setFoco(-1); this.painel.fechar(); this.rotulos.setDetalhe(null); }
  tracar(a, b) {
    const c = this.cerebro; const r = c.caminhoMaisCurto(a, b); this.modo = 'caminho'; c.aplicarModo('caminho', r); this._sobreUI();
    const A = c.g.nos[a], B = c.g.nos[b];
    this.hud.log({ t: Date.now(), nivel: r ? 'PULSO' : 'ALERTA', fonte: 'sistema', msg: r ? `CAMINHO ${A.idCurto} → ${B.idCurto} · ${r.arestas.length} SALTOS · ${r.nos.map(i => c.g.nos[i].idCurto).join('›')}` : `SEM CAMINHO ENTRE ${A.idCurto} E ${B.idCurto}` });
    if (r) { r.nos.forEach((i, k) => setTimeout(() => c.pulsar(i, 'ALERTA'), k * 120)); this.caminhoInfo = r; }
    this.origemCaminho = null;
  }
  alternarModo(m) {
    this.modo = this.modo === m ? null : m; this.cerebro.aplicarModo(this.modo, this.modo === 'caminho' ? this.caminhoInfo : null); this._sobreUI();
    if (this.modo === 'caminho') { this.origemCaminho = this.cerebro.foco >= 0 ? this.cerebro.foco : null; this.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: 'CAMINHO MAIS CURTO: CLIQUE NA ORIGEM, SHIFT+CLIQUE NO DESTINO' }); }
  }
  alternarSom() { this.ajustes.set('som', !this.ajustes.a.som); }
  async reconstruir() { this.hud.log({ t: Date.now(), nivel: 'ALERTA', fonte: 'sistema', msg: 'RECONSTRUÇÃO SOLICITADA' }); this.atualizando = true; try { await fetch('/api/reconstruir', { method: 'POST' }); } catch {} setTimeout(() => this.atualizando = false, 3000); }
  _sobreUI() {
    const box = $('#sobre'); const g = this.g;
    const cont = { calor: () => g ? g.nos.filter(n => Date.now() - n.modificado < 7 * DIA).length + ' 7D' : '', idade: () => g ? fmtRel(g.nos.reduce((m, n) => (isFinite(n.criado) && n.criado < m ? n.criado : m), Date.now())) : '', cluster: () => g ? new Set(g.nos.map(n => n.cluster)).size + ' CL' : '', caminho: () => this.caminhoInfo ? this.caminhoInfo.arestas.length + ' S' : 'BFS', orfaos: () => g ? g.nos.filter(n => n.orfao).length + '' : '' };
    box.innerHTML = this.sobre.map(o => `<div class="sob${this.modo === o.id ? ' on' : ''}" data-m="${o.id}"><span class="tecla">${o.tecla}</span><span>${o.nome}</span><span class="est">${this.modo === o.id ? 'ON' : (cont[o.id]?.() ?? '')}</span></div>`).join('');
    box.querySelectorAll('[data-m]').forEach(d => d.onclick = () => this.alternarModo(d.dataset.m));
  }
  _fontesUI() { const f = this.g.fontes || []; $('#fontes-lista').innerHTML = f.map(x => `<div class="fo"><span>${esc((x.tipo || '').toUpperCase())}</span><span class="c" title="${esc(x.caminho)}">${esc(x.caminho)}</span><span class="s ${esc(x.status)}">${esc(x.status)} ${x.itens != null ? fmtK(x.itens) : ''}</span></div>`).join('') || '<div class="fo"><span class="apagado">NENHUMA FONTE</span></div>'; this._sobreUI(); }
  // ---------------------------------------------------------------- entrada
  _entrada() {
    const cv = $('#gl'); let down = null;
    cv.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
    cv.addEventListener('pointerup', ev => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4) return; down = null;
      const i = this.cerebro.pegar(ev.clientX, ev.clientY, 14);
      if (i >= 0) { if (ev.shiftKey && this.cerebro.foco >= 0 && this.cerebro.foco !== i) this.tracar(this.cerebro.foco, i); else this.focar(i); }
      else if (this.cerebro.foco >= 0) this.desfocar();
    });
    cv.addEventListener('dblclick', () => { this.desfocar(); this.cerebro.enquadrar(); });
    cv.addEventListener('pointermove', ev => { this.mouse = [ev.clientX, ev.clientY]; });
    cv.addEventListener('pointerleave', () => { this.mouse = null; $('#dica').style.display = 'none'; });
    addEventListener('keydown', ev => {
      const alvo = ev.target; const digitando = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA');
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); this.comando.aberto ? this.comando.fechar() : this.comando.abrir(); return; }
      if (ev.key === 'Escape') { if (this.comando.aberto) this.comando.fechar(); else if (this.visoes.aberto) this.visoes.alternar(false); else if (this.ajustes.aberto) this.ajustes.alternar(false); else if (this.conectar.aberto) this.conectar.fechar(); else if (this.maquina.aberto) this.maquina.alternar(false); else if (this.cerebro.foco >= 0) this.desfocar(); else if (this.modo) this.alternarModo(this.modo); else if (!vazia(this.visoes.atual)) this.visoes.aplicar(TUDO); return; }
      if (digitando) return;
      const k = ev.key.toLowerCase();
      if (k === 'm') this.maquina.alternar(); else if (k === 's') this.alternarSom(); else if (k === '0') this.cerebro.enquadrar(); else if (k === ' ') { ev.preventDefault(); this.replay.tocando ? this.replay.pausar() : this.replay.iniciar(); }
      else if (k >= '1' && k <= '5') this.alternarModo(this.sobre[+k - 1].id); else if (k === 'c') this.conectar.abrir(); else if (k === 't') this.ajustes.set('tema', tema.NOMES[(tema.NOMES.indexOf(tema.nome()) + 1) % tema.NOMES.length]); else if (k === 'v') this.visoes.alternar(); else if (k === 'a') this.ajustes.alternar();
    });
  }
  _dica() {
    const d = $('#dica'); if (!this.mouse || this.comando.aberto) { d.style.display = 'none'; return; }
    const i = this.cerebro.pegar(this.mouse[0], this.mouse[1], 10); if (i < 0) { d.style.display = 'none'; this.dicaI = -1; return; }
    if (this.dicaI !== i) { const n = this.g.nos[i]; this.dicaI = i; d.innerHTML = `<div class="t">${n.idCurto} · ${esc(n.titulo.slice(0, 54))}</div><div class="x">${TIPO_ROT[n.tipo]} · ${rotFonte(n)} · ${fmtData(n.criado)} · G${n.grau} · ${fmtN(n.palavras)}${n.tipo === 'commit' ? 'L' : 'P'}</div><div class="x">${esc(n.regiao)} · #${esc(n.hash)}</div>`; }
    d.style.display = 'block'; d.style.left = (this.mouse[0] + 14) + 'px'; d.style.top = (this.mouse[1] + 14) + 'px';
  }
  // ---------------------------------------------------------------- laço
  _loop() {
    let ult = performance.now(), fps = 60, ms = 0, q = 0;
    const tick = () => {
      requestAnimationFrame(tick);
      const t = performance.now(); const dt = Math.min(0.1, (t - ult) / 1000); ult = t; fps += ((1 / Math.max(dt, 1e-3)) - fps) * 0.08; this.fpsAtual = fps;
      if (!this.g) { const st = this.hud.status; const mt = $('#montando'); const m = st.pronto === false || st.fase === 'MONTANDO'; if (mt.hidden === m) mt.hidden = !m; if (m) this.hud.aviso('MONTANDO O CÉREBRO…', false); return; }
      const t0 = performance.now();
      this.replay.quadro(dt); this.cerebro.quadro(dt); this.rotulos.atualizar(); if (++q % 2 === 0) this._dica();
      const c = this.cerebro, g = this.g; const vivos = this.replay.ativo ? this.replay.vivos : g.nos.length; c.nVivos = vivos;
      this.hud.quadro(dt, fps, ms, { nos: vivos, sin: g.sinapses.length, rot: this.rotulos.nRotulos || 0, pul: c.pulsos.length });
      // avisos com números reais
      const agora = performance.now(); this.evts = this.evts.filter(x => agora - x < 5000);
      const regs = g.contadores.neuronios + g.contadores.sinapses;
      const st = this.hud.status; const montando = st.pronto === false || st.fase === 'MONTANDO';
      const mt = $('#montando'); if (mt.hidden === montando) mt.hidden = !montando;
      if (montando && q % 6 === 0) mt.querySelector('.m2').textContent = `FASE ${st.fase || 'MONTANDO'} · ${fmtN(st.neuronios ?? g.nos.length)} NEURÔNIOS LIDOS · FILA ${st.fila ?? 0}`;
      const proc = montando || this.carregando || this.atualizando || this.replay.tocando || (this.hud.status.fila || 0) > 0 || agora - this.ultEvento < 2500;
      if (q % 6 === 0) {
        const txt = montando ? 'MONTANDO O CÉREBRO…' : this.replay.tocando ? `REPLAY // RECONSTRUINDO ${fmtN(vivos)} REGISTROS` : proc ? `PROCESSANDO ${fmtN(regs)} REGISTROS` : `VIGIANDO ${fmtN(regs)} REGISTROS`;
        const fontesOk = (g.fontes || []).filter(f => f.status === 'OK').length;
        const orf = this._orf ?? (this._orf = g.nos.filter(n => n.orfao).length);
        this.hud.aviso(txt, !proc, `FONTES ${fontesOk}/${(g.fontes || []).length} OK · GRAFO V${g.versao} · GERADO ${fmtMs(g.geradoEm)}<br>${(g.contadores.sinapses / Math.max(1, g.contadores.neuronios)).toFixed(2).replace('.', ',')} SIN/NEURÔNIO · ${fmtN(orf)} ÓRFÃOS · ${(this.evts.length / 5).toFixed(1).replace('.', ',')} EVT/S<br>ÚLTIMO EVENTO ${this.ultEvento ? ((agora - this.ultEvento) / 1000).toFixed(1).replace('.', ',') + 'S' : '—'} · FOCO ${c.foco >= 0 ? g.nos[c.foco].idCurto : 'NENHUM'} · MODO ${(this.modo || 'NORMAL').toUpperCase()}`);
        const nv = this.rotulos.nivel; this.hud.nivel(nv, nv === 'CÉREBRO' ? `${g.regioes.length} REGIÕES ROTULADAS` : nv === 'REGIÃO' ? `${this.rotulos.nRotulos} NEURÔNIOS · ${this.rotulos.nSin} SINAPSES ROTULADAS` : 'ANEL DE METADADOS ATIVO');
      }
      ms += ((performance.now() - t0) - ms) * 0.1; this.msAtual = ms;
    };
    requestAnimationFrame(tick);
  }
}

const app = new App();
// helpers para scripts (tools/shots.js, tools/bench.js)
window.__cortex = {
  app, pronto: () => !!app.g && !app.carregando,
  fps: () => app.fpsAtual, ms: () => app.msAtual,
  focar: id => { const i = typeof id === 'number' ? id : app.cerebro.ids.get(id); app.focar(i); return i; },
  focarMaisLigado: (tipo = 'nota') => { const g = app.g; let b = -1; g.nos.forEach((n, i) => { if (n.tipo === tipo && (b < 0 || n.grau > g.nos[b].grau)) b = i; }); app.focar(b); return b; },
  regiao: (k = 0) => { const r = [...app.g.regioes].filter(r => r.hemisferio !== 'TRONCO').sort((a, b) => b.neuronios - a.neuronios)[k]; app.desfocar(); app.cerebro.voarRegiao(r); return r.nome; },
  replay: f => { app.replay.ativo = true; app.replay.tocando = false; app.replay._nasc(); app.replay.ir(f * app.replay.total); app.replay._botao(); },
  pararReplay: () => app.replay.parar(),
  abrirMaquina: () => app.maquina.alternar(true), fecharMaquina: () => app.maquina.alternar(false),
  comando: t => app.comando.abrir(t), fecharComando: () => app.comando.fechar(),
  conectar: () => app.conectar.abrir(), fecharConectar: () => app.conectar.fechar(),
  enquadrar: () => { app.desfocar(); app.cerebro.enquadrar(false); }, modo: m => app.alternarModo(m),
  pararGiro: () => { app.cerebro.autoGiro = false; },
  tema: n => app.ajustes.set('tema', n),
  visao: v => app.visoes.aplicar(v), isolar: p => app.visoes.isolarProjeto(p), tudo: () => app.visoes.aplicar(TUDO),
  abrirVisao: () => app.visoes.alternar(true), fecharVisao: () => app.visoes.alternar(false), abrirAjustes: () => app.ajustes.alternar(true), fecharAjustes: () => app.ajustes.alternar(false),
  ajuste: (k, v) => app.ajustes.set(k, v), emTransicao: () => app.cerebro.emTransicao()
};
