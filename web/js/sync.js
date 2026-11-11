// SINCRONIZAÇÃO entre PCs: estado (/api/sync), indicador na barra de título e tela de boas-vindas.
import { $, esc, fmtN, fmtRel } from './util.js';
import { obter, enviar } from './dados.js';

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
      <div class="bv-op">
        <a class="bv-c" href="#/config/fontes"><span class="bv-n">01</span><b>CONECTAR FONTES<br>DESTE PC</b><span>Aponte as pastas que existem aqui: cofres do Obsidian, repositórios git, conversas do Claude Code, roteiros e vídeos.</span>
          <em>${fontes.length ? `${fontes.length} FONTE${fontes.length > 1 ? 'S' : ''} CONFIGURADA${fontes.length > 1 ? 'S' : ''}, NENHUMA ENCONTRADA AQUI:` : 'NENHUMA FONTE CONFIGURADA'}</em>
          ${fontes.slice(0, 4).map(f => `<i>${esc(String(f.tipo).toUpperCase())} · ${esc(f.caminho)} · <u>${esc(f.status || '—')}</u></i>`).join('')}<span class="bv-ir">CONECTAR ▸</span></a>
        <a class="bv-c prim" href="#/config/sync"><span class="bv-n">02</span><b>SINCRONIZAR COM<br>OUTRO PC</b><span>Escolha uma pasta que já sincroniza entre seus PCs (ex.: OneDrive). Faça o mesmo no outro PC. Os dois cérebros se juntam.</span>
          <em>${sug.length ? 'PASTAS QUE JÁ SINCRONIZAM NESTE PC:' : 'FUNCIONA COM ONEDRIVE, GOOGLE DRIVE, DROPBOX, PASTA DE REDE OU PENDRIVE'}</em>
          ${sug.slice(0, 4).map(x => `<i>${esc(x.rotulo)} · ${esc(x.caminho)}</i>`).join('')}<span class="bv-ir">SINCRONIZAR ▸</span></a>
      </div>
      <div class="bv-pe">JÁ TEM UM PACOTE <code>.cortexpack</code> DE OUTRO PC? <a href="#/config/sync">IMPORTAR PACOTE</a> · OS DADOS NUNCA SAEM DESTE PC SEM VOCÊ LIGAR A SINCRONIZAÇÃO.</div></div>`;
  }
}
