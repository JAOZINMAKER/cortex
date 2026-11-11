// SKILLS: cartões com status no Claude Code, instalar/atualizar/remover, ver SKILL.md e EXECUTAR AQUI.
import { marked } from 'marked';
import { esc, fmtN } from './util.js';
import { obter, enviar } from './dados.js';

const STATUS = { instalada: ['INSTALADA', 'ok'], desatualizada: ['DESATUALIZADA', 'aviso'], nao: ['NÃO INSTALADA', 'nao'] };
const status = s => s.status === 'desatualizada' || s.desatualizada ? 'desatualizada' : !s.instalada ? 'nao' : (s.versaoInstalada != null && s.versaoApp != null && String(s.versaoInstalada) !== String(s.versaoApp)) ? 'desatualizada' : 'instalada';

export class PaginaSkills {
  constructor(app, shell) { this.app = app; this.shell = shell; this.lista = []; this.resultado = {}; }
  async carregar() { const d = await obter('/api/skills'); this.lista = Array.isArray(d) ? d : d.skills || []; return this.lista; }
  async render(el, r) {
    el.innerHTML = '<div class="pg-vazio">LENDO SKILLS<span class="cursor">_</span></div>';
    try { await this.carregar(); } catch (e) { el.innerHTML = `<div class="pg-vazio alerta">/api/skills INDISPONÍVEL (${esc(e.message)})</div>`; return; }
    if (!this.app.visoes.projetos.length) await this.app.visoes.carregarListas();
    const sel = r.skill; const inst = this.lista.filter(s => status(s) !== 'nao').length;
    el.innerHTML = `<div class="pg-cab"><div><div class="pg-sup">SEÇÃO 04 // ${this.lista.length} SKILLS · ${inst} NO CLAUDE CODE · %USERPROFILE%\\.claude\\skills</div><h1>SKILLS</h1></div>
      <div class="pg-ferr"><button class="btn-acao" data-todas>INSTALAR / ATUALIZAR TODAS</button></div></div>
      <div class="sk-grade">${this.lista.map(s => this._cartao(s, sel === s.nome)).join('')}</div>`;
    el.querySelector('[data-todas]').onclick = async b => { for (const s of this.lista) if (status(s) !== 'instalada') { try { await enviar(`/api/skills/${encodeURIComponent(s.nome)}/instalar`); } catch {} } this.render(el, r); };
    this._ligar(el, r);
    if (sel) { const c = el.querySelector(`[data-sk="${CSS.escape(sel)}"]`); if (c) c.scrollIntoView({ block: 'start' }); }
  }
  _cartao(s, aberto) {
    const st = status(s), [rot, cls] = STATUS[st]; const pr = s.parametros || [];
    const projs = this.app.visoes.projetos.map(p => p.nome);
    const res = this.resultado[s.nome];
    return `<article class="sk${aberto ? ' sel' : ''}" data-sk="${esc(s.nome)}">
      <div class="sk-cab"><div class="sk-ic">${s.executavel ? '▶' : '◆'}</div><div class="sk-tit"><div class="pg-sup">${esc(s.nome)}${s.versaoApp ? ' · V' + esc(s.versaoApp) : ''}</div><h2>${esc(String(s.titulo || s.nome).toUpperCase())}</h2></div><span class="sk-st ${cls}">${rot}${s.versaoInstalada && st === 'desatualizada' ? ' · V' + esc(s.versaoInstalada) : ''}</span></div>
      <p class="sk-desc">${esc(s.descricao || '')}</p>
      <div class="sk-btns">${st === 'nao' ? '<button class="btn-acao" data-inst>INSTALAR</button>' : st === 'desatualizada' ? '<button class="btn-acao" data-inst>ATUALIZAR</button>' : '<button data-inst>REINSTALAR</button>'}${st !== 'nao' ? '<button data-rem>REMOVER</button>' : ''}<button data-ver>VER SKILL.md</button>${s.executavel ? '<button class="btn-exec" data-abrir-exec>EXECUTAR AQUI ▸</button>' : ''}</div>
      ${s.caminho ? `<div class="sk-cam">${esc(s.caminho)}</div>` : ''}
      ${s.executavel ? `<form class="sk-form" data-exec ${aberto || res ? '' : 'hidden'}><div class="pg-rot">PARÂMETROS · RODA NO SERVIDOR, DETERMINÍSTICO (SEM IA)</div><div class="sk-params">${(pr.length ? pr : [{ nome: 'projeto', tipo: 'projeto' }]).map(p => this._param(p, projs)).join('')}</div><button class="btn-exec">EXECUTAR</button></form>` : ''}
      <div class="sk-res" ${res ? '' : 'hidden'}>${res ? this._res(res) : ''}</div>
      <div class="sk-md" hidden></div></article>`;
  }
  _param(p, projs) {
    const id = esc(p.nome), rot = esc(String(p.titulo || p.nome).toUpperCase());
    if (p.tipo === 'projeto') return `<label>${rot}<select name="${id}" class="pv-in">${projs.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>`;
    if (p.opcoes) return `<label>${rot}<select name="${id}" class="pv-in">${p.opcoes.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>`;
    if (p.tipo === 'numero' || p.tipo === 'number') return `<label>${rot}<input name="${id}" type="number" class="pv-in" value="${esc(p.padrao ?? 7)}"></label>`;
    if (p.tipo === 'booleano' || p.tipo === 'boolean') return `<label class="ck"><input type="checkbox" name="${id}" ${p.padrao ? 'checked' : ''}><span>${rot}</span></label>`;
    return `<label>${rot}<input name="${id}" class="pv-in" value="${esc(p.padrao ?? '')}"></label>`;
  }
  _res(r) { if (r.erro) return `<div class="alerta">FALHOU: ${esc(r.erro)}</div>`; return `<div class="pg-rot">RESULTADO${r.registradoEm ? ` · REGISTRADO NO DIÁRIO: <span class="maquina-c">${esc(r.registradoEm.caminho || r.registradoEm.id || r.registradoEm)}</span>` : ''}</div><div class="md">${marked.parse(String(r.markdown || ''))}</div>`; }
  _ligar(el, r) {
    el.querySelectorAll('.sk').forEach(c => {
      const nome = c.dataset.sk, s = this.lista.find(x => x.nome === nome); const Q = `/api/skills/${encodeURIComponent(nome)}`;
      const b = sel => c.querySelector(sel);
      b('[data-inst]') && (b('[data-inst]').onclick = async ev => { ev.target.textContent = '…'; try { await enviar(Q + '/instalar'); } catch (e) { alert0(c, e); } this.render(el, r); });
      b('[data-rem]') && (b('[data-rem]').onclick = async ev => { ev.target.textContent = '…'; try { await enviar(Q + '/remover'); } catch (e) { alert0(c, e); } this.render(el, r); });
      b('[data-ver]').onclick = async () => { const box = b('.sk-md'); if (!box.hidden) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '<span class="cursor">_</span>';
        let md = s.skillMd || s.conteudo; if (!md) { for (const u of [Q, Q + '/skill.md']) { try { const x = await obter(u); md = typeof x === 'string' ? x : x.skillMd || x.conteudo; if (md) break; } catch {} } }
        box.innerHTML = md ? `<div class="pg-rot">SKILL.md</div><div class="md">${marked.parse(String(md).replace(/^---\n([\s\S]*?)\n---/, '```yaml\n$1\n```'))}</div>` : `<div class="apagado">SKILL.md EM ${esc(s.caminho || 'skills/' + nome)}</div>`; };
      b('[data-abrir-exec]') && (b('[data-abrir-exec]').onclick = () => { const f = b('[data-exec]'); f.hidden = !f.hidden; });
      const f = b('[data-exec]'); if (f) f.onsubmit = async ev => {
        ev.preventDefault(); const corpo = {}; for (const i of f.querySelectorAll('[name]')) corpo[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value;
        const box = b('.sk-res'); box.hidden = false; box.innerHTML = `<div class="pg-rot">EXECUTANDO ${esc(nome.toUpperCase())}<span class="cursor">_</span></div>`;
        try { this.resultado[nome] = await enviar(Q + '/executar', corpo); } catch (e) { this.resultado[nome] = { erro: e.corpo?.erro || e.message }; }
        box.innerHTML = this._res(this.resultado[nome]);
      };
    });
  }
}
function alert0(c, e) { const d = document.createElement('div'); d.className = 'alerta'; d.textContent = 'FALHOU: ' + (e.corpo?.erro || e.message); c.appendChild(d); }
