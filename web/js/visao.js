// VISÕES: filtros salvos (projetos, fontes, tipos, período, tags, grau, texto, vizinhos).
// Seletor sempre visível no topo, painel (tecla V), URL favoritável e troca vinda de outras sessões.
import { $, el, esc, fmtN, fmtData } from './util.js';

const DIA = 864e5;
const LISTAS = ['projetos', 'fontes', 'tipos', 'tags'];
const FONTES = [['obsidian', 'OBSIDIAN'], ['git', 'GIT'], ['claude', 'CLAUDE CODE'], ['pasta', 'PASTA']];
const TIPOS = [['nota', 'NOTA'], ['commit', 'COMMIT'], ['sessao', 'SESSÃO'], ['arquivo', 'ARQUIVO'], ['branch', 'BRANCH'], ['worktree', 'WORKTREE'], ['doc', 'DOC']];
export const TUDO = { id: 'tudo', nome: 'TUDO' };

export function vazia(v) { return !v || v.id === 'tudo' || !(LISTAS.some(k => v[k] && v[k].length) || v.desde || v.ate || v.grauMin || v.texto || v.vizinhos); }
export function paraQuery(v) {
  const q = new URLSearchParams(); if (vazia(v)) return q;
  for (const k of LISTAS) if (v[k] && v[k].length) q.set(k, v[k].join(','));
  for (const k of ['desde', 'ate', 'grauMin', 'vizinhos']) if (v[k]) q.set(k, String(v[k]));
  if (v.texto) q.set('texto', v.texto); return q;
}
export function daQuery(q) {
  const v = {}; for (const k of LISTAS) if (q.get(k)) v[k] = q.get(k).split(',').filter(Boolean);
  for (const k of ['desde', 'ate', 'grauMin', 'vizinhos']) if (q.get(k)) v[k] = +q.get(k);
  if (q.get('texto')) v.texto = q.get('texto'); return vazia(v) ? null : v;
}
export function descrever(v) {
  if (vazia(v)) return 'TODOS OS PROJETOS · TODAS AS FONTES';
  const p = []; if (v.projetos?.length) p.push(v.projetos.join(' + ').toUpperCase()); if (v.fontes?.length) p.push(v.fontes.join('/').toUpperCase()); if (v.tipos?.length) p.push(v.tipos.join('/').toUpperCase());
  if (v.desde) p.push('DESDE ' + fmtData(v.desde)); if (v.ate) p.push('ATÉ ' + fmtData(v.ate)); if (v.tags?.length) p.push('#' + v.tags.join(' #').toUpperCase());
  if (v.grauMin) p.push('GRAU ≥ ' + v.grauMin); if (v.texto) p.push('"' + v.texto.toUpperCase() + '"'); if (v.vizinhos) p.push('+' + v.vizinhos + ' SALTO' + (v.vizinhos > 1 ? 'S' : ''));
  return p.join(' · ');
}
const mesma = (a, b) => paraQuery(a).toString() === paraQuery(b).toString();

export class Visoes {
  constructor(app) {
    this.app = app; this.atual = TUDO; this.salvas = [TUDO]; this.projetos = []; this.e = $('#painel-visao'); this.rasc = {};
    this.seletor = $('#visao-sel');
    this.seletor.querySelector('[data-trocar]').onclick = () => this.alternar();
    this.seletor.querySelector('[data-tudo]').onclick = () => this.aplicar(TUDO);
  }
  get aberto() { return !this.e.hidden; }
  async carregarListas() {
    try { const r = await fetch('/api/visoes'); if (r.ok) { const d = await r.json(); const l = Array.isArray(d) ? d : d.visoes || []; this.salvas = l.some(v => v.id === 'tudo') ? l : [TUDO, ...l]; } } catch {}
    try { const r = await fetch('/api/projetos'); if (r.ok) { const d = await r.json(); this.projetos = d.projetos || d || []; } } catch {}
    if (!this.projetos.length && this.app.g) this.projetos = this._projetosLocais(this.app.g);
  }
  _projetosLocais(g) { const m = new Map(); for (const n of g.nos) { if (n.tipo === 'dia') continue; const p = n.regiao.replace(/^r_/, ''); m.set(p, (m.get(p) || 0) + 1); } return [...m].map(([nome, neuronios]) => ({ nome, neuronios })).sort((a, b) => b.neuronios - a.neuronios); }
  // URL ↔ visão --------------------------------------------------
  daUrl() { const q = new URLSearchParams(location.search); if (q.get('visao')) return { id: q.get('visao'), _soId: true }; const v = daQuery(q); return v ? { id: 'url', nome: 'PERSONALIZADA', ...v } : null; }
  _url(v) {
    try { const q = new URLSearchParams(location.search); for (const k of [...LISTAS, 'desde', 'ate', 'grauMin', 'vizinhos', 'texto', 'visao']) q.delete(k);
      if (!vazia(v)) { const salva = this.salvas.find(s => s.id === v.id && s.id !== 'url' && s.id !== 'ad-hoc'); if (salva && mesma(salva, v)) q.set('visao', v.id); else for (const [k, x] of paraQuery(v)) q.set(k, x); }
      const s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch {}
  }
  resolver(v) { if (v && v._soId) return this.salvas.find(s => s.id === v.id) || TUDO; if (v && (v.id === 'url' || v.id === 'ad-hoc')) return this.salvas.find(s => s.id !== 'tudo' && mesma(s, v)) || v; return v || TUDO; }
  // aplicar ------------------------------------------------------
  async aplicar(v, { externa = false, url = true } = {}) {
    v = this.resolver(v); const app = this.app; const ant = this.atual; this.atual = v;
    const q = paraQuery(v); const qs = q.toString();
    app.hud.log({ t: Date.now(), nivel: externa ? 'ALERTA' : 'INFO', fonte: 'sistema', msg: `VISÃO ${esc(v.nome || 'PERSONALIZADA')} · ${descrever(v)}` });
    if (externa) app.avisoGrande('VISÃO ALTERADA POR SESSÃO EXTERNA', (v.nome || 'PERSONALIZADA') + ' · ' + descrever(v));
    app.atualizando = true; this._seletor(true);
    try {
      const r = await fetch('/api/graph' + (qs ? '?' + qs : '')); if (!r.ok) throw new Error('HTTP ' + r.status);
      let g = await r.json(); if (!('visao' in g) && !vazia(v)) g = this._filtrarLocal(g, v); // servidor sem V3: filtra no cliente
      app.aplicarGrafo(g, { transicao: !!app.g && !mesma(ant, v) });
    } catch (e) { app.hud.log({ t: Date.now(), nivel: 'ALERTA', fonte: 'sistema', msg: 'VISÃO FALHOU: ' + e.message }); }
    app.atualizando = false; if (url) this._url(v); this._seletor(); if (this.aberto) this._render();
  }
  async recarregar() { const qs = paraQuery(this.atual).toString(); try { const r = await fetch('/api/graph' + (qs ? '?' + qs : '')); if (r.ok) { let g = await r.json(); if (!('visao' in g) && !vazia(this.atual)) g = this._filtrarLocal(g, this.atual); this.app.aplicarGrafo(g); } } catch {} }
  isolarProjeto(nome) { const s = this.salvas.find(x => x.projetos?.length === 1 && x.projetos[0] === nome && LISTAS.every(k => k === 'projetos' || !x[k]?.length)); this.aplicar(s || { id: 'ad-hoc', nome: 'SÓ ' + nome.toUpperCase(), projetos: [nome] }); }
  _filtrarLocal(g, v) {
    const ok = n => (n.tipo === 'dia') || ((!v.projetos?.length || v.projetos.includes(n.regiao.replace(/^r_/, ''))) && (!v.fontes?.length || v.fontes.includes(n.fonte)) && (!v.tipos?.length || v.tipos.includes(n.tipo)) && (!v.desde || (n.modificado || n.criado) >= v.desde) && (!v.ate || n.criado <= v.ate) && (!v.grauMin || n.grau >= v.grauMin) && (!v.texto || n.titulo.toLowerCase().includes(v.texto.toLowerCase())) && (!v.tags?.length || (n.tags || []).some(t => v.tags.includes(String(t).toUpperCase()))));
    const sel = []; g.nos.forEach((n, i) => ok(n) && sel.push(i)); const m = new Map(sel.map((i, k) => [i, k]));
    return { ...g, nos: sel.map(i => g.nos[i]), sinapses: g.sinapses.filter(s => m.has(s.a) && m.has(s.b)).map(s => ({ ...s, a: m.get(s.a), b: m.get(s.b) })), regioes: g.regioes.filter(r => sel.some(i => g.nos[i].regiao === r.id)), visao: v, total: { neuronios: g.nos.length, sinapses: g.sinapses.length } };
  }
  // seletor no topo ---------------------------------------------
  _seletor(carregando) {
    const g = this.app.g, v = this.atual; const tot = g?.total; const s = this.seletor;
    s.classList.toggle('filtrada', !vazia(v));
    s.querySelector('.vn').textContent = (v.nome || 'PERSONALIZADA').toUpperCase();
    s.querySelector('.vd').textContent = carregando ? 'RECALCULANDO LAYOUT…' : descrever(v);
    s.querySelector('.vc').textContent = g ? (tot && tot.neuronios !== g.nos.length ? `${fmtN(g.nos.length)} / ${fmtN(tot.neuronios)} NEURÔNIOS` : `${fmtN(g.nos.length)} NEURÔNIOS`) : '';
    s.querySelector('[data-tudo]').hidden = vazia(v);
  }
  // painel -------------------------------------------------------
  alternar(v = !this.aberto) { this.e.hidden = !v; document.body.classList.toggle('visao-aberta', v); if (v) { this.rasc = JSON.parse(JSON.stringify({ ...this.atual })); this.carregarListas().then(() => this._render()); this._render(); } }
  _render() {
    const r = this.rasc, P = this.projetos; const tem = (k, x) => (r[k] || []).includes(x);
    const per = r.desde ? Math.round((Date.now() - r.desde) / DIA) : 0; const perSel = !r.desde && !r.ate ? 'tudo' : [7, 30, 90].includes(per) && !r.ate ? String(per) : 'pers';
    const tagsTop = this._tagsTop();
    this.e.innerHTML = `<div class="cab"><span>VISÃO // FILTROS</span><button class="btn-mini" data-fechar>V / ESC FECHAR</button></div>
      <div class="pv-corpo">
      <div class="pv-rot">VISÕES SALVAS</div><div class="pv-chips">${this.salvas.map(s => `<button class="chip${s.id === this.atual.id ? ' on' : ''}" data-salva="${esc(s.id)}">${esc(s.nome)}</button>`).join('')}</div>
      <div class="pv-rot">PROJETOS <span>${P.length}</span></div><div class="pv-lista">${P.map(p => `<label class="ck"><input type="checkbox" data-k="projetos" value="${esc(p.nome)}" ${tem('projetos', p.nome) ? 'checked' : ''}><span>${esc(String(p.nome).toUpperCase())}</span><b>${fmtN(p.neuronios)}</b></label>`).join('') || '<div class="apagado">—</div>'}</div>
      <div class="pv-rot">FONTES</div><div class="pv-chips">${FONTES.map(([k, t]) => `<label class="ck chipck"><input type="checkbox" data-k="fontes" value="${k}" ${tem('fontes', k) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <div class="pv-rot">TIPOS</div><div class="pv-chips">${TIPOS.map(([k, t]) => `<label class="ck chipck"><input type="checkbox" data-k="tipos" value="${k}" ${tem('tipos', k) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <div class="pv-rot">PERÍODO</div><div class="pv-seg">${[['7', '7D'], ['30', '30D'], ['90', '90D'], ['tudo', 'TUDO'], ['pers', 'PERSONALIZADO']].map(([k, t]) => `<button data-per="${k}" class="${perSel === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="pv-datas" ${perSel === 'pers' ? '' : 'hidden'}><label>DESDE<input type="date" data-data="desde" value="${r.desde ? fmtData(r.desde) : ''}"></label><label>ATÉ<input type="date" data-data="ate" value="${r.ate ? fmtData(r.ate) : ''}"></label></div>
      <div class="pv-rot">TAGS DA MÁQUINA</div><input class="pv-in" data-tags placeholder="TAG1, TAG2 (QUALQUER UMA)" value="${esc((r.tags || []).join(', '))}"><div class="pv-chips mini">${tagsTop.map(t => `<button class="chip${tem('tags', t) ? ' on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
      <div class="pv-rot">GRAU MÍNIMO <span data-grauv>${r.grauMin || 0}</span></div><input type="range" min="0" max="60" step="1" value="${r.grauMin || 0}" data-grau>
      <div class="pv-rot">TEXTO NO TÍTULO OU CAMINHO</div><input class="pv-in" data-texto placeholder="EX.: SYNC" value="${esc(r.texto || '')}">
      <div class="pv-rot">VIZINHOS DE FORA DO FILTRO</div><div class="pv-seg">${[0, 1, 2].map(k => `<button data-viz="${k}" class="${(r.vizinhos || 0) === k ? 'on' : ''}">${k} SALTO${k === 1 ? '' : 'S'}</button>`).join('')}</div>
      <div class="pv-desc">${esc(descrever(r))}</div>
      </div>
      <div class="pv-acoes"><button class="prim" data-aplicar>APLICAR ▸</button><button data-limpar>TUDO</button><button data-salvar>SALVAR COMO…</button><button data-excluir ${this.salvas.some(s => s.id === this.atual.id && s.id !== 'tudo') ? '' : 'disabled'}>EXCLUIR</button></div>
      <form class="pv-salvar" data-form hidden><input placeholder="NOME DA VISÃO" data-nome value="${esc(r.nome && r.nome !== 'PERSONALIZADA' ? r.nome : '')}"><button>SALVAR</button></form>`;
    const E = this.e;
    E.querySelector('[data-fechar]').onclick = () => this.alternar(false);
    E.querySelectorAll('[data-salva]').forEach(b => b.onclick = () => { const s = this.salvas.find(x => x.id === b.dataset.salva); this.rasc = JSON.parse(JSON.stringify(s)); this.aplicar(s); });
    E.querySelectorAll('input[type=checkbox][data-k]').forEach(c => c.onchange = () => { const k = c.dataset.k; const l = new Set(r[k] || []); c.checked ? l.add(c.value) : l.delete(c.value); r[k] = [...l]; this._desc(); });
    E.querySelectorAll('[data-per]').forEach(b => b.onclick = () => { const k = b.dataset.per; if (k === 'tudo') { delete r.desde; delete r.ate; } else if (k !== 'pers') { r.desde = Date.now() - (+k) * DIA; delete r.ate; } else if (!r.desde) r.desde = Date.now() - 14 * DIA; this._render(); });
    E.querySelectorAll('[data-data]').forEach(i => i.onchange = () => { const t = i.value ? Date.parse(i.value + 'T00:00:00') + (i.dataset.data === 'ate' ? DIA - 1 : 0) : 0; if (t) r[i.dataset.data] = t; else delete r[i.dataset.data]; this._desc(); });
    E.querySelector('[data-tags]').oninput = ev => { r.tags = ev.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean); this._desc(); };
    E.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { const l = new Set(r.tags || []); l.has(b.dataset.tag) ? l.delete(b.dataset.tag) : l.add(b.dataset.tag); r.tags = [...l]; this._render(); });
    E.querySelector('[data-grau]').oninput = ev => { r.grauMin = +ev.target.value || undefined; E.querySelector('[data-grauv]').textContent = ev.target.value; this._desc(); };
    E.querySelector('[data-texto]').oninput = ev => { r.texto = ev.target.value.trim() || undefined; this._desc(); };
    E.querySelectorAll('[data-viz]').forEach(b => b.onclick = () => { r.vizinhos = +b.dataset.viz || undefined; this._render(); });
    E.querySelector('[data-aplicar]').onclick = () => { const v = { ...r, id: 'ad-hoc', nome: 'PERSONALIZADA' }; const s = this.salvas.find(x => x.id !== 'tudo' && mesma(x, v)); this.aplicar(s || (vazia(v) ? TUDO : v)); };
    E.querySelector('[data-limpar]').onclick = () => { this.rasc = { ...TUDO }; this.aplicar(TUDO); };
    E.querySelector('[data-salvar]').onclick = () => { const f = E.querySelector('[data-form]'); f.hidden = false; f.querySelector('input').focus(); };
    E.querySelector('[data-form]').onsubmit = async ev => { ev.preventDefault(); const nome = E.querySelector('[data-nome]').value.trim().toUpperCase(); if (!nome) return; const v = { ...this.rasc, id: 'v-' + nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), nome }; delete v._soId;
      try { const res = await fetch('/api/visoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) }); if (res.ok) { const s = await res.json().catch(() => v); await this.carregarListas(); this.aplicar(s && s.id ? s : v); } } catch {} };
    E.querySelector('[data-excluir]').onclick = async () => { const id = this.atual.id; if (id === 'tudo') return; try { await fetch('/api/visoes/' + encodeURIComponent(id), { method: 'DELETE' }); } catch {} await this.carregarListas(); this.aplicar(TUDO); };
  }
  _desc() { const d = this.e.querySelector('.pv-desc'); if (d) d.textContent = descrever(this.rasc); }
  _tagsTop() { const g = this.app.g; if (!g) return []; const m = new Map(); for (const n of g.nos) for (const t of n.tags || []) { const k = String(t).toUpperCase(); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, 14).map(x => x[0]); }
}
