// Painéis: neurônio aberto, máquina, barra de comando e conectar.
import * as tema from './tema.js';
const U = () => tema.ui();
import { marked } from 'marked';
import { $, el, esc, fmtN, fmtK, fmtData, fmtDataHora, fmtMs, fmtRel, FONTE_ROT, rotFonte, TIPO_ROT } from './util.js';

// ====================================================================== neurônio
export class PainelNo {
  constructor(app) { this.app = app; this.e = $('#painel-no'); this.aba = 'conteudo'; }
  async abrir(i) {
    const app = this.app, g = app.g, n = g.nos[i]; this.i = i; this.n = n; this.d = null;
    this.e.hidden = false; document.body.classList.add('painel-aberto'); const L = app.cerebro.area ? app.cerebro.area.l : 312; app.cerebro.setOffset(Math.max(0, innerWidth / 2 - (L + innerWidth - 560) / 2));
    this._render();
    try { const r = await fetch('/api/no/' + encodeURIComponent(n.id)); if (r.ok) { const d = await r.json(); if (this.n === n) { this.d = d; this._render(); app.rotulos.setDetalhe(d); } } } catch {}
  }
  fechar() { this.e.hidden = true; this.n = null; document.body.classList.remove('painel-aberto'); this.app.cerebro.setOffset(0); }
  _render() {
    const n = this.n, d = this.d; if (!n) return;
    const meta = [['TIPO', TIPO_ROT[n.tipo] || n.tipo], ['FONTE', n.diario ? 'DIÁRIO DAS SESSÕES' : (n.fonte || '').toUpperCase()], [n.diario ? 'AUTOR DA SESSÃO' : 'AUTOR', n.autor], ['GRAU', n.grau], ['CRIADO', fmtDataHora(n.criado)], ['MODIFICADO', fmtDataHora(n.modificado)], [n.tipo === 'commit' ? 'LINHAS' : 'PALAVRAS', fmtN(n.palavras)], ['CLUSTER', 'CL-' + n.cluster],
      ['HASH', n.hash], ['REGIÃO', n.regiao], ['SUBREGIÃO', n.subregiao || '—'], ['POS', n.pos.map(v => v.toFixed(0)).join(' ')]];
    const abas = [['conteudo', 'ORIGINAL'], ['maquina', 'MÁQUINA'], ['links', `LINKS ${d ? d.entrada.length + d.saida.length : ''}`], ['vizinhos', 'VIZINHOS'], ['historico', 'HISTÓRICO']];
    this.e.innerHTML = `<div class="pn-cab"><div class="pn-id">${n.idCurto.toUpperCase()}<span>${TIPO_ROT[n.tipo] || ''} · ${rotFonte(n)} · ${esc(n.id)}</span></div><div class="pn-tit">${esc(n.titulo)}${n.diario ? '<span class="tag-diario">DIÁRIO</span>' : ''}</div><button class="pn-fechar btn-mini">ESC FECHAR</button></div>
      <div class="pn-meta">${meta.map(([k, v]) => `<div><div class="k">${k}</div><div class="v" title="${esc(v)}">${esc(v)}</div></div>`).join('')}<div class="larg"><div class="k">CAMINHO</div><div class="v" title="${esc(n.caminho || '')}">${esc(n.caminho || '—')}</div></div></div>
      <div class="pn-abas">${abas.map(([k, t]) => `<button data-aba="${k}" class="${this.aba === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="pn-corpo">${this._corpo()}</div>`;
    this.e.querySelector('.pn-fechar').onclick = () => this.app.desfocar();
    this.e.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { this.aba = b.dataset.aba; this._render(); });
    this.e.querySelectorAll('[data-ir]').forEach(a => a.onclick = ev => { ev.preventDefault(); this.app.focarId(a.dataset.ir); });
    this.e.querySelectorAll('a.wl').forEach(a => a.onclick = ev => { ev.preventDefault(); const id = this.app.acharTitulo(a.dataset.alvo); if (id) this.app.focarId(id); });
    const f = this.e.querySelector('#maq-form'); if (f) f.onsubmit = ev => { ev.preventDefault(); this._corrigir(f); };
  }
  _corpo() {
    const n = this.n, d = this.d; if (!d) return `<div class="pn-rot">CARREGANDO REGISTRO<span class="cursor">_</span></div><div class="cinza">GET /api/no/${esc(n.id)}</div>`;
    const lista = (arr, vazio) => arr.length ? `<div class="lst">${arr.map(x => `<div class="acento">${esc(x.tipo || '')}</div><div class="ir" data-ir="${esc(x.id)}">${esc(x.titulo)}</div><div class="cinza">${x.peso != null ? 'P ' + (+x.peso).toFixed(2) : ''}</div>`).join('')}</div>` : `<div class="apagado">${vazio}</div>`;
    if (this.aba === 'conteudo') {
      const c = d.conteudo || {}; let corpo = '';
      if (c.formato === 'markdown') {
        const src = String(c.corpo || '').replace(/^---\n[\s\S]*?\n---\n?/, m => '```yaml\n' + m.replace(/^---\n|---\n?$/g, '') + '```\n')
          .replace(/\[\[#([^\]|]+)(\|[^\]]+)?\]\]/g, (m, a) => a).replace(/(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]+))?\]\]/g, (m, emb, alvo, anc, _, ali) => { const id = this.app.acharTitulo(alvo); return `<a class="wl${id ? '' : ' morto'}" data-alvo="${esc(alvo.trim())}">${emb ? '⧉ ' : ''}${esc(ali || alvo)}</a>`; });
        corpo = `<div class="md">${marked.parse(src, { mangle: false, headerIds: false })}</div>`;
      } else if (c.formato === 'commit') {
        const arq = c.extra?.arquivos || [];
        const x = c.extra || {};
        corpo = `<div class="md"><pre>${esc(c.corpo)}</pre></div>${x.sha ? `<div class="lst"><div class="cinza">SHA</div><div>${esc(x.sha)}</div><div></div><div class="cinza">PAIS</div><div>${(x.pais || []).map(p => esc(p.slice(0, 12))).join(' · ') || '— RAIZ'}</div><div></div>${x.refs ? `<div class="cinza">REFS</div><div class="maquina-c">${esc(x.refs)}</div><div></div>` : ''}<div class="cinza">DELTA</div><div><span class="texto">+${fmtN(x.mais)}</span> <span class="acento">−${fmtN(x.menos)}</span></div><div></div></div>` : ''}
          <div class="pn-rot">NUMSTAT // ${fmtN(x.nArquivos ?? arq.length)} ARQUIVOS</div><div class="commit-arq">${arq.map(a => { const cam = a.caminho ?? a.p; const id = this.app.acharCaminho(cam); return `<span class="${id ? 'ir' : ''}" ${id ? `data-ir="${id}" style="cursor:pointer"` : ''}>${esc(cam)}</span><span class="mais">+${fmtN(a.mais ?? a.a)}</span><span class="menos">−${fmtN(a.menos ?? a.d)}</span>`; }).join('')}</div>`;
      } else if (c.formato === 'sessao') {
        const fer = c.extra?.ferramentas || {}; const tot = Object.values(fer).reduce((a, b) => a + b, 0) || 1; const arq = c.extra?.arquivos || [];
        const x = c.extra || {};
        corpo = `${c.corpo ? `<div class="md"><pre>${esc(c.corpo)}</pre></div>` : ''}${x.cwd ? `<div class="lst"><div class="cinza">CWD</div><div>${esc(x.cwd)}</div><div></div><div class="cinza">MODELO</div><div class="maquina-c">${esc(x.modelo || '—')}</div><div></div><div class="cinza">MSGS</div><div>${fmtN(x.msgsUser)} USUÁRIO · ${fmtN(x.msgsAssist)} IA</div><div></div><div class="cinza">BRANCH</div><div>${esc(x.branch || '—')}</div><div></div></div>` : ''}<div class="pn-rot">FERRAMENTAS // ${fmtN(tot)} CHAMADAS</div>${Object.entries(fer).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="lst"><div class="maquina-c">${fmtN(v)}</div><div>${esc(k)}<div class="barra" style="width:${(v / tot * 100).toFixed(1)}%"></div></div><div class="cinza">${(v / tot * 100).toFixed(1)}%</div></div>`).join('')}
          <div class="pn-rot">ARQUIVOS TOCADOS // ${arq.length}</div><div class="lst">${arq.map(a => { const id = this.app.acharCaminho(a.caminho || a); return `<div class="apagado">ARQ</div><div class="${id ? 'ir' : ''}" ${id ? `data-ir="${id}"` : ''}>${esc(a.caminho || a)}</div><div class="cinza">${a.vezes ? a.vezes + '×' : ''}</div>`; }).join('')}</div>`;
      } else corpo = `<div class="md"><pre>${esc(c.corpo || '')}</pre></div>`;
      return `<div class="pn-rot">REGISTRO ORIGINAL // INTACTO</div>${corpo}`;
    }
    if (this.aba === 'maquina') {
      const m = d.maquina || {}, cor = d.correcao;
      return `<div class="pn-rot">INTERPRETAÇÃO DA MÁQUINA // SEPARADA DO ORIGINAL</div>
        <div class="maq-caixa"><div class="k">TAGS — POR ${esc((m.por || 'regras').toUpperCase())} · ${fmtDataHora(m.em)}</div><div class="tags">${(m.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="apagado">—</span>'}</div>
        <div class="k" style="margin-top:10px">REGIÃO ATRIBUÍDA</div><div>${esc(m.regiao || n.regiao)} · CLUSTER CL-${m.cluster ?? n.cluster}</div>${m.nota ? `<div class="k" style="margin-top:10px">NOTA</div><div class="cinza">${esc(m.nota)}</div>` : ''}</div>
        <div class="pn-rot">CORREÇÃO MANUAL // OPCIONAL</div>${cor ? `<div class="tags">${(cor.tags || []).map(t => `<span class="tag user">${esc(t)}</span>`).join('')}${cor.regiao ? `<span class="tag user">REGIÃO ${esc(cor.regiao)}</span>` : ''}</div>` : '<div class="apagado">NENHUMA. A MÁQUINA DECIDE SOZINHA.</div>'}
        <form id="maq-form" class="maq-edit"><input name="tags" placeholder="TAGS, SEPARADAS POR VÍRGULA" value="${esc((cor?.tags || m.tags || []).join(', '))}"><input name="regiao" placeholder="REGIÃO" value="${esc(cor?.regiao || '')}"><button>SALVAR</button></form><div id="maq-msg" class="cinza" style="margin-top:6px"></div>`;
    }
    if (this.aba === 'links') return `<div class="pn-rot">ENTRADA // ${d.entrada.length}</div>${lista(d.entrada, 'NENHUMA SINAPSE DE ENTRADA')}<div class="pn-rot">SAÍDA // ${d.saida.length}</div>${lista(d.saida, 'NENHUMA SINAPSE DE SAÍDA')}`;
    if (this.aba === 'vizinhos') { const m = Math.max(0.01, ...d.vizinhos.map(v => v.forca)); return `<div class="pn-rot">VIZINHOS MAIS PRÓXIMOS // ORDENADOS POR FORÇA</div>${d.vizinhos.map((v, k) => `<div class="lst"><div class="acento">#${String(k + 1).padStart(2, '0')}</div><div class="ir" data-ir="${esc(v.id)}">${esc(v.titulo)}<div class="barra" style="width:${(v.forca / m * 100).toFixed(1)}%"></div></div><div class="cinza">F ${(+v.forca).toFixed(3)}</div></div>`).join('') || '<div class="apagado">ÓRFÃO — SEM VIZINHOS</div>'}`; }
    return `<div class="pn-rot">HISTÓRICO // ${d.historico.length} EVENTOS</div><div class="lst">${d.historico.slice().sort((a, b) => b.t - a.t).map(h => `<div class="cinza">${fmtData(h.t)}</div><div>${esc(h.evento)}</div><div class="maquina-c">${esc((h.hash || '').slice(0, 8))}</div>`).join('')}</div>`;
  }
  async _corrigir(f) {
    const tags = f.tags.value.split(',').map(s => s.trim()).filter(Boolean), regiao = f.regiao.value.trim() || undefined;
    const msg = this.e.querySelector('#maq-msg'); msg.textContent = 'ENVIANDO CORREÇÃO…';
    try { const r = await fetch('/api/no/' + encodeURIComponent(this.n.id) + '/correcao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags, regiao }) }); msg.textContent = r.ok ? 'CORREÇÃO GRAVADA EM data/correcoes.json' : 'FALHOU: HTTP ' + r.status; if (r.ok && this.d) { this.d.correcao = { tags, regiao }; setTimeout(() => this._render(), 600); } } catch (e) { msg.textContent = 'FALHOU: ' + e.message; }
  }
}

// ====================================================================== máquina
export class PainelMaquina {
  constructor(app) { this.app = app; this.e = $('#maquina'); this.dados = { ativos: [], arquivosPorMinuto: new Array(60).fill(0), fila: 0 }; this.tele = []; }
  get aberto() { return !this.e.hidden; }
  alternar(v = !this.aberto) { this.e.hidden = !v; if (v) { this._montar(); this._buscar(); } }
  async _buscar() { try { const r = await fetch('/api/maquina'); if (r.ok) { const d = await r.json(); this.atualizar(d); if (d.telemetria) { this.tele = d.telemetria.slice(-200).concat(this.tele.filter(t => t.nivel !== 'HIST')).slice(-260); this._tele(); } } } catch {} }
  atualizar(d) { Object.assign(this.dados, d); if (this.aberto) { this._ativos(); this._gig(); this._barras(); } }
  evento(ev) { this.tele.push(ev); if (this.tele.length > 300) this.tele.shift(); if (this.aberto) this._tele(); }
  _montar() {
    this.e.innerHTML = `<div class="mq-cab"><div class="t">PAINEL DA MÁQUINA <span class="acento">// OPERAÇÃO CONTÍNUA</span><span class="cursor acento">█</span></div><div class="cinza" id="mq-sub"></div><button class="btn-mini" id="mq-fechar">M / ESC FECHAR</button></div>
      <div class="mq-col"><div class="cab"><span>AGENTES E SESSÕES ATIVOS AGORA</span><span id="mq-na">0</span></div><div id="mq-ativos" style="overflow:hidden;flex:1"></div></div>
      <div class="mq-col"><div class="mq-gig" id="mq-gig"></div><div class="cab"><span>ARQUIVOS TOCADOS POR MINUTO // ÚLTIMOS 60 MIN</span><span id="mq-apm"></span></div><div class="mq-barras"><canvas id="mq-can"></canvas></div></div>
      <div class="mq-col"><div class="cab"><span>TELEMETRIA AO VIVO // HASH · ID · T</span><span class="pisca acento">● REC</span></div><div class="tl apagado" style="font-size:8px;padding:3px 12px;border-bottom:1px solid var(--grade)"><span>T (MS)</span><span>HASH</span><span>ID</span><span>EVENTO</span></div><div class="tele" id="mq-tele"></div></div>`;
    this.e.querySelector('#mq-fechar').onclick = () => this.alternar(false);
    this._ativos(); this._gig(); this._barras(); this._tele();
  }
  _ativos() {
    const a = this.dados.ativos || []; const box = this.e.querySelector('#mq-ativos'); if (!box) return; this.e.querySelector('#mq-na').textContent = a.length;
    box.onclick = ev => { const d = ev.target.closest('[data-ir]'); if (d) { this.alternar(false); this.app.focarId(d.dataset.ir); } };
    box.innerHTML = a.length ? a.map((s, k) => `<div class="ativo${s.id ? ' clic' : ''}" data-ir="${esc(s.id)}"><div class="a1"><span>${esc((s.titulo || s.id).slice(0, 34))}</span><span class="acento">● ATIVO ${String(k + 1).padStart(2, '0')}</span></div><div class="a2">PROJETO ${esc(s.projeto || '—')}${s.agente ? ` · SUBAGENTE ${esc((s.agente.tipo || '').toUpperCase())}` : ''}${s.modelo ? ` · ${esc(s.modelo.toUpperCase())}` : ''}<br>INÍCIO ${fmtDataHora(s.inicio)} · ÚLTIMO SINAL ${fmtRel(s.ultimo ?? s.ultimoEvento)}<br>FERRAMENTAS ${fmtN(s.ferramentas)} · ARQUIVOS ${fmtN(s.arquivos)}${s.mensagens != null ? ` · MSGS ${fmtN(s.mensagens)}` : ''} · ID ${esc(String(s.idCurto || s.id).slice(0, 12))}</div></div>`).join('')
      : `<div class="ativo"><div class="a1"><span class="apagado">NENHUMA SESSÃO ATIVA NOS ÚLTIMOS 5 MIN</span></div><div class="a2">A MÁQUINA CONTINUA VIGIANDO ${fmtN(this.app.g?.fontes?.length || 0)} FONTES.</div></div>`;
  }
  _gig() {
    const k = this.app.g?.contadores || {}; const apm = (this.dados.arquivosPorMinuto || []).reduce((a, b) => a + b, 0);
    const box = this.e.querySelector('#mq-gig'); if (!box) return;
    box.innerHTML = [['NEURÔNIOS', fmtN(k.neuronios), 1], ['SINAPSES', fmtK(k.sinapses)], ['SESSÕES', fmtN(k.sessoes)], ['HORAS DE IA', (k.horasIA || 0).toFixed(1).replace('.', ',')], ['FERRAMENTAS', fmtK(k.ferramentas || 0)], ['ARQ / 60 MIN', fmtN(apm), 1], ['COMMITS', fmtN(k.commits)], ['LINHAS', fmtK(k.linhas || 0)], ['FILA', fmtN(this.dados.fila || 0)]].map(([a, b, v]) => `<div><div class="k">${a}</div><div class="v${v ? ' v1' : ''}">${b}</div></div>`).join('');
    this.e.querySelector('#mq-sub').textContent = `${fmtN(this.app.g?.fontes?.length || 0)} FONTES · GRAFO V${this.app.g?.versao ?? '—'} · ${fmtMs(Date.now())}`;
    this.e.querySelector('#mq-apm').textContent = `${fmtN(apm)} TOTAL · PICO ${Math.max(0, ...(this.dados.arquivosPorMinuto || [0]))}/MIN`;
  }
  _barras() {
    const cv = this.e.querySelector('#mq-can'); if (!cv) return; const r = cv.getBoundingClientRect(); const d = Math.min(devicePixelRatio, 2); cv.width = r.width * d; cv.height = r.height * d; const c = cv.getContext('2d'); c.scale(d, d);
    const v = this.dados.arquivosPorMinuto || []; const W = r.width, H = r.height - 16; const m = Math.max(4, ...v); const bw = W / 60;
    c.strokeStyle = U().grade; c.fillStyle = U().apagado; c.font = '8px Martian Mono Variable, monospace';
    for (let k = 0; k <= 4; k++) { const y = Math.round(H - H * k / 4) + .5; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); c.fillText(Math.round(m * k / 4), 2, y - 2); }
    v.forEach((x, i) => { const h = x / m * (H - 4); c.fillStyle = i === v.length - 1 ? U().acento : U().texto; c.fillRect(i * bw + 1, H - h, bw - 2, h); });
    for (let k = 0; k <= 60; k += 10) c.fillText(`−${60 - k}M`, Math.min(W - 26, k * bw), H + 12);
  }
  _tele() {
    const box = this.e.querySelector('#mq-tele'); if (!box) return;
    const linhas = this.tele.slice(-90).reverse();
    box.innerHTML = linhas.map(t => `<div class="tl"><span class="t">${fmtMs(t.t)}</span><span class="h">${esc(String(t.hash || '').slice(0, 8)) || '········'}</span><span class="i">${esc(String(t.id || '').slice(0, 8)) || '—'}</span><span class="${t.nivel === 'HIST' ? 'apagado' : ''}">${esc(t.nivel)} ${esc((t.fonte || '').toUpperCase())} ${esc(t.msg)}</span></div>`).join('');
  }
}

// ====================================================================== comando
export class Comando {
  constructor(app) {
    this.app = app; this.e = $('#cmd'); this.inp = $('#cmd-in'); this.res = $('#cmd-res'); this.sel = 0; this.itens = []; this.seq = 0;
    this.inp.addEventListener('input', () => this.buscar());
    this.inp.addEventListener('keydown', ev => { if (ev.key === 'ArrowDown') { ev.preventDefault(); this.mover(1); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.mover(-1); } else if (ev.key === 'Enter') { ev.preventDefault(); this.executar(this.itens[this.sel]); } else if (ev.key === 'Escape') this.fechar(); });
    this.e.addEventListener('mousedown', ev => { if (ev.target === this.e) this.fechar(); });
  }
  get aberto() { return !this.e.hidden; }
  abrir(txt = '') { this.e.hidden = false; this.inp.value = txt; this.inp.focus(); this.buscar(); }
  fechar() { this.e.hidden = true; }
  acoes() {
    const a = this.app; const s = a.sobre;
    return [['conectar', 'CONECTAR FONTE', 'ABRIR TELA DE CONEXÃO', () => a.conectar.abrir()], ['reconstruir', 'RECONSTRUIR CÉREBRO', 'POST /api/reconstruir', () => a.reconstruir()], ['replay', 'REPLAY DO CRESCIMENTO', 'DO PRIMEIRO REGISTRO ATÉ AGORA', () => a.replay.iniciar()], ['maquina', 'PAINEL DA MÁQUINA', 'TECLA M', () => a.maquina.alternar(true)],
      ['enquadrar', 'ENQUADRAR CÉREBRO INTEIRO', 'TECLA 0', () => a.cerebro.enquadrar()],
      ['tema', 'TEMA: CICLAR (' + tema.atual().nome + ' → PRÓXIMO)', 'TECLA T', () => a.ajustes.set('tema', tema.NOMES[(tema.NOMES.indexOf(tema.nome()) + 1) % tema.NOMES.length])], ...tema.NOMES.map(n => ['tema ' + n, 'TEMA: ' + tema.TEMAS[n].nome + (tema.nome() === n ? ' (ATUAL)' : ''), tema.TEMAS[n].desc.toUpperCase(), () => a.ajustes.set('tema', n)]),
      ['visao painel', 'VISÃO: ABRIR FILTROS', 'TECLA V', () => a.visoes.alternar(true)], ['tudo visao', 'VISÃO: TUDO (VOLTAR)', 'ESC', () => a.visoes.aplicar({ id: 'tudo', nome: 'TUDO' })],
      ...a.visoes.salvas.filter(v => v.id !== 'tudo').map(v => ['visao ' + v.id + ' ' + v.nome.toLowerCase(), 'VISÃO SALVA: ' + v.nome + (a.visoes.atual.id === v.id ? ' (ATUAL)' : ''), 'APLICAR', () => a.visoes.aplicar(v)]),
      ...a.visoes.projetos.map(p => ['projeto ' + String(p.nome).toLowerCase(), 'ISOLAR PROJETO ' + String(p.nome).toUpperCase(), fmtN(p.neuronios) + ' NEURÔNIOS', () => a.visoes.isolarProjeto(p.nome)]),
      ['ajustes', 'AJUSTES DA INTERFACE', 'TECLA A', () => a.ajustes.alternar(true)],
      ...[['log', 'LOG'], ['status', 'STATUS'], ['contadores', 'CONTADORES'], ['minimapa', 'MINIMAPA'], ['linhaTempo', 'LINHA DO TEMPO']].map(([k, t]) => [(a.ajustes.a.paineis[k] ? 'esconder ' : 'mostrar ') + t.toLowerCase(), (a.ajustes.a.paineis[k] ? 'ESCONDER ' : 'MOSTRAR ') + t, 'PAINEL DO HUD', () => a.ajustes.alternarPainel(k)]),
      ...[['mostrarSinapses', 'SINAPSES'], ['mostrarTecido', 'TECIDO'], ['mostrarGrade', 'GRADE'], ['rotacaoAuto', 'ROTAÇÃO AUTOMÁTICA']].map(([k, t]) => [(a.ajustes.a[k] ? 'esconder desligar ' : 'mostrar ligar ') + t.toLowerCase(), (a.ajustes.a[k] ? (k === 'rotacaoAuto' ? 'DESLIGAR ' : 'ESCONDER ') : (k === 'rotacaoAuto' ? 'LIGAR ' : 'MOSTRAR ')) + t, 'AJUSTE', () => a.ajustes.set(k, !a.ajustes.a[k])]), ['som', 'SOM DE MÁQUINA: ' + (a.som.ligado ? 'DESLIGAR' : 'LIGAR'), 'TECLA S', () => a.alternarSom()],
      ...s.map(o => [o.id, `SOBREPOSIÇÃO: ${o.nome} ${a.modo === o.id ? '(DESLIGAR)' : ''}`, `TECLA ${o.tecla}`, () => a.alternarModo(o.id)]),
      ...a.g.regioes.map(r => ['r:' + r.id, `IR PARA REGIÃO ${r.nome}`, `${r.serial} · ${fmtN(r.neuronios)} NEURÔNIOS`, () => { a.desfocar(); a.cerebro.voarRegiao(r); }])];
  }
  async buscar() {
    const q = this.inp.value.trim(); const ql = q.toLowerCase(); const seq = ++this.seq; const g = this.app.g;
    const acoes = this.acoes().filter(x => !q || x[1].toLowerCase().includes(ql.replace(/^>/, '')) || x[0].includes(ql)).slice(0, q.startsWith('>') ? 60 : q ? 8 : 8).map(x => ({ acao: x }));
    let locais = [];
    if (q && !q.startsWith('>')) { for (let i = 0; i < g.nos.length && locais.length < 40; i++) { const n = g.nos[i]; if (n.titulo.toLowerCase().includes(ql) || n.idCurto.startsWith(ql) || n.hash.startsWith(ql)) locais.push({ id: n.id, titulo: n.titulo, tipo: n.tipo, fonte: n.fonte, regiao: n.regiao, trecho: n.caminho || '' }); } }
    this.itens = [...locais.map(x => ({ no: x })), ...acoes]; this.sel = 0; this._render(q, 'LOCAL');
    if (q.length >= 2 && !q.startsWith('>')) {
      try { const r = await fetch('/api/busca?q=' + encodeURIComponent(q)); if (!r.ok || seq !== this.seq) return; const d = await r.json(); const vistos = new Set(locais.map(x => x.id));
        const extra = (d.resultados || []).filter(x => !vistos.has(x.id)); if (!extra.length) { this._render(q, 'LOCAL + SERVIDOR'); return; }
        this.itens = [...locais.map(x => ({ no: x })), ...extra.map(x => ({ no: x, srv: 1 })), ...acoes]; this._render(q, 'LOCAL + SERVIDOR'); } catch {}
    }
  }
  _render(q, origem) {
    const g = this.app.g; const hl = s => { s = esc(s); if (!q) return s; const i = s.toLowerCase().indexOf(esc(q).toLowerCase()); return i < 0 ? s : s.slice(0, i) + '<mark>' + s.slice(i, i + esc(q).length) + '</mark>' + s.slice(i + esc(q).length); };
    let html = '', grupo = '';
    this.itens.forEach((it, k) => {
      const gr = it.acao ? 'AÇÕES' : it.srv ? 'BUSCA NO CONTEÚDO // SERVIDOR' : 'NEURÔNIOS // TÍTULO'; if (gr !== grupo) { html += `<div class="cmd-grupo">${gr}</div>`; grupo = gr; }
      if (it.acao) html += `<div class="cr acao${k === this.sel ? ' sel' : ''}" data-k="${k}"><span class="tp">AÇÃO</span><span class="id">&gt;_</span><span class="tt">${hl(it.acao[1])}</span><span class="rg2">${esc(it.acao[2])}</span></div>`;
      else { const n = it.no; const no = g.nos[this.app.cerebro.ids.get(n.id)]; html += `<div class="cr${k === this.sel ? ' sel' : ''}" data-k="${k}"><span class="tp">${TIPO_ROT[n.tipo] || n.tipo} · ${rotFonte(n)}</span><span class="id">${no ? no.idCurto : '—'}</span><span class="tt">${hl(n.titulo)}<small>${esc((n.trecho || '').slice(0, 110))}</small></span><span class="rg2">${esc(n.regiao)}${no ? ' · G' + no.grau : ''}</span></div>`; }
    });
    this.res.innerHTML = html || `<div class="cr"><span class="tp">—</span><span class="id">∅</span><span class="tt apagado">NENHUM REGISTRO PARA "${esc(q)}"</span><span></span></div>`;
    this.res.querySelectorAll('[data-k]').forEach(d => { d.onmousemove = () => { if (this.sel !== +d.dataset.k) { this.sel = +d.dataset.k; this._marcar(); } }; d.onclick = () => this.executar(this.itens[+d.dataset.k]); });
    $('#cmd-rodape').innerHTML = `<span>${this.itens.filter(x => x.no).length} NEURÔNIOS · ${this.itens.filter(x => x.acao).length} AÇÕES · FONTE ${origem}</span><span>"&gt;" LISTA SÓ AÇÕES · ${fmtN(g.nos.length)} INDEXADOS</span>`;
  }
  _marcar() { this.res.querySelectorAll('[data-k]').forEach(d => d.classList.toggle('sel', +d.dataset.k === this.sel)); const s = this.res.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); }
  mover(d) { if (!this.itens.length) return; this.sel = (this.sel + d + this.itens.length) % this.itens.length; this._marcar(); }
  executar(it) { if (!it) return; this.fechar(); if (it.acao) it.acao[3](); else this.app.focarId(it.no.id); }
}

// ====================================================================== conectar
export class Conectar {
  constructor(app) {
    this.app = app; this.e = $('#conectar'); this.f = $('#con-form');
    this.e.querySelector('[data-fechar]').onclick = () => this.fechar(); this.e.addEventListener('mousedown', ev => { if (ev.target === this.e) this.fechar(); });
    this.f.onsubmit = async ev => { ev.preventDefault(); const body = { tipo: this.f.tipo.value, caminho: this.f.caminho.value.trim(), projeto: this.f.projeto.value.trim() || undefined };
      $('#con-msg').textContent = 'CONECTANDO ' + body.caminho + '…';
      try { const r = await fetch('/api/fontes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); $('#con-msg').innerHTML = r.ok ? '<span class="maquina-c">FONTE CONECTADA. O CÉREBRO VAI SE REDESENHAR SOZINHO.</span>' : '<span class="acento">FALHOU: ' + esc(t.slice(0, 200)) + '</span>'; if (r.ok) { this.f.caminho.value = ''; this.carregar(); } } catch (e) { $('#con-msg').textContent = 'FALHOU: ' + e.message; } };
  }
  get aberto() { return !this.e.hidden; }
  abrir() { this.e.hidden = false; this.carregar(); setTimeout(() => this.f.caminho.focus(), 30); }
  fechar() { this.e.hidden = true; }
  async carregar() {
    let fontes = this.app.g?.fontes || []; try { const r = await fetch('/api/fontes'); if (r.ok) { const d = await r.json(); fontes = Array.isArray(d) ? d : d.fontes || fontes; } } catch {}
    $('#con-lista').innerHTML = `<div class="cl h"><span>#</span><span>TIPO</span><span>CAMINHO</span><span>PROJETO</span><span>ITENS</span><span>STATUS</span><span></span></div>` + fontes.map((f, k) => `<div class="cl"><span class="n">${String(k + 1).padStart(2, '0')}</span><span class="tp">${esc((f.tipo || '').toUpperCase())}</span><span class="c" title="${esc(f.caminho)}">${esc(f.caminho)}${f.erro ? `<br><span class="acento">${esc(f.erro)}</span>` : ''}</span><span>${esc(f.projeto || '—')}</span><span>${fmtN(f.itens)}</span><span class="s ${esc(f.status)}">${esc(f.status || '—')}</span><button class="btn-mini" data-rm="${esc(f.id)}">REMOVER</button></div>`).join('');
    $('#con-lista').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { b.textContent = '…'; try { await fetch('/api/fontes/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); } catch {} this.carregar(); });
  }
}
