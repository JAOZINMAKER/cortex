// PROJETOS: grade de cartões e página do projeto (CÉREBRO, ATIVIDADE, RESUMO, FONTES, DIÁRIO).
import { marked } from 'marked';
import * as tema from './tema.js';
import { esc, fmtN, fmtK, fmtRel, fmtData, fmtDataHora, TIPO_ROT, rotFonte } from './util.js';
import { obter, grafoTudo, estatisticas, silhueta, barras } from './dados.js';
import { cartaoDiario, ligarCartoesDiario } from './pag-diario.js';

const ABAS = [['cerebro', 'CÉREBRO'], ['atividade', 'ATIVIDADE'], ['resumo', 'RESUMO'], ['fontes', 'FONTES'], ['diario', 'DIÁRIO']];
const DIA = 864e5;

export class PaginaProjetos {
  constructor(app, shell) { this.app = app; this.shell = shell; this.filtro = ''; this.ordem = 'atividade'; this.verOcultos = false; this.est = null; this.diasResumo = 7; }
  async _dados() {
    const app = this.app; if (!app.visoes.projetos.length) await app.visoes.carregarListas();
    try { const g = await grafoTudo(app); if (this._ver !== g.versao || !this.est) { this.est = estatisticas(g); this._ver = g.versao; } } catch { this.est = this.est || { porProjeto: new Map(), caixa: { x0: -1, x1: 1, z0: -1, z1: 1 } }; }
    const fav = app.ajustes.a.projetosFav || [], ocu = app.ajustes.a.projetosOcultos || [];
    return app.visoes.projetos.map((p, k) => { const e = this.est.porProjeto.get(p.nome) || {}; return { ...e, ...p, pcs: e.pcs || new Map(), horasIA: p.horasIA ?? e.horasIA, d30: e.d30 || new Array(30).fill(0), diario: e.diario || 0, fav: fav.includes(p.nome), oculto: ocu.includes(p.nome), serial: 'PJ-' + String(k + 1).padStart(4, '0') }; });
  }
  ordenados(l) {
    const o = this.ordem; const f = this.filtro.toLowerCase();
    return l.filter(p => !f || String(p.nome).toLowerCase().includes(f)).sort((a, b) => (b.fav - a.fav) || (o === 'nome' ? String(a.nome).localeCompare(String(b.nome)) : o === 'tamanho' ? b.neuronios - a.neuronios : (b.ultimoPulso || 0) - (a.ultimoPulso || 0)));
  }
  _alternar(chave, nome) { const a = this.app.ajustes; const l = new Set(a.a[chave] || []); l.has(nome) ? l.delete(nome) : l.add(nome); a.set(chave, [...l]); }
  async render(el, r) {
    this.el = el;
    if (!el.querySelector('.pp-carregando') && !el.firstChild) el.innerHTML = '<div class="pg-vazio pp-carregando">CARREGANDO PROJETOS<span class="cursor">_</span></div>';
    const l = await this._dados(); if (this.shell.rota.secao !== 'projetos') return;
    if (r.projeto) return this._pagina(el, r, l);
    const vis = this.ordenados(l.filter(p => !p.oculto)), ocu = this.ordenados(l.filter(p => p.oculto));
    const tot = l.reduce((s, p) => s + (p.neuronios || 0), 0);
    el.innerHTML = `<div class="pg-cab"><div><div class="pg-sup">SEÇÃO 02 // ${l.length} PROJETOS · ${fmtN(tot)} NEURÔNIOS</div><h1>PROJETOS</h1></div>
      <div class="pg-ferr"><input class="pv-in" data-busca placeholder="FILTRAR PROJETOS" value="${esc(this.filtro)}"><div class="pv-seg">${[['atividade', 'ATIVIDADE'], ['tamanho', 'TAMANHO'], ['nome', 'NOME']].map(([k, t]) => `<button data-ord="${k}" class="${this.ordem === k ? 'on' : ''}">${t}</button>`).join('')}</div></div></div>
      <div class="pj-grade">${vis.map(p => this._cartao(p)).join('') || '<div class="pg-vazio">NENHUM PROJETO</div>'}</div>
      ${ocu.length ? `<div class="pg-rot"><button class="btn-mini" data-ver-ocultos>${this.verOcultos ? '▾' : '▸'} OCULTOS (${ocu.length})</button></div>${this.verOcultos ? `<div class="pj-grade ocultos">${ocu.map(p => this._cartao(p)).join('')}</div>` : ''}` : ''}`;
    const cores = tema.ui(); el.querySelectorAll('canvas[data-sil]').forEach(cv => silhueta(cv, this.est, cv.dataset.sil, cores));
    el.querySelector('[data-busca]').oninput = ev => { this.filtro = ev.target.value; this.render(el, r).then(() => { const i = el.querySelector('[data-busca]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
    el.querySelectorAll('[data-ord]').forEach(b => b.onclick = () => { this.ordem = b.dataset.ord; this.render(el, r); });
    const vo = el.querySelector('[data-ver-ocultos]'); if (vo) vo.onclick = () => { this.verOcultos = !this.verOcultos; this.render(el, r); };
    this._acoesCartao(el, r);
  }
  _cartao(p) {
    const n = encodeURIComponent(p.nome);
    return `<article class="pj-card${p.fav ? ' fav' : ''}${p.oculto ? ' oculto' : ''}" data-abrir="${esc(p.nome)}">
      <div class="pj-top"><canvas data-sil="${esc(p.nome)}"></canvas><div class="pj-nome"><div class="pj-serial">${p.serial} · ${esc(String(p.regiao || 'r_' + p.nome).toUpperCase())}</div><h2>${esc(String(p.nome).toUpperCase())}</h2><div class="pj-pulso">ÚLTIMO PULSO <b>${fmtRel(p.ultimoPulso)}</b></div></div>
      <div class="pj-btns"><button class="ico${p.fav ? ' on' : ''}" data-fav="${esc(p.nome)}" title="${p.fav ? 'DESAFIXAR' : 'FIXAR NO TOPO'}">★</button><button class="ico" data-ocultar="${esc(p.nome)}" title="${p.oculto ? 'MOSTRAR' : 'OCULTAR'}">${p.oculto ? '◉' : '◌'}</button></div></div>
      <div class="pj-nums"><div><span>NEURÔNIOS</span><b class="acento">${fmtK(p.neuronios || 0)}</b></div><div><span>COMMITS</span><b>${fmtK(p.commits || 0)}</b></div><div><span>SESSÕES</span><b>${fmtN(p.sessoes || 0)}</b></div><div><span>HORAS IA</span><b>${(p.horasIA || 0).toFixed(1).replace('.', ',')}</b></div></div>
      ${p.pcs && p.pcs.size > 1 ? `<div class="pj-pcs">${[...p.pcs].map(([n, c]) => `<span>${n === this.app.sync?.eu ? '◆' : '◇'} ${esc(String(n).toUpperCase())} ${fmtK(c)}</span>`).join('')}</div>` : ''}<div class="pj-ativ"><span>30 DIAS · ${fmtN(p.d30.reduce((a, b) => a + b, 0))} EVENTOS</span>${barras(p.d30, 220, 22)}</div>
      <div class="pj-pe">${ABAS.map(([k, t]) => `<a href="#/projetos/${n}/${k}">${t}</a>`).join('')}</div></article>`;
  }
  _acoesCartao(el) {
    el.querySelectorAll('[data-fav]').forEach(b => b.onclick = ev => { ev.stopPropagation(); this._alternar('projetosFav', b.dataset.fav); this.shell.rotear(); });
    el.querySelectorAll('[data-ocultar]').forEach(b => b.onclick = ev => { ev.stopPropagation(); this._alternar('projetosOcultos', b.dataset.ocultar); this.shell.rotear(); });
    el.querySelectorAll('[data-abrir]').forEach(c => c.onclick = ev => { if (ev.target.closest('a,button')) return; this.shell.ir(`#/projetos/${encodeURIComponent(c.dataset.abrir)}/atividade`); });
  }
  vizinho(nome, d, aba = 'atividade') { const l = this._ultimaLista || []; const i = l.findIndex(p => p.nome === nome); if (i < 0 || !l.length) return; const p = l[(i + d + l.length) % l.length]; this.shell.ir(`#/projetos/${encodeURIComponent(p.nome)}/${aba}`); }
  // ------------------------------------------------------------------ cabeçalho do projeto (também usado sobre o cérebro)
  _cab(p, aba, compacto) {
    const n = encodeURIComponent(p.nome);
    return `<div class="pp-cab${compacto ? ' compacto' : ''}"><div class="pp-nav"><button class="ico" data-viz="-1" title="PROJETO ANTERIOR [←]">←</button><button class="ico" data-viz="1" title="PRÓXIMO PROJETO [→]">→</button></div>
      <div class="pp-tit"><div class="pg-sup">${p.serial} · PROJETO ${(this._ultimaLista || []).findIndex(x => x.nome === p.nome) + 1}/${(this._ultimaLista || []).length}</div><h1>${esc(String(p.nome).toUpperCase())}</h1></div>
      <div class="pp-nums">${[['NEURÔNIOS', fmtN(p.neuronios || 0), 1], ['NOTAS', fmtN(p.notas || 0)], ['COMMITS', fmtN(p.commits || 0)], ['SESSÕES', fmtN(p.sessoes || 0)], ['HORAS IA', (p.horasIA || 0).toFixed(1).replace('.', ',')], ['DIÁRIO', fmtN(p.diario || 0)], ['ÚLTIMO PULSO', fmtRel(p.ultimoPulso)]].map(([k, v, a]) => `<div><span>${k}</span><b class="${a ? 'acento' : ''}">${v}</b></div>`).join('')}</div>
      <div class="pp-btns"><button class="ico${p.fav ? ' on' : ''}" data-fav="${esc(p.nome)}" title="FIXAR">★</button><button class="ico" data-ocultar="${esc(p.nome)}" title="${p.oculto ? 'MOSTRAR' : 'OCULTAR'}">${p.oculto ? '◉' : '◌'}</button></div></div>
      ${this._pcs(p)}<div class="pp-abas">${ABAS.map(([k, t], i) => `<a href="#/projetos/${n}/${k}" class="${aba === k ? 'on' : ''}"><kbd>${i + 1}</kbd>${t}</a>`).join('')}</div>`;
  }
  _pcs(p) {
    const pcs = [...(p.pcs || new Map())].sort((a, b) => b[1] - a[1]); if (!pcs.length) return '';
    const eu = this.app.sync?.eu; const tot = pcs.reduce((s, x) => s + x[1], 0);
    return `<div class="pp-pcs"><span class="pp-pcs-r">DADOS VINDOS DE ${pcs.length} PC${pcs.length > 1 ? 's' : ''}</span>${pcs.map(([n, c]) => `<span class="pp-pc${n === eu ? ' eu' : ''}" title="${fmtN(c)} NEURÔNIOS"><b>${n === eu ? '◆' : '◇'} ${esc(String(n).toUpperCase())}</b>${n === eu ? ' ESTE PC' : ''} · ${fmtN(c)}<i style="width:${(c / tot * 100).toFixed(1)}%"></i></span>`).join('')}</div>`;
  }
  async barra(el, nome) {
    const l = await this._dados(); this._ultimaLista = this.ordenados(l.filter(p => !p.oculto || p.nome === nome)); const p = l.find(x => x.nome === nome) || { nome, d30: [] };
    el.innerHTML = this._cab(p, 'cerebro', true); this._ligarCab(el, nome, 'cerebro');
  }
  _ligarCab(el, nome, aba) {
    el.querySelectorAll('[data-viz]').forEach(b => b.onclick = () => this.vizinho(nome, +b.dataset.viz, aba));
    el.querySelectorAll('[data-fav]').forEach(b => b.onclick = () => { this._alternar('projetosFav', nome); this.shell.rotear(); });
    el.querySelectorAll('[data-ocultar]').forEach(b => b.onclick = () => { this._alternar('projetosOcultos', nome); this.shell.rotear(); });
  }
  // ------------------------------------------------------------------ página
  async _pagina(el, r, l) {
    this._ultimaLista = this.ordenados(l.filter(p => !p.oculto || p.nome === r.projeto)); const p = l.find(x => x.nome === r.projeto);
    if (!p) { el.innerHTML = `<div class="pg-vazio">PROJETO "${esc(r.projeto)}" NÃO ENCONTRADO · <a href="#/projetos">VOLTAR</a></div>`; return; }
    el.innerHTML = `<div class="pp"><aside class="pp-lista"><div class="pg-rot">PROJETOS</div>${this._ultimaLista.map(x => `<a href="#/projetos/${encodeURIComponent(x.nome)}/${r.aba}" class="${x.nome === p.nome ? 'on' : ''}"><span>${x.fav ? '★ ' : ''}${esc(String(x.nome).toUpperCase())}</span><b>${fmtK(x.neuronios || 0)}</b></a>`).join('')}</aside>
      <section class="pp-main">${this._cab(p, r.aba)}<div class="pp-corpo" data-corpo><div class="pg-vazio">CARREGANDO<span class="cursor">_</span></div></div></section></div>`;
    this._ligarCab(el, p.nome, r.aba);
    const corpo = el.querySelector('[data-corpo]'); const P = encodeURIComponent(p.nome);
    try {
      if (r.aba === 'atividade') await this._atividade(corpo, p);
      else if (r.aba === 'resumo') await this._resumo(corpo, p);
      else if (r.aba === 'fontes') await this._fontes(corpo, p);
      else if (r.aba === 'diario') { const d = await obter(`/api/listar?projeto=${P}&fontes=diario&limite=200&ordem=recente`); const it = d.itens || []; corpo.innerHTML = `<div class="pg-rot">DIÁRIO DE ${esc(String(p.nome).toUpperCase())} · ${fmtN(d.total ?? it.length)} ENTRADAS</div>${it.map(x => cartaoDiario(x)).join('') || '<div class="pg-vazio">NENHUMA ENTRADA. AS SESSÕES REGISTRAM COM <code>cortex registrar</code>.</div>'}`; ligarCartoesDiario(corpo, this.app, this.shell); }
    } catch (e) { corpo.innerHTML = `<div class="pg-vazio alerta">FALHOU: ${esc(e.message)}${e.status === 503 ? ' · O CÉREBRO AINDA ESTÁ MONTANDO' : ''}</div>`; }
  }
  async _atividade(corpo, p) {
    const d = await obter(`/api/listar?projeto=${encodeURIComponent(p.nome)}&desde=90d&limite=400&ordem=recente`); const it = (d.itens || []).filter(x => x.tipo !== 'dia');
    const ini = Date.now() - 90 * DIA; const h = new Array(90).fill(0); for (const x of it) { const t = x.modificado || x.criado; if (t >= ini) h[Math.min(89, Math.floor((t - ini) / DIA))]++; }
    const porDia = new Map(); for (const x of it) { const k = fmtData(x.modificado || x.criado); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(x); }
    corpo.innerHTML = `<div class="pg-rot">ATIVIDADE // 90 DIAS · ${fmtN(d.total ?? it.length)} REGISTROS${d.total > it.length ? ` · MOSTRANDO ${it.length}` : ''}</div><div class="pp-hist">${barras(h, 900, 46)}<div class="pp-hist-esc"><span>${fmtData(ini)}</span><span>HOJE</span></div></div>
      <div class="tl-dias">${[...porDia].map(([dia, l]) => `<div class="tl-dia"><div class="tl-d"><b>${dia.slice(8)}</b><span>${dia.slice(0, 7)}</span><i>${l.length}</i></div><div class="tl-itens">${l.map(x => `<a class="tl-it t-${esc(x.tipo)} f-${esc(x.fonte)}" data-no="${esc(x.id)}"><span class="tl-h">${new Date(x.modificado || x.criado).toTimeString().slice(0, 5)}</span><span class="tl-tp">${esc(x.fonte === 'diario' ? 'DIÁRIO' : TIPO_ROT[x.tipo] || x.tipo)}</span><span class="tl-t">${esc(x.titulo)}</span><span class="tl-a">${esc(x.autor || '')}</span><span class="tl-id">${esc(x.idCurto || '')}</span></a>`).join('')}</div></div>`).join('') || '<div class="pg-vazio">SEM ATIVIDADE NOS ÚLTIMOS 90 DIAS</div>'}</div>`;
    corpo.querySelectorAll('[data-no]').forEach(a => a.onclick = () => this.app.abrirNoCerebro(a.dataset.no, p.nome));
  }
  async _resumo(corpo, p) {
    const q = this.diasResumo === 0 ? 'tudo=1' : 'dias=' + this.diasResumo;
    let md = await obter(`/api/resumo?projeto=${encodeURIComponent(p.nome)}&${q}`); if (typeof md !== 'string') md = md.markdown || md.texto || JSON.stringify(md, null, 2);
    corpo.innerHTML = `<div class="pg-rot">RESUMO PARA HUMANOS E AGENTES // <span class="pv-seg in">${[[7, '7D'], [30, '30D'], [90, '90D'], [0, 'TUDO']].map(([k, t]) => `<button data-dias="${k}" class="${this.diasResumo === k ? 'on' : ''}">${t}</button>`).join('')}</span></div><div class="md pp-md">${marked.parse(md)}</div><div class="pg-nota">MESMO TEXTO DE <code>cortex resumo ${esc(p.nome)}${this.diasResumo === 0 ? ' --tudo' : ' --dias ' + this.diasResumo}</code></div>`;
    corpo.querySelectorAll('[data-dias]').forEach(b => b.onclick = () => { this.diasResumo = +b.dataset.dias; this._resumo(corpo, p); });
  }
  async _fontes(corpo, p) {
    let f = await obter('/api/fontes'); const ap = (f && f.apelidos) || null; f = Array.isArray(f) ? f : f.fontes || [];
    let cfg = {}; try { cfg = await obter('/api/config'); } catch {}
    const apelidos = Object.entries(ap || cfg.apelidos || cfg.fontes?.apelidos || cfg.geral?.apelidos || {}).filter(([, v]) => v === p.nome);
    const minhas = f.filter(x => x.projeto === p.nome || (x.tipo === 'claude'));
    corpo.innerHTML = `<div class="pg-rot">FONTES QUE ALIMENTAM ${esc(String(p.nome).toUpperCase())}</div>
      <div class="tb-lista"><div class="tbl h"><span>TIPO</span><span>CAMINHO</span><span>PROJETO</span><span>ITENS</span><span>STATUS</span></div>${minhas.map(x => `<div class="tbl"><span class="b">${esc(String(x.tipo).toUpperCase())}</span><span class="c" title="${esc(x.caminho)}">${esc(x.caminho)}</span><span>${esc(x.projeto || (x.tipo === 'claude' ? 'POR PASTA (TODAS)' : '—'))}</span><span>${fmtN(x.itens)}</span><span class="s ${esc(x.status)}">${esc(x.status || '—')}</span></div>`).join('')}</div>
      <div class="pg-rot">APELIDOS QUE CAEM NESTE PROJETO</div><div class="pv-chips">${apelidos.map(([k]) => `<span class="chip">${esc(k)} → ${esc(String(p.nome))}</span>`).join('') || '<span class="apagado">NENHUM</span>'}</div>
      <div class="pg-nota">EDITAR EM <a href="#/config/fontes">CONFIGURAÇÕES › FONTES</a>.</div>`;
  }
}
