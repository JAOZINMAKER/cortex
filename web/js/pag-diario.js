// DIÁRIO: entradas registradas pelas sessões (fonte "diario"), filtro por projeto e autor.
import { marked } from 'marked';
import { esc, fmtN, fmtRel, fmtDataHora } from './util.js';
import { obter } from './dados.js';

export function cartaoDiario(x) {
  const tags = x.tagsAutor || x.tags || [];
  return `<article class="dc" data-id="${esc(x.id)}"><div class="dc-cab"><div class="dc-id">${esc(x.idCurto || String(x.id).slice(0, 6))}</div>
    <div class="dc-tit"><h3>${esc(x.titulo)}</h3><div class="dc-meta"><span class="dc-proj">${esc(String(x.projeto || x.regiao || '').replace(/^r_/, '').toUpperCase())}</span><span>REGISTRADO POR <b>${esc(x.autor || '—')}</b></span><span>${fmtDataHora(x.criado)} · ${fmtRel(x.criado)}</span>${tags.map(t => `<span class="tg">#${esc(t)}</span>`).join('')}</div></div>
    <div class="dc-btns"><button class="btn-mini" data-ler>LER ▾</button><button class="btn-mini" data-cerebro>NO CÉREBRO ▸</button></div></div><div class="dc-corpo" hidden></div></article>`;
}
export function ligarCartoesDiario(raiz, app, shell) {
  raiz.querySelectorAll('.dc').forEach(c => {
    const id = c.dataset.id, corpo = c.querySelector('.dc-corpo');
    c.querySelector('[data-ler]').onclick = async b => { if (!corpo.hidden) { corpo.hidden = true; return; } corpo.hidden = false; corpo.innerHTML = '<span class="cursor">_</span>';
      try { const d = await obter('/api/no/' + encodeURIComponent(id)); const md = String(d.conteudo?.corpo || '').replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (m, a, _, b2) => `**${b2 || a}**`); corpo.innerHTML = `<div class="md">${marked.parse(md)}</div>${d.saida?.length ? `<div class="dc-lig">LIGA A: ${d.saida.slice(0, 12).map(s => `<a data-ir="${esc(s.id)}">${esc(s.titulo)}</a>`).join(' · ')}</div>` : ''}`; corpo.querySelectorAll('[data-ir]').forEach(a => a.onclick = () => app.abrirNoCerebro(a.dataset.ir)); }
      catch (e) { corpo.textContent = 'FALHOU: ' + e.message; } };
    c.querySelector('[data-cerebro]').onclick = () => app.abrirNoCerebro(id);
  });
}

export class PaginaDiario {
  constructor(app, shell) { this.app = app; this.shell = shell; this.proj = ''; this.autor = ''; this.q = ''; }
  async render(el) {
    el.innerHTML = '<div class="pg-vazio">LENDO O DIÁRIO<span class="cursor">_</span></div>';
    let d; try { d = await obter('/api/listar?fontes=diario&limite=500&ordem=recente'); } catch (e) { el.innerHTML = `<div class="pg-vazio alerta">FALHOU: ${esc(e.message)}</div>`; return; }
    const it = (d.itens || []).filter(x => x.fonte === 'diario' || x.tipo === 'nota'); this.itens = it;
    this._render(el);
  }
  _render(el) {
    const it = this.itens; const projs = [...new Set(it.map(x => x.projeto || String(x.regiao || '').replace(/^r_/, '')))].sort(), autores = [...new Set(it.map(x => x.autor || '—'))].sort();
    const q = this.q.toLowerCase(); const f = it.filter(x => (!this.proj || (x.projeto || String(x.regiao).replace(/^r_/, '')) === this.proj) && (!this.autor || (x.autor || '—') === this.autor) && (!q || x.titulo.toLowerCase().includes(q)));
    const porAutor = new Map(); for (const x of it) porAutor.set(x.autor || '—', (porAutor.get(x.autor || '—') || 0) + 1);
    el.innerHTML = `<div class="pg-cab"><div><div class="pg-sup">SEÇÃO 03 // REGISTROS DAS SESSÕES · NUNCA EDITA OS COFRES</div><h1>DIÁRIO</h1></div>
      <div class="pg-ferr"><input class="pv-in" data-q placeholder="FILTRAR POR TÍTULO" value="${esc(this.q)}"><select class="pv-in" data-proj><option value="">TODOS OS PROJETOS</option>${projs.map(p => `<option ${p === this.proj ? 'selected' : ''} value="${esc(p)}">${esc(p.toUpperCase())}</option>`).join('')}</select><select class="pv-in" data-autor><option value="">TODOS OS AUTORES</option>${autores.map(a => `<option ${a === this.autor ? 'selected' : ''} value="${esc(a)}">${esc(a.toUpperCase())}</option>`).join('')}</select></div></div>
      <div class="dg"><div class="dg-lista"><div class="pg-rot">${fmtN(f.length)} DE ${fmtN(it.length)} ENTRADAS</div>${f.map(cartaoDiario).join('') || `<div class="pg-vazio">NENHUMA ENTRADA AINDA.<br><br>AS SESSÕES DO CLAUDE CODE REGISTRAM COM <code>cortex registrar --projeto X --titulo "…" --texto "…"</code> OU PELA SKILL <a href="#/skills/cortex-registrar">CORTEX-REGISTRAR</a>.</div>`}</div>
      <aside class="dg-lado"><div class="pg-rot">AUTORES</div>${[...porAutor].sort((a, b) => b[1] - a[1]).map(([a, n]) => `<div class="dg-l"><span>${esc(a.toUpperCase())}</span><b>${n}</b></div>`).join('') || '<div class="apagado">—</div>'}
      <div class="pg-rot">POR PROJETO</div>${projs.map(p => `<div class="dg-l"><span>${esc(p.toUpperCase())}</span><b>${it.filter(x => (x.projeto || String(x.regiao).replace(/^r_/, '')) === p).length}</b></div>`).join('') || '<div class="apagado">—</div>'}</aside></div>`;
    el.querySelector('[data-q]').oninput = ev => { this.q = ev.target.value; this._render(el); const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    el.querySelector('[data-proj]').onchange = ev => { this.proj = ev.target.value; this._render(el); };
    el.querySelector('[data-autor]').onchange = ev => { this.autor = ev.target.value; this._render(el); };
    ligarCartoesDiario(el, this.app, this.shell);
  }
}
