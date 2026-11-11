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
  const conta = '<div class="od-conta">TODOS OS PCs PRECISAM ESTAR ENTRANDO NO ONEDRIVE COM A <b>MESMA CONTA</b> DA MICROSOFT.</div>';
  if (od && od.ativoNele) return `<div class="od od-ok"><div class="od-ic">●</div><div class="od-t"><b>SINCRONIZANDO PELO ONEDRIVE · ${n} PC${n > 1 ? '<i>s</i>' : ''}</b><span>NADA A FAZER NOS OUTROS PCs ALÉM DE INSTALAR O CÓRTEX. ELES ENTRAM SOZINHOS.</span><em>${esc(s.pasta)}${ms.length ? ' · ' + ms.map(m => esc(m.nome) + (m.eu ? ' (ESTE)' : '')).join(' · ') : ''}</em>${conta}</div></div>`;
  if (od) return `<div class="od"><button class="od-btn" data-od-usar="${esc(od.pasta)}"><span class="od-ic">▶</span><b>USAR ONEDRIVE<br>(RECOMENDADO)</b><span>1 CLIQUE · LIGA A SINCRONIZAÇÃO EM <code>${esc(od.pasta)}</code></span></button><div class="od-t"><span>${s?.ativo ? 'Hoje a sincronização está em outra pasta: ' + esc(s.pasta) + '.' : 'O OneDrive já está neste PC.'} Depois é só instalar o CÓRTEX nos outros PCs: eles acham a mesma pasta e os cérebros se juntam.</span>${conta}</div></div>`;
  return compacto ? '' : `<div class="od od-sem"><div class="od-t"><b>ONEDRIVE NÃO ENCONTRADO NESTE PC</b><span>Entre no OneDrive (com a mesma conta nos outros PCs) e volte aqui, ou escolha outra pasta que sincronize em AVANÇADO.</span></div></div>`;
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
    b.innerHTML = s.ativo ? `SYNC <b>●</b> <span>${n} PC${n > 1 ? '<i class="min">s</i>' : ''}</span>` : 'SYNC <b>○</b> DESLIGADO';
    b.title = s.ativo ? `PASTA: ${s.pasta || '—'}\nESTE PC: ${s.maquina?.nome || '—'}\nOUTROS: ${outros.map(m => m.nome).join(', ') || 'nenhum ainda'}${s.ultimaPublicacao ? '\nPUBLICADO HÁ ' + fmtRel(typeof s.ultimaPublicacao === 'object' ? s.ultimaPublicacao.em : s.ultimaPublicacao) : ''}${s.erro ? '\nERRO: ' + s.erro : ''}` : 'SINCRONIZAÇÃO DESLIGADA · CLIQUE PARA CONFIGURAR';
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
      ${blocoOneDrive(s, true)}
      <div class="bv-op">
        <a class="bv-c" href="#/config/fontes"><span class="bv-n">01</span><b>CONECTAR FONTES<br>DESTE PC</b><span>Aponte as pastas que existem aqui: cofres do Obsidian, repositórios git, conversas do Claude Code, roteiros e vídeos.</span>
          <em>${fontes.length ? `${fontes.length} FONTE${fontes.length > 1 ? 'S' : ''} CONFIGURADA${fontes.length > 1 ? 'S' : ''}, NENHUMA ENCONTRADA AQUI:` : 'NENHUMA FONTE CONFIGURADA'}</em>
          ${fontes.slice(0, 4).map(f => `<i>${esc(String(f.tipo).toUpperCase())} · ${esc(f.caminho)} · <u>${esc(f.status || '—')}</u></i>`).join('')}<span class="bv-ir">CONECTAR ▸</span></a>
        <a class="bv-c prim" href="#/config/sync"><span class="bv-n">02</span><b>SINCRONIZAR COM<br>OUTRO PC</b><span>Escolha uma pasta que já sincroniza entre seus PCs (ex.: OneDrive). Faça o mesmo no outro PC. Os dois cérebros se juntam.</span>
          <em>${sug.length ? 'PASTAS QUE JÁ SINCRONIZAM NESTE PC:' : 'FUNCIONA COM ONEDRIVE, GOOGLE DRIVE, DROPBOX, PASTA DE REDE OU PENDRIVE'}</em>
          ${sug.slice(0, 4).map(x => `<i>${esc(x.rotulo)} · ${esc(x.caminho)}</i>`).join('')}<span class="bv-ir">SINCRONIZAR ▸</span></a>
      </div>
      <div class="bv-pe">${oneDrive(s) ? 'OU ESCOLHA OUTRA PASTA EM <a href="#/config/sync">SINCRONIZAÇÃO › AVANÇADO</a> · ' : ''}JÁ TEM UM PACOTE <code>.cortexpack</code> DE OUTRO PC? <a href="#/config/sync">IMPORTAR PACOTE</a> · OS DADOS NUNCA SAEM DESTE PC SEM VOCÊ LIGAR A SINCRONIZAÇÃO.</div></div>`;
    ligarOneDrive(el, this);
  }
}
