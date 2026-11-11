// AJUSTES de interface (tecla A / engrenagem): aplicam ao vivo e são salvos no servidor (/api/ajustes) com debounce.
import { $, esc } from './util.js';
import * as tema from './tema.js';

export const PADRAO = { tema: 'grafite', brilho: 1, tamanhoPonto: 1, orcamentoRotulos: 180, densidadeRotulos: 'normal', mostrarSinapses: true, mostrarTecido: true, mostrarGrade: true, rotacaoAuto: true,
  paineis: { log: true, status: true, contadores: true, minimapa: true, linhaTempo: true }, coresFonte: {}, som: false, visaoInicial: 'tudo',
  scanlines: 0.5, ruido: 0.5, fonteBase: 1, fonteLargura: 87.5, animacoesReduzidas: false, fpsMax: 60, projetosFav: [], projetosOcultos: [], lateralRecolhida: false };
const PAINEIS = [['log', 'LOG DE EVENTOS'], ['status', 'STATUS DO PROCESSO'], ['contadores', 'CONTADORES'], ['minimapa', 'MINIMAPA'], ['linhaTempo', 'LINHA DO TEMPO']];
const CHAVE_LOCAL = 'cortex.ajustes';

export class Ajustes {
  constructor(app) {
    this.app = app; this.e = $('#painel-ajustes'); this.a = JSON.parse(JSON.stringify(PADRAO)); this.servidor = true; this._t = null; this._pendente = false;
    // ao fechar a janela, grava o que ainda estava no debounce
    addEventListener('pagehide', () => { if (!this._pendente) return; const corpo = JSON.stringify(this.a); try { localStorage.setItem(CHAVE_LOCAL, corpo); } catch {} if (this.servidor && navigator.sendBeacon) navigator.sendBeacon('/api/ajustes', new Blob([corpo], { type: 'application/json' })); });
  }
  get aberto() { return !this.e.hidden; }
  async carregar() {
    let d = null;
    try { const r = await fetch('/api/ajustes'); if (r.ok) d = await r.json(); else this.servidor = false; } catch { this.servidor = false; }
    let local = null; try { local = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || 'null'); } catch { local = null; }
    if (!d) d = local; else if (local) for (const k in local) if (!(k in d)) d[k] = local[k]; // chaves que o servidor não guarda ficam no navegador
    try { const r = await fetch('/api/temas'); if (r.ok) { const t = await r.json(); for (const x of (Array.isArray(t) ? t : t.temas || [])) tema.registrar(x); } } catch {}
    this.a = { ...JSON.parse(JSON.stringify(PADRAO)), ...(d || {}) }; this.a.paineis = { ...PADRAO.paineis, ...(d?.paineis || {}) }; this.a.coresFonte = { ...(d?.coresFonte || {}) };
    // ?tema= na URL vence o ajuste salvo nesta janela
    let urlTema = null; try { urlTema = new URLSearchParams(location.search).get('tema'); } catch {}
    if (urlTema && tema.TEMAS[urlTema]) this.a.tema = urlTema;
    this.aplicarTudo();
  }
  set(caminho, v) { const p = caminho.split('.'); let o = this.a; while (p.length > 1) o = o[p.shift()]; o[p[0]] = v; this.aplicarTudo(caminho); this._salvar(); if (this.aberto) this._render(); }
  alternarPainel(k) { this.set('paineis.' + k, !this.a.paineis[k]); }
  _salvar() {
    clearTimeout(this._t); this._pendente = true; this._t = setTimeout(async () => { this._pendente = false;
      const corpo = JSON.stringify(this.a);
      if (this.servidor) { try { const r = await fetch('/api/ajustes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo }); if (!r.ok) this.servidor = false; } catch { this.servidor = false; } }
      try { localStorage.setItem(CHAVE_LOCAL, corpo); } catch {}
      const m = this.e.querySelector('[data-salvo]'); if (m) m.textContent = this.servidor ? 'SALVO NO SERVIDOR · data/ajustes.json' : 'SALVO NESTE NAVEGADOR (SERVIDOR SEM /api/ajustes)';
    }, 600);
  }
  aplicarTudo(mudou) {
    const a = this.a, app = this.app, c = app.cerebro, B = document.body;
    if (!mudou || mudou === 'tema' || mudou.startsWith('coresFonte')) { tema.coresFonte(a.coresFonte); if (tema.nome() !== a.tema) tema.aplicar(a.tema); }
    c.u.uBrilho.value = a.brilho; c.u.uTamMul.value = a.tamanhoPonto; c.us.uBrilhoS.value = a.brilho;
    if (c.sinObj) c.sinObj.visible = a.mostrarSinapses; c.mostrarTecido = a.mostrarTecido; c.mostrarGrade = a.mostrarGrade; if (c.tecidoObj) c.tecidoObj.visible = a.mostrarTecido; if (c.gradeObj) c.gradeObj.visible = a.mostrarGrade;
    if (!mudou || mudou === 'rotacaoAuto') c.autoGiro = a.rotacaoAuto && c.foco < 0;
    c.rotacaoAuto = a.rotacaoAuto;
    app.rotulos.orcamento = a.orcamentoRotulos; app.rotulos.densidade = a.densidadeRotulos;
    const R = document.documentElement.style; R.setProperty('--scan-op', a.scanlines); R.setProperty('--ruido-op', a.ruido); R.setProperty('--fs', a.fonteBase); R.setProperty('--fw', a.fonteLargura + '%');
    B.classList.toggle('anim-reduzidas', !!a.animacoesReduzidas); app.fpsMax = a.fpsMax || 60; B.classList.toggle('sb-recolhida', !!a.lateralRecolhida);
    if (app.shell) app.shell.aoAjustar();
    for (const [k] of PAINEIS) B.classList.toggle('sem-' + k, !a.paineis[k]);
    B.classList.toggle('sem-direita', !a.paineis.status && !a.paineis.minimapa);
    if (app.som.ligado !== a.som) { a.som ? app.som.ligar() : app.som.desligar(); }
    $('#btn-som').textContent = '[S] SOM: ' + (a.som ? 'ON' : 'OFF');
    app.relayout(); c.camMudou = true;
  }
  alternar(v = !this.aberto) { this.e.hidden = !v; if (v) this._render(); }
  _render() {
    const a = this.a; const sl = (k, t, min, max, st, fmt = x => (+x).toFixed(2)) => `<div class="aj-l"><span>${t}</span><b data-v="${k}">${fmt(a[k])}</b></div><input type="range" min="${min}" max="${max}" step="${st}" value="${a[k]}" data-sl="${k}">`;
    const ck = (k, t, v) => `<label class="ck"><input type="checkbox" data-ck="${k}" ${v ? 'checked' : ''}><span>${t}</span></label>`;
    const visoes = this.app.visoes.salvas;
    this.e.innerHTML = `<div class="cab"><span>AJUSTES // INTERFACE</span><button class="btn-mini" data-fechar>A / ESC FECHAR</button></div>
      <div class="pv-corpo">
      <div class="pv-rot">TEMA</div><div class="pv-seg c4">${tema.NOMES.map(n => `<button data-tema="${n}" class="${a.tema === n ? 'on' : ''}">${tema.TEMAS[n].nome}</button>`).join('')}</div>
      <div class="pv-rot">CÉREBRO</div>${sl('brilho', 'BRILHO', 0.3, 2, 0.05)}${sl('tamanhoPonto', 'TAMANHO DO PONTO', 0.4, 2.5, 0.05)}
      ${ck('mostrarSinapses', 'MOSTRAR SINAPSES', a.mostrarSinapses)}${ck('mostrarTecido', 'MOSTRAR TECIDO ANATÔMICO', a.mostrarTecido)}${ck('mostrarGrade', 'MOSTRAR GRADE DE COORDENADAS', a.mostrarGrade)}${ck('rotacaoAuto', 'ROTAÇÃO AUTOMÁTICA', a.rotacaoAuto)}
      <div class="pv-rot">RÓTULOS</div>${sl('orcamentoRotulos', 'ORÇAMENTO DE RÓTULOS', 0, 400, 10, x => String(Math.round(x)))}
      <div class="pv-seg">${[['minima', 'MÍNIMA'], ['normal', 'NORMAL'], ['maxima', 'MÁXIMA']].map(([k, t]) => `<button data-dens="${k}" class="${a.densidadeRotulos === k ? 'on' : ''}">DENSIDADE ${t}</button>`).join('')}</div>
      <div class="pv-rot">PAINÉIS DO HUD</div>${PAINEIS.map(([k, t]) => ck('paineis.' + k, t, a.paineis[k])).join('')}
      <div class="pv-rot">COR POR FONTE <span>SOBREPÕE O TEMA</span></div>
      <div class="aj-cores">${['obsidian', 'git', 'claude', 'pasta', 'diario'].map(k => `<label><input type="color" data-cor="${k}" value="${a.coresFonte[k] || tema.atual().d3[k]}"><span>${k === 'diario' ? 'DIÁRIO' : k.toUpperCase()}</span>${a.coresFonte[k] ? `<button class="btn-mini" data-cor-x="${k}">TEMA</button>` : ''}</label>`).join('')}</div>
      <div class="pv-rot">OUTROS</div>${ck('som', 'SOM DE MÁQUINA', a.som)}
      <div class="aj-l"><span>VISÃO INICIAL</span></div><select class="pv-in" data-vi>${visoes.map(v => `<option value="${esc(v.id)}" ${a.visaoInicial === v.id ? 'selected' : ''}>${esc(v.nome)}</option>`).join('')}</select>
      <div class="pv-desc" data-salvo>${this.servidor ? 'SALVA SOZINHO NO SERVIDOR' : 'SALVA NESTE NAVEGADOR'}</div>
      </div>
      <div class="pv-acoes"><button data-reset>RESTAURAR PADRÃO</button></div>`;
    const E = this.e;
    E.querySelector('[data-fechar]').onclick = () => this.alternar(false);
    E.querySelectorAll('[data-tema]').forEach(b => b.onclick = () => this.set('tema', b.dataset.tema));
    E.querySelectorAll('[data-sl]').forEach(i => i.oninput = () => { const k = i.dataset.sl; this.a[k] = +i.value; E.querySelector(`[data-v="${k}"]`).textContent = k === 'orcamentoRotulos' ? String(+i.value) : (+i.value).toFixed(2); this.aplicarTudo(k); this._salvar(); });
    E.querySelectorAll('[data-ck]').forEach(i => i.onchange = () => this.set(i.dataset.ck, i.checked));
    E.querySelectorAll('[data-dens]').forEach(b => b.onclick = () => this.set('densidadeRotulos', b.dataset.dens));
    E.querySelectorAll('[data-cor]').forEach(i => i.oninput = () => { this.a.coresFonte[i.dataset.cor] = i.value; this.aplicarTudo('coresFonte'); this._salvar(); });
    E.querySelectorAll('[data-cor]').forEach(i => i.onchange = () => this._render());
    E.querySelectorAll('[data-cor-x]').forEach(b => b.onclick = () => { delete this.a.coresFonte[b.dataset.corX]; this.set('coresFonte', { ...this.a.coresFonte }); });
    E.querySelector('[data-vi]').onchange = ev => this.set('visaoInicial', ev.target.value);
    E.querySelector('[data-reset]').onclick = () => { this.a = JSON.parse(JSON.stringify(PADRAO)); this.aplicarTudo(); this._salvar(); this._render(); };
  }
}
