// SINCRONIZAÇÃO entre PCs: estado (/api/sync), indicador na barra de título e tela de boas-vindas.
import { $, esc, fmtN, fmtRel } from './util.js';
import { obter, enviar } from './dados.js';

const SEP = c => String(c).includes('\\') ? '\\' : '/';
const semFim = c => String(c).replace(/[\\/]+$/, '');
const norm = c => semFim(c).replace(/\\/g, '/').toLowerCase();
// sugestão do OneDrive e pasta recomendada (<OneDrive>\CORTEX)
export function oneDrive(s) {
  const sug = (s?.sugestoes || []).find(x => /onedrive/i.test(x.rotulo || '') || /onedrive/i.test(x.caminho || ''));
  const naPasta = !!(s?.ativo && s.pasta && /onedrive/i.test(s.pasta));
  if (!sug && !naPasta) return null;
  const pasta = sug ? semFim(sug.caminho) + SEP(sug.caminho) + 'CORTEX' : s.pasta;
  const ativoNele = !!(s.ativo && s.pasta && (naPasta || (sug && (norm(s.pasta) === norm(sug.caminho) || norm(s.pasta).startsWith(norm(sug.caminho) + '/')))));
  return { sug, pasta, ativoNele };
}
// bloco grande do OneDrive (SINCRONIZAÇÃO e tela de boas-vindas)
export function blocoOneDrive(s, compacto) {
  const od = oneDrive(s); const ms = s?.maquinas || []; const n = Math.max(1, ms.length);
  const conta = '';
  if (od && od.ativoNele) return `<div class="od od-ok"><div class="od-ic">●</div><div class="od-t"><b>SINCRONIZANDO PELO ONEDRIVE · ${n} PC${n > 1 ? '<i>s</i>' : ''}</b><span>NADA A FAZER NOS OUTROS PCs ALÉM DE INSTALAR O CÓRTEX. ELES ENTRAM SOZINHOS.</span><em>${esc(s.pasta)}${ms.length ? ' · ' + ms.map(m => esc(m.nome) + (m.eu ? ' (ESTE)' : '')).join(' · ') : ''}</em>${conta}</div></div>`;
  if (od) return `<div class="od"><button class="od-btn" data-od-usar="${esc(od.pasta)}"><span class="od-ic">▶</span><b>USAR ONEDRIVE${gh(s) ? '' : '<br>(RECOMENDADO)'}</b><span>1 CLIQUE · LIGA A SINCRONIZAÇÃO EM <code>${esc(od.pasta)}</code></span></button><div class="od-t"><span>${s?.ativo ? 'Hoje a sincronização está em outra pasta: ' + esc(s.pasta) + '.' : 'O OneDrive já está neste PC.'} Só serve se os outros PCs enxergarem esta mesma pasta do OneDrive.</span>${conta}</div></div>`;
  return compacto ? '' : `<div class="od od-sem"><div class="od-t"><b>ONEDRIVE NÃO ENCONTRADO NESTE PC</b><span>Escolha outra pasta que sincronize entre os PCs, ou use um pacote avulso.</span></div></div>`;
}
// ------------------------------------------------------------------ GitHub (V6): sincroniza pela conta do usuário, repo privado
export const gh = s => !!(s && (s.modo === 'github' || (s.github && s.modo !== 'pasta')) && s.github);
const GH_SVG = '<svg viewBox="0 0 16 16" class="gh-logo"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
export function blocoGithub(s, compacto) {
  const g = s.github || {}; const ms = s.maquinas || []; const n = Math.max(1, ms.length); const repo = g.repo || 'cortex-dados';
  const quando = (t, rot) => t ? `<span>${rot} <b>${fmtRel(typeof t === 'object' ? t.em : t)}</b></span>` : '';
  if (g.estado === 'PRECISA_ENTRAR') return `<div class="gh gh-entrar">${GH_SVG}<button class="gh-btn" data-gh-entrar><b>ENTRAR NO GITHUB</b><span>uma vez em cada PC; abre o navegador</span></button>
    <div class="gh-t"><span>Os seus PCs se juntam pela sua conta do GitHub, num repositório privado <code>${esc(repo)}</code> que só você vê. Não importa qual OneDrive cada PC usa.</span>${ms.length > 1 ? `<em>JÁ CONECTADOS: ${ms.filter(m => !m.eu).map(m => esc(m.nome)).join(' · ')}</em>` : ''}<div class="gh-msg" data-gh-msg></div></div></div>`;
  if (g.estado === 'SEM_GIT') return `<div class="gh gh-sem">${GH_SVG}<div class="gh-t"><b>FALTA O GIT NESTE PC</b><span>Instale o Git (<a href="https://git-scm.com" target="_blank" rel="noopener">git-scm.com</a>) e reabra o CÓRTEX.</span><em>O CÓRTEX USA O GIT PARA GUARDAR O CÉREBRO NO SEU REPOSITÓRIO PRIVADO.</em></div></div>`;
  if (g.estado === 'ERRO') return `<div class="gh gh-erro">${GH_SVG}<div class="gh-t"><b>A SINCRONIZAÇÃO PELO GITHUB DEU ERRO</b><span>${esc(g.erro || 'erro desconhecido')}</span>${compacto ? '' : '<button class="btn-mini" data-gh-entrar>ENTRAR DE NOVO NO GITHUB</button>'}<div class="gh-msg" data-gh-msg></div></div></div>`;
  return `<div class="gh gh-ok">${GH_SVG}<div class="gh-t"><div class="gh-linha"><span>CONTA GITHUB</span><b>${esc(String(g.usuario || '—').toUpperCase())}</b><i>·</i><span>REPOSITÓRIO PRIVADO</span><b class="gh-repo">${esc(repo)}</b><i>·</i><b class="gh-n">${n} PC${n > 1 ? '<i class="min">s</i>' : ''} CONECTADO${n > 1 ? 'S' : ''}</b></div>
    <div class="gh-sub">${quando(g.ultimoFetch, 'RECEBIDO HÁ')}${quando(g.ultimoPush, 'ENVIADO HÁ')}<span>NOS OUTROS PCs: INSTALE O CÓRTEX E ENTRE NA MESMA CONTA DO GITHUB.</span></div></div></div>`;
}
export function ligarGithub(raiz, sync, depois) {
  raiz.querySelectorAll('[data-gh-entrar]').forEach(b => b.onclick = async () => {
    const msg = raiz.querySelector('[data-gh-msg]'); b.disabled = true; const t0 = b.innerHTML; const bb = b.querySelector('b'); if (bb) bb.textContent = 'ABRINDO O NAVEGADOR…';
    try { await enviar('/api/sync/github/entrar', {}); if (msg) msg.innerHTML = 'TERMINE O LOGIN NO NAVEGADOR. ESTA TELA ATUALIZA SOZINHA<span class="cursor">_</span>';
      const fim = Date.now() + 180e3; const vigiar = async () => { if (Date.now() > fim) { b.disabled = false; b.innerHTML = t0; if (msg) msg.textContent = 'AINDA NÃO DEU CERTO. TENTE DE NOVO.'; return; } const s = await sync.carregar(); if (s?.github?.estado === 'OK') { sync.app.toast('GITHUB', 'Conta conectada: ' + (s.github.usuario || '')); if (depois) depois(); return; } setTimeout(vigiar, 2000); }; setTimeout(vigiar, 2000); }
    catch (e) { b.disabled = false; b.innerHTML = t0; if (msg) msg.innerHTML = `<span class="alerta">${esc(e.corpo?.erro || e.message)}</span>`; }
  });
}
export function ligarOneDrive(raiz, sync, depois) {
  raiz.querySelectorAll('[data-od-usar]').forEach(b => b.onclick = async () => {
    b.disabled = true; b.querySelector('b').innerHTML = 'LIGANDO…';
    try { const r = await enviar('/api/sync', { ativo: true, pasta: b.dataset.odUsar, criar: true }); sync.atualizar(r && r.maquinas ? r : await obter('/api/sync')); sync.app.toast('SINCRONIZAÇÃO', 'Ligada no OneDrive. Instale o CÓRTEX nos outros PCs.'); }
    catch (e) { b.disabled = false; b.querySelector('b').innerHTML = 'USAR ONEDRIVE<br>(RECOMENDADO)'; const det = (e.corpo?.erros || []).map(x => x.erro).join(' · ') || e.corpo?.erro || e.message; sync.app.toast('SINCRONIZAÇÃO', /não existe/i.test(det) ? 'A pasta ' + b.dataset.odUsar + ' ainda não existe. Crie a pasta CORTEX dentro do OneDrive e clique de novo.' : 'Falhou: ' + det); }
    if (depois) depois();
  });
}

export class Sync {
  constructor(app) {
    this.app = app; this.s = null; this.disponivel = true;
    $('#tb-sync').onclick = () => app.shell.ir('#/config/sync');
  }
  // nome desta máquina (para saber o que é remoto)
  get eu() { return this.s?.maquina?.nome || null; }
  remoto(n) { const eu = this.eu; const m = n && (n.maquina || (n.maquinas && n.maquinas[0])); return !!(m && eu && m !== eu && !(n.maquinas || []).includes(eu)); }
  origem(n) { const l = n.maquinas && n.maquinas.length ? n.maquinas : n.maquina ? [n.maquina] : []; return l; }
  async carregar() {
    try { this.atualizar(await obter('/api/sync')); this.disponivel = true; } catch (e) { this.disponivel = e.status !== 404 ? true : false; this.atualizar(null); }
    return this.s;
  }
  atualizar(s) {
    this.s = s; const b = $('#tb-sync');
    if (!s) { b.hidden = !this.disponivel; b.className = 'tb-sync off'; b.innerHTML = 'SYNC <b>○</b> —'; this.boasVindas(); return; }
    const outros = (s.maquinas || []).filter(m => !m.eu); const n = (s.maquinas || []).length || 1; const erro = s.erro || (s.maquinas || []).some(m => m.status === 'ERRO');
    b.hidden = false; b.className = 'tb-sync' + (s.ativo ? (erro ? ' erro' : ' on') : ' off');
    if (gh(s) && s.github.estado === 'PRECISA_ENTRAR') { b.className = 'tb-sync entrar'; b.innerHTML = 'SYNC <b>○</b> <span>ENTRAR</span>'; b.title = 'ENTRE NO GITHUB PARA JUNTAR COM SEUS OUTROS PCs'; }
    else if (gh(s) && (s.github.estado === 'SEM_GIT' || s.github.estado === 'ERRO')) { b.className = 'tb-sync erro'; b.innerHTML = `SYNC <b>●</b> <span>${s.github.estado === 'SEM_GIT' ? 'SEM GIT' : 'ERRO'}</span>`; b.title = s.github.erro || 'INSTALE O GIT (git-scm.com) E REABRA O CÓRTEX'; }
    else b.innerHTML = s.ativo ? `SYNC <b>●</b> <span>${n} PC${n > 1 ? '<i class="min">s</i>' : ''}</span>` : 'SYNC <b>○</b> DESLIGADO';
    if (!(gh(s) && s.github.estado !== 'OK')) b.title = gh(s) && s.github.estado === 'OK' ? `GITHUB: ${s.github.usuario || '—'} · ${s.github.repo || 'cortex-dados'}\nESTE PC: ${s.maquina?.nome || '—'}\nOUTROS: ${outros.map(m => m.nome).join(', ') || 'nenhum ainda'}` : s.ativo ? `PASTA: ${s.pasta || '—'}\nESTE PC: ${s.maquina?.nome || '—'}\nOUTROS: ${outros.map(m => m.nome).join(', ') || 'nenhum ainda'}${s.ultimaPublicacao ? '\nPUBLICADO HÁ ' + fmtRel(typeof s.ultimaPublicacao === 'object' ? s.ultimaPublicacao.em : s.ultimaPublicacao) : ''}${s.erro ? '\nERRO: ' + s.erro : ''}` : 'SINCRONIZAÇÃO DESLIGADA · CLIQUE PARA CONFIGURAR';
    const pg = this.app.shell?.paginas?.config; if (pg && pg.sub === 'sync' && pg.box?.isConnected && !pg.box.contains(document.activeElement)) pg._sync(pg.box);
    this.app.shell?.migalhas(); this.boasVindas();
  }
  async agora() { this.app.hud.log({ t: Date.now(), nivel: 'INFO', fonte: 'sistema', msg: 'SYNC AGORA · PUBLICANDO E RELENDO' }); try { const r = await enviar('/api/sync/agora', {}); if (r && r.maquinas) this.atualizar(r); else await this.carregar(); this.app.toast('SINCRONIZAÇÃO', 'Publicado e relido agora.'); } catch (e) { this.app.toast('SINCRONIZAÇÃO', 'Falhou: ' + (e.corpo?.erro || e.message)); } }
  // ------------------------------------------------------------------ cérebro vazio
  vazio() {
    const g = this.app.g; if (!g) return false;
    const reais = g.nos.reduce((s, n) => s + (n.tipo === 'dia' ? 0 : 1), 0);
    const fontes = (g.fontes || []).filter(f => !f.interna && f.tipo !== 'remoto' && f.projeto !== 'diario');
    const tudoAusente = fontes.length > 0 && fontes.every(f => f.status === 'AUSENTE' || f.status === 'ERRO' || !f.itens);
    return !g.visao && (reais === 0 || (tudoAusente && reais < 5));
  }
  boasVindas() {
    const el = $('#boas-vindas'); if (!el) return; const v = this.vazio() && !this.app.carregando;
    document.body.classList.toggle('cerebro-vazio', v); if (el.hidden === !v && !v) return; el.hidden = !v; if (!v) return;
    const s = this.s || {}; const g = this.app.g; const fontes = (g?.fontes || []).filter(f => !f.interna && f.tipo !== 'remoto' && f.projeto !== 'diario' && !/[\\/]diario$/.test(f.caminho || ''));
    const sug = s.sugestoes || [];
    el.innerHTML = `<div class="bv">
      <div class="bv-cab"><div class="pg-sup">CÉREBRO VAZIO // NENHUM REGISTRO NESTE PC${s.maquina?.nome ? ' · ESTE PC: ' + esc(s.maquina.nome) : ''}</div><h1>O CÉREBRO AINDA<br>NÃO TEM NADA.</h1>
      <p>O CÓRTEX só enxerga o que está neste computador. Escolha como começar:</p></div>
      ${gh(s) ? (s.github.estado === 'OK' ? '' : blocoGithub(s, true)) : blocoOneDrive(s, true)}
      <div class="bv-op">
        <a class="bv-c" href="#/config/fontes"><span class="bv-n">01</span><b>CONECTAR FONTES<br>DESTE PC</b><span>Aponte as pastas que existem aqui: cofres do Obsidian, repositórios git, conversas do Claude Code, roteiros e vídeos.</span>
          <em>${fontes.length ? `${fontes.length} FONTE${fontes.length > 1 ? 'S' : ''} CONFIGURADA${fontes.length > 1 ? 'S' : ''}, NENHUMA ENCONTRADA AQUI:` : 'NENHUMA FONTE CONFIGURADA'}</em>
          ${fontes.slice(0, 4).map(f => `<i>${esc(String(f.tipo).toUpperCase())} · ${esc(f.caminho)} · <u>${esc(f.status || '—')}</u></i>`).join('')}<span class="bv-ir">CONECTAR ▸</span></a>
        <a class="bv-c prim" href="#/config/sync"><span class="bv-n">02</span><b>JUNTAR COM SEUS<br>OUTROS PCs (GITHUB)</b><span>Entre na sua conta do GitHub. O CÓRTEX guarda o cérebro num repositório privado que só você vê, e cada PC que entrar na mesma conta se junta sozinho.</span>
          <em>${gh(s) ? (s.github.estado === 'OK' ? 'CONTA ' + esc(String(s.github.usuario || '').toUpperCase()) + ' · ' + (s.maquinas || []).length + ' PCs' : s.github.estado === 'SEM_GIT' ? 'FALTA O GIT: INSTALE EM GIT-SCM.COM E REABRA O CÓRTEX' : 'UMA VEZ EM CADA PC; ABRE O NAVEGADOR') : 'UMA VEZ EM CADA PC; ABRE O NAVEGADOR'}</em>
          <i>OUTRAS FORMAS (PASTA, ONEDRIVE, PACOTE) EM AVANÇADO</i><span class="bv-ir">JUNTAR ▸</span></a>
      </div>
      <div class="bv-pe">JÁ TEM UM PACOTE <code>.cortexpack</code> DE OUTRO PC? <a href="#/config/sync">IMPORTAR PACOTE</a> · OS DADOS NUNCA SAEM DESTE PC SEM VOCÊ LIGAR A SINCRONIZAÇÃO.</div></div>`;
    ligarOneDrive(el, this); ligarGithub(el, this);
  }
}
