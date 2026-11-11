// Casca do app: barra de título, barra lateral, roteamento por hash e migalhas.
// Rotas: #/cerebro · #/projetos · #/projetos/<nome>/<aba> · #/diario · #/skills[/<nome>] · #/config/<sub>
import { $, esc } from './util.js';
import { PaginaProjetos } from './pag-projetos.js';
import { PaginaDiario } from './pag-diario.js';
import { PaginaSkills } from './pag-skills.js';
import { PaginaConfig, SUBS } from './pag-config.js';

export const ICONES = {
  cerebro: '<svg viewBox="0 0 16 16"><path d="M7.5 2.5H4.5L2 5v6l2.5 2.5h3zM8.5 2.5h3L14 5v6l-2.5 2.5h-3z" fill="none" stroke="currentColor"/><path d="M5 6h1.5M5 9h1.5M9.5 7.5H11M9.5 10.5H11" stroke="currentColor"/></svg>',
  projetos: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" fill="none" stroke="currentColor"/><rect x="9" y="2" width="5" height="5" fill="currentColor"/><rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor"/><rect x="9" y="9" width="5" height="5" fill="none" stroke="currentColor"/></svg>',
  diario: '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h7l2 2v11h-9z" fill="none" stroke="currentColor"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor"/><path d="M3.5 1.5v13" stroke="currentColor" stroke-width="2"/></svg>',
  skills: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor"/><path d="M6 1v2.5M10 1v2.5M6 12.5V15M10 12.5V15M1 6h2.5M1 10h2.5M12.5 6H15M12.5 10H15" stroke="currentColor"/><path d="M8.6 5.5 6.5 8.4h2.6L7.4 10.8" fill="none" stroke="currentColor"/></svg>',
  config: '<svg viewBox="0 0 16 16"><path d="M1.5 4h3M8.5 4h6M1.5 8h7M12.5 8h2M1.5 12h4M9.5 12h5" stroke="currentColor"/><rect x="4.5" y="2.5" width="4" height="3" fill="currentColor"/><rect x="8.5" y="6.5" width="4" height="3" fill="none" stroke="currentColor"/><rect x="5.5" y="10.5" width="4" height="3" fill="none" stroke="currentColor"/></svg>',
  recolher: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor"/><path d="M2.5 2v12" stroke="currentColor"/></svg>',
};
const SECOES = [['cerebro', 'CÉREBRO', '1'], ['projetos', 'PROJETOS', '2'], ['diario', 'DIÁRIO', '3'], ['skills', 'SKILLS', '4'], ['config', 'CONFIGURAÇÕES', '5']];
export const ABAS = [['cerebro', 'CÉREBRO'], ['atividade', 'ATIVIDADE'], ['resumo', 'RESUMO'], ['fontes', 'FONTES'], ['diario', 'DIÁRIO']];

export class Shell {
  constructor(app) {
    this.app = app; this.rota = { secao: 'cerebro' };
    this.pag = $('#sec-pagina'); this.cer = $('#sec-cerebro');
    this.paginas = { projetos: new PaginaProjetos(app, this), diario: new PaginaDiario(app, this), skills: new PaginaSkills(app, this), config: new PaginaConfig(app, this) };
    this._lateral(); this._titulo();
    addEventListener('hashchange', () => this.rotear());
  }
  // ------------------------------------------------------------------ barra de título
  _titulo() {
    const J = window.cortexApp && window.cortexApp.janela; const box = $('#tb-janela');
    if (J) { box.hidden = false; box.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { try { J[b.dataset.j](); } catch {} }); document.body.classList.add('app-desktop'); }
    $('#tb-cmd').onclick = () => this.app.comando.abrir();
    $('#tb').addEventListener('dblclick', ev => { if (J && ev.target.closest('.tb-arrasto, .migalhas')) try { J.max(); } catch {} });
  }
  _lateral() {
    const sb = $('#sb');
    sb.innerHTML = `<div class="sb-itens">${SECOES.map(([k, t, n]) => `<a class="sb-it" data-s="${k}" href="#/${k === 'config' ? 'config/geral' : k}" title="${t} [ALT+${n}]"><i>${ICONES[k]}</i><span>${t}</span><kbd>${n}</kbd></a>`).join('')}</div>
      <div class="sb-proj" id="sb-proj"></div>
      <div class="sb-pe"><div class="sb-st" id="sb-st"><b class="pisca">●</b><span>LOCAL</span></div><button class="sb-rec" id="sb-rec" title="RECOLHER / EXPANDIR [ALT+0]"><i>${ICONES.recolher}</i><span>RECOLHER</span></button></div>`;
    $('#sb-rec').onclick = () => this.alternarLateral();
  }
  alternarLateral() { this.app.ajustes.set('lateralRecolhida', !this.app.ajustes.a.lateralRecolhida); }
  aoAjustar() { requestAnimationFrame(() => dispatchEvent(new Event('resize'))); this._projLateral(); }
  _projLateral() {
    const a = this.app.ajustes.a; const fav = a.projetosFav || []; const box = $('#sb-proj'); if (!box) return;
    box.innerHTML = fav.length ? `<div class="sb-rot">FIXADOS</div>${fav.map(p => `<a class="sb-pj${this.rota.projeto === p ? ' on' : ''}" href="#/projetos/${encodeURIComponent(p)}/cerebro" title="${esc(p)}"><b>★</b><span>${esc(String(p).toUpperCase())}</span></a>`).join('')}` : '';
  }
  // ------------------------------------------------------------------ rotas
  ir(h) { if (location.hash === h) this.rotear(); else location.hash = h; }
  parse() {
    const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const s = p[0] || 'cerebro';
    if (s === 'projetos' && p[1]) return { secao: 'projetos', projeto: p[1], aba: p[2] || 'cerebro' };
    if (s === 'skills') return { secao: 'skills', skill: p[1] };
    if (s === 'config') return { secao: 'config', sub: SUBS.some(x => x[0] === p[1]) ? p[1] : 'geral' };
    if (['projetos', 'diario', 'cerebro'].includes(s)) return { secao: s };
    return { secao: 'cerebro' };
  }
  rotear() {
    const r = this.parse(), ant = this.rota; this.rota = r; const app = this.app;
    const noCerebro = r.secao === 'cerebro' || (r.secao === 'projetos' && r.projeto && r.aba === 'cerebro');
    // o 3D continua vivo; só pausa o desenho quando sai da tela
    this.cer.classList.toggle('fora', !noCerebro); app.cerebro.pausado = !noCerebro; this.pag.hidden = noCerebro;
    if (noCerebro) { requestAnimationFrame(() => dispatchEvent(new Event('resize'))); app.cerebro.camMudou = true; }
    document.querySelectorAll('.sb-it').forEach(a => a.classList.toggle('on', a.dataset.s === r.secao));
    // barra do projeto em cima do cérebro
    const pb = $('#proj-barra');
    if (r.secao === 'projetos' && r.projeto && r.aba === 'cerebro') {
      pb.hidden = false; this.paginas.projetos.barra(pb, r.projeto); document.body.classList.add('com-proj-barra');
      const v = app.visoes.atual; if (!(v.projetos && v.projetos.length === 1 && v.projetos[0] === r.projeto) && app.g) app.visoes.isolarProjeto(r.projeto);
    } else { pb.hidden = true; document.body.classList.remove('com-proj-barra'); }
    app.relayout();
    if (!noCerebro) {
      const P = this.paginas[r.secao]; this.pag.className = 'sec pagina pg-' + r.secao; this.pag.scrollTop = 0;
      if (P) P.render(this.pag, r, ant);
    }
    this.migalhas(); this._projLateral();
  }
  migalhas() {
    const r = this.rota; const it = [['#/cerebro', 'CÓRTEX']];
    const nome = { cerebro: 'CÉREBRO', projetos: 'PROJETOS', diario: 'DIÁRIO', skills: 'SKILLS', config: 'CONFIGURAÇÕES' }[r.secao];
    if (r.secao !== 'cerebro') it.push([r.secao === 'config' ? '#/config/geral' : '#/' + r.secao, nome]); else it.push(['#/cerebro', 'CÉREBRO']);
    if (r.projeto) { it.push([`#/projetos/${encodeURIComponent(r.projeto)}/cerebro`, String(r.projeto).toUpperCase()]); it.push([location.hash, (ABAS.find(a => a[0] === r.aba) || ['', r.aba.toUpperCase()])[1]]); }
    if (r.skill) it.push([location.hash, r.skill.toUpperCase()]);
    if (r.secao === 'config') it.push([location.hash, (SUBS.find(s => s[0] === r.sub) || ['', ''])[1]]);
    if (r.secao === 'cerebro' && this.app.visoes && this.app.visoes.atual && this.app.visoes.atual.id !== 'tudo') it.push(['#/cerebro', 'VISÃO ' + (this.app.visoes.atual.nome || '').toUpperCase()]);
    $('#migalhas').innerHTML = it.map(([h, t], k) => `${k ? '<i>/</i>' : ''}<a href="${esc(h)}" class="${k === it.length - 1 ? 'on' : ''}">${esc(t)}</a>`).join('');
  }
  // ações para a barra de comando
  acoes() {
    const A = []; const go = h => () => this.ir(h);
    for (const [k, t, n] of SECOES) A.push(['ir ' + k + ' ' + t.toLowerCase(), 'IR PARA ' + t, 'ALT+' + n, go(k === 'config' ? '#/config/geral' : '#/' + k)]);
    for (const [k, t] of SUBS) A.push(['config configuracoes ' + k + ' ' + t.toLowerCase(), 'CONFIGURAÇÕES › ' + t, 'CONFIG', go('#/config/' + k)]);
    for (const p of this.app.visoes.projetos || []) { const n = String(p.nome); for (const [a, t] of ABAS) A.push([`abrir projeto ${n.toLowerCase()} ${a}`, `PROJETO ${n.toUpperCase()} › ${t}`, (p.neuronios || 0) + ' NEURÔNIOS', go(`#/projetos/${encodeURIComponent(n)}/${a}`)]); }
    for (const s of this.paginas.skills.lista || []) A.push(['skill ' + s.nome, 'SKILL ' + String(s.titulo || s.nome).toUpperCase(), s.executavel ? 'EXECUTÁVEL' : 'SKILL', go('#/skills/' + encodeURIComponent(s.nome))]);
    A.push(['recolher lateral barra', 'RECOLHER/EXPANDIR BARRA LATERAL', 'ALT+0', () => this.alternarLateral()]);
    return A;
  }
  tecla(ev) {
    if (!ev.altKey) return false; const k = ev.key;
    if (k >= '1' && k <= '5') { const s = SECOES[+k - 1][0]; this.ir(s === 'config' ? '#/config/geral' : '#/' + s); return true; }
    if (k === '0') { this.alternarLateral(); return true; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && this.rota.projeto) { this.paginas.projetos.vizinho(this.rota.projeto, k === 'ArrowRight' ? 1 : -1, this.rota.aba); return true; }
    return false;
  }
}
