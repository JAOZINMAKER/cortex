// CONFIGURAÇÕES: GERAL, FONTES, ORGANIZAÇÃO, APARÊNCIA (com editor de tema), CÉREBRO, DESEMPENHO, NOTIFICAÇÕES, DADOS, SOBRE.
import * as tema from './tema.js';
import { esc, fmtN, fmtRel, fmtDataHora } from './util.js';
import { obter, enviar } from './dados.js';
import { blocoOneDrive, oneDrive, ligarOneDrive, gh, blocoGithub, ligarGithub } from './sync.js';

const pubT = s => { const u = s && s.ultimaPublicacao; return !u ? 0 : typeof u === 'object' ? (u.em || u.geradoEm || u.t || 0) : +u; };
export const SUBS = [['geral', 'GERAL'], ['fontes', 'FONTES'], ['sync', 'SINCRONIZAÇÃO'], ['organizacao', 'ORGANIZAÇÃO'], ['aparencia', 'APARÊNCIA'], ['cerebro', 'CÉREBRO'], ['desempenho', 'DESEMPENHO'], ['notificacoes', 'NOTIFICAÇÕES'], ['atualizacoes', 'ATUALIZAÇÕES'], ['dados', 'DADOS'], ['sobre', 'SOBRE']];
const PADRAO = {
  geral: { idioma: 'pt', iniciarComWindows: false, fecharParaBandeja: true, atalhoGlobal: 'Ctrl+Alt+C', porta: 4747 },
  organizacao: { regrasLocais: true, claudeAtivo: false, modelo: 'claude-haiku-5-5', limitePorHora: 120 },
  cerebro: { profundidadeIdade: 1, espacamentoLobos: 1, velocidadeReplay: 1 },
  desempenho: { limiteNeuronios: 40000, fpsMax: 60, qualidadeSinapses: 'media' },
  notificacoes: { registroDiario: true, commitNovo: true, sessaoNova: false },
};
const ROTULO_TOKEN = { fundo: 'FUNDO', painel: 'PAINEL', grade: 'GRADE', linha: 'LINHA', texto: 'TEXTO', cinza: 'CINZA', apagado: 'APAGADO', acento: 'ACENTO', maquina: 'MÁQUINA (IA)', alerta: 'ALERTA', obsidian: '3D OBSIDIAN', git: '3D GIT', claude: '3D CLAUDE', pasta: '3D PASTA', diario: '3D DIÁRIO', dia: '3D DIA / ESPINHA' };
const baixar = (nome, texto, tipo = 'application/json') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], { type: tipo })); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

export class PaginaConfig {
  constructor(app, shell) { this.app = app; this.shell = shell; this.cfg = null; this.editor = null; this._t = {}; }
  async _carregar() {
    let c = {}; try { c = await obter('/api/config'); this.temServidor = true; } catch { this.temServidor = false; }
    this.cfg = {}; for (const k in PADRAO) this.cfg[k] = { ...PADRAO[k], ...(c[k] || {}) }; this.extra = c;
    this.leitura = { chave: c.organizacao?.chave, temChave: c.organizacao?.temChave, claudeLigado: c.organizacao?.claudeLigado };
    for (const k of ['chave', 'temChave', 'claudeLigado']) delete this.cfg.organizacao[k];
    this.caminhos = c.caminhos || {}; this.fontesCfg = c.fontes || {};
    try { this.status = await obter('/api/status'); } catch { this.status = {}; }
  }
  async render(el, r) {
    if (!this.cfg || r.sub === 'geral' || r.sub === 'sobre' || r.sub === 'organizacao') await this._carregar();
    if (r.sub === 'sync') this._syncLido = false;
    el.innerHTML = `<div class="cf"><aside class="cf-nav"><div class="pg-sup">SEÇÃO 05</div><h1>CONFIG.</h1>${SUBS.map(([k, t], i) => `<a href="#/config/${k}" class="${r.sub === k ? 'on' : ''}"><kbd>${String(i + 1).padStart(2, '0')}</kbd>${t}</a>`).join('')}
      <div class="cf-salvo" data-salvo>${this.temServidor ? 'SALVA SOZINHO · /api/config' : 'SERVIDOR SEM /api/config · SÓ AJUSTES VISUAIS SALVAM'}</div></aside><section class="cf-main" data-cf></section></div>`;
    this.box = el.querySelector('[data-cf]'); this.sub = r.sub;
    await this['_' + r.sub](this.box);
    this._ligarCampos(this.box);
  }
  // ------------------------------------------------------------------ campos genéricos
  _sec(t, sub) { return `<div class="cf-tit"><h2>${t}</h2>${sub ? `<p>${sub}</p>` : ''}</div>`; }
  _grupo(t) { return `<div class="pg-rot">${t}</div>`; }
  _ck(sec, k, rot, desc) { const v = this.cfg[sec][k]; return `<label class="cf-l"><div><b>${rot}</b>${desc ? `<span>${desc}</span>` : ''}</div><span class="cf-c"><input type="checkbox" class="sw" data-cfg="${sec}.${k}" ${v ? 'checked' : ''}></span></label>`; }
  _num(sec, k, rot, desc, min, max, st = 1) { const v = this.cfg[sec][k]; return `<label class="cf-l"><div><b>${rot}</b>${desc ? `<span>${desc}</span>` : ''}</div><span class="cf-c"><input type="number" class="pv-in curto" min="${min}" max="${max}" step="${st}" data-cfg="${sec}.${k}" value="${esc(v)}"></span></label>`; }
  _sl(sec, k, rot, desc, min, max, st, fmt = x => (+x).toFixed(2)) { const v = sec === 'aj' ? this.app.ajustes.a[k] : this.cfg[sec][k]; return `<label class="cf-l"><div><b>${rot}</b>${desc ? `<span>${desc}</span>` : ''}</div><span class="cf-c desl"><input type="range" min="${min}" max="${max}" step="${st}" value="${v}" data-${sec === 'aj' ? 'aj' : 'cfg'}="${sec === 'aj' ? k : sec + '.' + k}"><b data-v>${fmt(v)}</b></span></label>`; }
  _txt(sec, k, rot, desc, ph = '') { const v = this.cfg[sec][k]; return `<label class="cf-l"><div><b>${rot}</b>${desc ? `<span>${desc}</span>` : ''}</div><span class="cf-c"><input class="pv-in" data-cfg="${sec}.${k}" value="${esc(v ?? '')}" placeholder="${esc(ph)}"></span></label>`; }
  _sel(sec, k, rot, desc, ops) { const v = sec === 'aj' ? this.app.ajustes.a[k] : this.cfg[sec][k]; return `<label class="cf-l"><div><b>${rot}</b>${desc ? `<span>${desc}</span>` : ''}</div><span class="cf-c"><span class="pv-seg">${ops.map(([o, t]) => `<button type="button" data-${sec === 'aj' ? 'aj' : 'cfg'}="${sec === 'aj' ? k : sec + '.' + k}" data-val="${esc(o)}" class="${String(v) === String(o) ? 'on' : ''}">${t}</button>`).join('')}</span></span></label>`; }
  _ckAj(k, rot, desc) { const v = this.app.ajustes.a[k]; return `<label class="cf-l"><div><b>${rot}</b>${desc ? `<span>${desc}</span>` : ''}</div><span class="cf-c"><input type="checkbox" class="sw" data-aj="${k}" ${v ? 'checked' : ''}></span></label>`; }
  _ligarCampos(box) {
    const conv = (i, v) => i.type === 'checkbox' ? i.checked : (i.type === 'number' || i.type === 'range') ? +v : v;
    box.querySelectorAll('[data-cfg]').forEach(i => {
      const [sec, k] = i.dataset.cfg.split('.');
      const set = v => { this.cfg[sec][k] = v; this._salvar(sec); const b = i.parentElement.querySelector('[data-v]'); if (b) b.textContent = (+v).toFixed(i.step && +i.step >= 1 ? 0 : 2); };
      if (i.tagName === 'BUTTON') i.onclick = () => { const v = isNaN(+i.dataset.val) ? i.dataset.val : +i.dataset.val; set(v); i.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === i)); this._aplicarLocal(sec, k, v); };
      else i.oninput = () => { const v = conv(i, i.value); set(v); this._aplicarLocal(sec, k, v); };
    });
    box.querySelectorAll('[data-aj]').forEach(i => {
      const k = i.dataset.aj;
      if (i.tagName === 'BUTTON') i.onclick = () => { this.app.ajustes.set(k, isNaN(+i.dataset.val) ? i.dataset.val : +i.dataset.val); i.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === i)); };
      else i.oninput = () => { const v = conv(i, i.value); this.app.ajustes.a[k] = v; this.app.ajustes.aplicarTudo(k); this.app.ajustes._salvar(); const b = i.parentElement.querySelector('[data-v]'); if (b) b.textContent = k === 'orcamentoRotulos' || k === 'fonteLargura' ? String(v) : (+v).toFixed(2); };
    });
  }
  _aplicarLocal(sec, k, v) {
    const app = this.app;
    if (sec === 'desempenho' && k === 'fpsMax') app.fpsMax = v;
    if (sec === 'desempenho' && k === 'limiteNeuronios') app.cerebro.limite = v;
    if (sec === 'desempenho' && k === 'qualidadeSinapses') app.cerebro.qualidade = v;
    if (sec === 'cerebro' && k === 'velocidadeReplay') app.replay.setVel(v);
  }
  _salvar(sec) {
    clearTimeout(this._t[sec]); this._t[sec] = setTimeout(async () => {
      const m = document.querySelector('[data-salvo]');
      try { const r = await enviar('/api/config', { [sec]: this.cfg[sec] }); const av = r && (r.avisos || [...(r.precisaReconstruir || r.reconstruir ? ['ESSA MUDANÇA PEDE RECONSTRUIR O CÉREBRO'] : []), ...(r.precisaReiniciar ? ['REINICIE O APP PARA VALER'] : [])]); if (m) m.innerHTML = av && av.length ? `<span class="aviso-txt">${esc(av.join(' · '))}</span> <button class="btn-mini" data-recon>RECONSTRUIR</button>` : 'SALVO · ' + new Date().toTimeString().slice(0, 8);
        const rb = m && m.querySelector('[data-recon]'); if (rb) rb.onclick = () => this.app.reconstruir(); }
      catch (e) { if (m) m.innerHTML = `<span class="alerta">NÃO SALVOU: ${esc((e.corpo?.erros || []).map(x => x.campo + ' ' + x.erro).join(' · ') || e.corpo?.erro || e.message)}</span>`; }
    }, 500);
  }
  // ------------------------------------------------------------------ seções
  _geral(b) {
    const app = !!window.cortexApp;
    b.innerHTML = this._sec('GERAL', app ? 'APP DE DESKTOP ' + esc(window.cortexApp.versao || '') : 'MODO NAVEGADOR · AS OPÇÕES DO APP VALEM QUANDO ABERTO PELO CORTEX.EXE') +
      this._grupo('IDIOMA') + `<label class="cf-l"><div><b>IDIOMA</b><span>A INTERFACE É SÓ EM PORTUGUÊS</span></div><span class="cf-c"><span class="pv-seg"><button class="on" disabled>PORTUGUÊS</button></span></span></label>` +
      this._grupo('JANELA E SISTEMA') + this._ck('geral', 'iniciarComWindows', 'INICIAR COM O WINDOWS', 'ABRE ESCONDIDO NA BANDEJA AO LIGAR O PC') + this._ck('geral', 'fecharParaBandeja', 'FECHAR = MINIMIZAR PARA A BANDEJA', 'O SERVIDOR CONTINUA VIGIANDO AS PASTAS') +
      `<label class="cf-l"><div><b>ATALHO GLOBAL</b><span>MOSTRA/ESCONDE O CÓRTEX DE QUALQUER LUGAR · CLIQUE E APERTE A COMBINAÇÃO</span></div><span class="cf-c"><input class="pv-in curto atalho" data-atalho value="${esc(this.cfg.geral.atalhoGlobal)}" readonly></span></label>` +
      this._grupo('SERVIDOR LOCAL') + this._num('geral', 'porta', 'PORTA', 'SÓ 127.0.0.1 · MUDAR PEDE REINICIAR O APP', 1024, 65535);
    const at = b.querySelector('[data-atalho]'); at.onkeydown = ev => { ev.preventDefault(); if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) return; const k = [ev.ctrlKey && 'Ctrl', ev.altKey && 'Alt', ev.shiftKey && 'Shift', ev.metaKey && 'Super', ev.key.length === 1 ? ev.key.toUpperCase() : ev.key].filter(Boolean).join('+'); at.value = k; this.cfg.geral.atalhoGlobal = k; this._salvar('geral'); };
  }
  async _fontes(b) {
    let f = []; try { const d = await obter('/api/fontes'); f = Array.isArray(d) ? d : d.fontes || []; this.apelidosApi = d.apelidos; } catch {}
    const ap = { ...(this.fontesCfg?.apelidos || this.extra?.apelidos || this.apelidosApi || {}) }; const ign = this.fontesCfg?.ignorar || this.extra?.ignorar || [];
    const nativo = !!(window.cortexApp && window.cortexApp.escolherPasta);
    b.innerHTML = this._sec('FONTES', 'TUDO QUE O CÉREBRO LÊ. NADA SAI DO COMPUTADOR.') + this._grupo(`CONECTADAS · ${f.length}`) +
      `<div class="tb-lista"><div class="tbl h f6"><span>TIPO</span><span>CAMINHO</span><span>PROJETO</span><span>ITENS</span><span>STATUS</span><span></span></div>${f.map(x => `<div class="tbl f6"><span class="b">${esc(String(x.tipo).toUpperCase())}</span><span class="c" title="${esc(x.caminho)}">${esc(x.caminho)}${x.erro ? `<br><span class="alerta">${esc(x.erro)}</span>` : ''}</span><span>${esc(x.projeto || '—')}</span><span>${fmtN(x.itens)}</span><span class="s ${esc(x.status)}">${esc(x.status || '—')}</span><span>${x.interna ? '<span class="apagado">INTERNA</span>' : `<button class="btn-mini" data-rm="${esc(x.id)}">REMOVER</button>`}</span></div>`).join('')}</div>` +
      this._grupo('ADICIONAR') + `<form class="cf-add" data-add><span class="pv-seg">${[['obsidian', 'OBSIDIAN'], ['git', 'GIT'], ['claude', 'CLAUDE CODE'], ['pasta', 'PASTA']].map(([k, t], i) => `<button type="button" data-tipo="${k}" class="${i ? '' : 'on'}">${t}</button>`).join('')}</span>
        <div class="cf-pasta"><input class="pv-in" name="caminho" placeholder="C:\\Users\\jaozin\\Documents\\…" required><button type="button" data-escolher>${nativo ? 'ESCOLHER PASTA…' : 'COLE O CAMINHO'}</button></div><input class="pv-in" name="projeto" placeholder="PROJETO (OPCIONAL)"><button class="btn-acao">CONECTAR ▸</button><div class="cf-msg" data-msg></div></form>` +
      this._grupo('APELIDOS DE PROJETO · PADRÃO → PROJETO') + `<div class="cf-ap" data-ap>${Object.entries(ap).map(([k, v]) => this._linhaAp(k, v)).join('')}${this._linhaAp('', '')}</div><div class="pg-nota">EX.: <code>gp-*</code> → <code>glass-pets</code> JUNTA OS WORKTREES E CLONES NUM PROJETO SÓ.</div>` +
      this._grupo('IGNORAR · UM PADRÃO POR LINHA') + `<textarea class="pv-in cf-ta" data-ign placeholder="node_modules&#10;*.tmp&#10;.obsidian">${esc(ign.join('\n'))}</textarea>`;
    let tipo = 'obsidian';
    b.querySelectorAll('[data-tipo]').forEach(x => x.onclick = () => { tipo = x.dataset.tipo; b.querySelectorAll('[data-tipo]').forEach(y => y.classList.toggle('on', y === x)); });
    b.querySelector('[data-escolher]').onclick = async () => { if (!nativo) { b.querySelector('[name=caminho]').focus(); return; } try { const p = await window.cortexApp.escolherPasta(); if (p) b.querySelector('[name=caminho]').value = p; } catch {} };
    b.querySelector('[data-add]').onsubmit = async ev => { ev.preventDefault(); const F = ev.target; const msg = b.querySelector('[data-msg]'); msg.textContent = 'CONECTANDO…';
      try { await enviar('/api/fontes', { tipo, caminho: F.caminho.value.trim(), projeto: F.projeto.value.trim() || undefined }); msg.innerHTML = '<span class="maquina-c">CONECTADA. O CÉREBRO SE REDESENHA SOZINHO.</span>'; setTimeout(() => this._fontes(b), 800); } catch (e) { msg.innerHTML = `<span class="alerta">${esc(e.corpo?.erro || e.message)}</span>`; } };
    b.querySelectorAll('[data-rm]').forEach(x => x.onclick = async () => { x.textContent = '…'; try { await obter('/api/fontes/' + encodeURIComponent(x.dataset.rm), { method: 'DELETE' }); } catch {} this._fontes(b); });
    const salvarAp = () => { const o = {}; b.querySelectorAll('.cf-apl').forEach(l => { const k = l.querySelector('[data-k]').value.trim(), v = l.querySelector('[data-v2]').value.trim(); if (k && v) o[k] = v; }); this.fontesCfg = { ...this.fontesCfg, apelidos: o }; this._salvarExtra({ fontes: { apelidos: o } }); if (![...b.querySelectorAll('.cf-apl')].some(l => !l.querySelector('[data-k]').value)) { b.querySelector('[data-ap]').insertAdjacentHTML('beforeend', this._linhaAp('', '')); ligarAp(); } };
    const ligarAp = () => b.querySelectorAll('.cf-apl input').forEach(i => i.oninput = salvarAp);
    ligarAp(); b.querySelectorAll('[data-rmap]').forEach(x => x.onclick = () => { x.closest('.cf-apl').remove(); salvarAp(); });
    b.querySelector('[data-ign]').oninput = ev => { const l = ev.target.value.split('\n').map(s => s.trim()).filter(Boolean); this.fontesCfg = { ...this.fontesCfg, ignorar: l }; this._salvarExtra({ fontes: { ignorar: l } }); }
  }
  _linhaAp(k, v) { return `<div class="cf-apl"><input class="pv-in" data-k value="${esc(k)}" placeholder="gp-*"><span>→</span><input class="pv-in" data-v2 value="${esc(v)}" placeholder="glass-pets"><button class="btn-mini" data-rmap type="button">×</button></div>`; }
  _salvarExtra(o) { clearTimeout(this._t.extra); this._t.extra = setTimeout(async () => { const m = document.querySelector('[data-salvo]'); try { const r = await enviar('/api/config', o); this.extra = { ...this.extra, ...o }; if (m) m.innerHTML = r && (r.precisaReconstruir || r.reconstruir) ? 'SALVO · <span class="aviso-txt">PEDE RECONSTRUIR</span> <button class="btn-mini" data-recon>RECONSTRUIR AGORA</button>' : 'SALVO'; const rb = m && m.querySelector('[data-recon]'); if (rb) rb.onclick = () => this.app.reconstruir(); } catch (e) { if (m) m.innerHTML = `<span class="alerta">NÃO SALVOU: ${esc((e.corpo?.erros || []).map(x => x.campo + ' ' + x.erro).join(' · ') || e.message)}</span>`; } }, 600); }
  _organizacao(b) {
    const o = this.cfg.organizacao;
    b.innerHTML = this._sec('ORGANIZAÇÃO AUTOMÁTICA', 'A MÁQUINA CLASSIFICA CADA ENTRADA EM TAGS E REGIÕES. O TEXTO ORIGINAL NUNCA MUDA.') + `<div class="cf-estado ${this.leitura?.claudeLigado ? 'on' : ''}">CLAUDE ${this.leitura?.claudeLigado ? 'LIGADO' : 'DESLIGADO'} · CHAVE ${this.leitura?.temChave ? esc(this.leitura.chave) : 'AUSENTE'}</div>` +
      this._grupo('REGRAS LOCAIS') + this._ck('organizacao', 'regrasLocais', 'REGRAS LOCAIS LIGADAS', 'CLASSIFICAÇÃO POR PALAVRAS-CHAVE, SEM INTERNET') +
      this._grupo('CLAUDE (OPCIONAL)') + this._ck('organizacao', 'claudeAtivo', 'USAR O CLAUDE PARA REFINAR', 'MANDA TÍTULO E TRECHO PARA A API. DESLIGADO = NADA SAI DA MÁQUINA') +
      `<label class="cf-l"><div><b>CHAVE DA API</b><span>GUARDADA SÓ EM &lt;DADOS&gt;/.env · NUNCA VOLTA INTEIRA</span></div><span class="cf-c cf-chave"><input class="pv-in" type="password" data-chave placeholder="${esc(this.leitura?.chave || 'sk-ant-…')}"><button class="btn-mini" data-salvar-chave>GRAVAR</button></span></label>` +
      this._sel('organizacao', 'modelo', 'MODELO', 'HAIKU É RÁPIDO E BARATO PARA CLASSIFICAR', [['claude-haiku-5-5', 'HAIKU 5.5'], ['claude-sonnet-5-5', 'SONNET 5.5']]) +
      this._num('organizacao', 'limitePorHora', 'LIMITE POR HORA', 'MÁXIMO DE CLASSIFICAÇÕES ENVIADAS', 1, 2000) +
      `<label class="cf-l"><div><b>TESTAR</b><span>FAZ UMA CLASSIFICAÇÃO DE TESTE</span></div><span class="cf-c"><button class="btn-acao" data-testar>TESTAR AGORA</button></span></label><div class="cf-msg" data-msg></div>`;
    b.querySelector('[data-salvar-chave]').onclick = async () => { const i = b.querySelector('[data-chave]'); const msg = b.querySelector('[data-msg]'); try { const r = await enviar('/api/config/chave', { chave: i.value.trim() }); i.value = ''; i.placeholder = r.chave || 'GRAVADA'; msg.innerHTML = `<span class="maquina-c">CHAVE GRAVADA: ${esc(r.chave || '')}</span>`; } catch (e) { msg.innerHTML = `<span class="alerta">${esc(e.corpo?.erro || e.message)}</span>`; } };
    b.querySelector('[data-testar]').onclick = async () => { const msg = b.querySelector('[data-msg]'); msg.textContent = 'TESTANDO…'; try { const r = await enviar('/api/config/chave/testar', { modelo: this.cfg.organizacao.modelo }); msg.innerHTML = `<span class="${r.ok === false ? 'alerta' : 'maquina-c'}">${esc(r.mensagem || r.erro || r.resultado || JSON.stringify(r))}</span>`; } catch (e) { msg.innerHTML = `<span class="alerta">${e.status === 404 ? 'O SERVIDOR AINDA NÃO TEM O TESTE' : esc(e.corpo?.erro || e.message)}</span>`; } };
  }
  _cerebro(b) {
    b.innerHTML = this._sec('CÉREBRO', 'FORMA, CAMADAS E MOVIMENTO DO 3D') + this._grupo('FORMA · PEDE RECONSTRUIR') +
      this._sl('cerebro', 'profundidadeIdade', 'PROFUNDIDADE POR IDADE', 'QUANTO O ANTIGO AFUNDA PARA DENTRO DO CÓRTEX', 0, 2, 0.05) + this._sl('cerebro', 'espacamentoLobos', 'ESPAÇAMENTO DOS LOBOS', 'MARGEM ENTRE PROJETOS NO CÓRTEX', 0, 3, 0.05) +
      this._grupo('CAMADAS') + this._ckAj('mostrarTecido', 'MOSTRAR TECIDO ANATÔMICO') + this._ckAj('mostrarGrade', 'MOSTRAR GRADE DE COORDENADAS') + this._ckAj('mostrarSinapses', 'MOSTRAR SINAPSES') + this._ckAj('rotacaoAuto', 'ROTAÇÃO AUTOMÁTICA', 'GIRA DEVAGAR QUANDO NINGUÉM MEXE') +
      this._grupo('REPLAY') + this._sel('cerebro', 'velocidadeReplay', 'VELOCIDADE PADRÃO', 'DIAS POR SEGUNDO', [[1, '1X'], [10, '10X'], [100, '100X'], [1000, '1000X']]);
  }
  _desempenho(b) {
    b.innerHTML = this._sec('DESEMPENHO', 'META: 20.000 NEURÔNIOS A 60 FPS NUMA PLACA COMUM') +
      this._sl('desempenho', 'limiteNeuronios', 'LIMITE DE NEURÔNIOS DESENHADOS', 'ACIMA DISSO, OS DE MENOR GRAU FICAM SÓ NA BUSCA', 1000, 60000, 500, x => fmtN(x)) +
      this._sel('desempenho', 'fpsMax', 'FPS MÁXIMO', 'MENOS FPS = MENOS VENTOINHA', [[30, '30'], [45, '45'], [60, '60'], [120, '120']]) +
      this._sel('desempenho', 'qualidadeSinapses', 'QUALIDADE DAS SINAPSES', 'BAIXA DESENHA SÓ AS MAIS FORTES', [['baixa', 'BAIXA'], ['media', 'MÉDIA'], ['alta', 'ALTA']]) +
      `<div class="cf-medidor"><div><span>FPS AGORA</span><b data-fps>—</b></div><div><span>JS POR QUADRO</span><b data-ms>—</b></div><div><span>NEURÔNIOS</span><b>${fmtN(this.app.g?.nos.length || 0)}</b></div><div><span>SINAPSES</span><b>${fmtN(this.app.g?.sinapses.length || 0)}</b></div></div>`;
    const t = setInterval(() => { if (!b.isConnected) return clearInterval(t); const f = b.querySelector('[data-fps]'); if (f) { f.textContent = this.app.cerebro.pausado ? 'PAUSADO' : Math.round(this.app.fpsAtual || 0); b.querySelector('[data-ms]').textContent = (this.app.msAtual || 0).toFixed(1) + ' MS'; } }, 500);
  }
  _notificacoes(b) {
    b.innerHTML = this._sec('NOTIFICAÇÕES', 'AVISOS RÁPIDOS NO CANTO DA TELA') + this._ck('notificacoes', 'registroDiario', 'QUANDO UMA SESSÃO REGISTRA NO DIÁRIO') + this._ck('notificacoes', 'commitNovo', 'QUANDO ENTRA UM COMMIT NOVO') + this._ck('notificacoes', 'sessaoNova', 'QUANDO UMA SESSÃO DO CLAUDE CODE COMEÇA') +
      `<label class="cf-l"><div><b>TESTAR</b></div><span class="cf-c"><button class="btn-acao" data-teste>MOSTRAR UM AVISO</button></span></label>`;
    b.querySelector('[data-teste]').onclick = () => this.app.toast('DIÁRIO · CORTEX', 'Exemplo: uma sessão registrou "Revisão semanal".');
  }
  async _sync(b) {
    const S = this.app.sync; let s = S.s; if (!s || !this._syncLido) { await S.carregar(); s = S.s; this._syncLido = true; }
    if (!s) { b.innerHTML = this._sec('SINCRONIZAÇÃO', 'JUNTA OS CÉREBROS DOS SEUS PCs') + `<div class="pg-vazio alerta">O SERVIDOR DESTE PC AINDA NÃO TEM SINCRONIZAÇÃO (/api/sync). ATUALIZE O CÓRTEX.</div>`; return; }
    const nativo = !!(window.cortexApp && window.cortexApp.escolherPasta); const c = s.compartilhar || {}; const ms = s.maquinas || [];
    const st = { OK: 'OK', ANTIGO: 'ANTIGO', ERRO: 'ERRO' };
    const G = gh(s);
    const tabela = this._grupo(`PCs ${G ? 'CONECTADOS' : 'CONHECIDOS'} · ${ms.length}`) + `<div class="tb-lista"><div class="tbl h sy7"><span>PC</span><span>ÚLTIMA PUBLICAÇÃO</span><span>NEURÔNIOS</span><span>PROJETOS</span><span>STATUS</span><span></span></div>${ms.map(m => `<div class="tbl sy7${m.eu ? ' eu' : ''}"><span class="b">${m.eu ? '◆ ' : ''}${esc(m.nome)}${m.eu ? ' <i>ESTE PC</i>' : ''}</span><span>${m.geradoEm ? fmtDataHora(m.geradoEm) + ' · ' + fmtRel(m.geradoEm) : '—'}</span><span>${fmtN(m.neuronios)}</span><span class="c" title="${esc((m.projetos || []).join(', '))}">${Array.isArray(m.projetos) ? esc(m.projetos.join(', ')) || '—' : fmtN(m.projetos)}</span><span class="s ${esc(m.status || '')}">${esc(st[m.status] || m.status || '—')}</span><span>${m.eu ? '' : `<button class="btn-mini" data-sy-esq="${esc(m.id)}">ESQUECER</button>`}</span></div>`).join('') || '<div class="tbl"><span class="apagado">NENHUM PC AINDA</span></div>'}</div>` + (ms.filter(m => !m.eu).length ? '' : `<div class="pg-nota">SÓ ESTE PC ATÉ AGORA. ${G ? 'QUANDO OUTRO PC ENTRAR NA MESMA CONTA DO GITHUB' : 'QUANDO O OUTRO PC APONTAR PARA A MESMA PASTA'}, ELE APARECE AQUI SOZINHO.</div>`);
    const pastaManual = `<details class="sy-av" ${G || oneDrive(s) ? '' : 'open'}><summary>AVANÇADO · ${G ? 'ONEDRIVE, OUTRA PASTA OU PACOTE AVULSO (SEM GITHUB)' : 'ESCOLHER OUTRA PASTA (GOOGLE DRIVE, DROPBOX, REDE, PENDRIVE)'}</summary>` + (G ? blocoOneDrive(s) : '') +
      `<div class="sy-guia"><div><b>1</b><span>Escolha uma pasta que já sincroniza entre seus PCs (ex.: OneDrive).</span></div><div><b>2</b><span>Faça o mesmo no outro PC.</span></div><div><b>3</b><span>Os dois cérebros se juntam.</span></div></div>` +
      this._grupo('PASTA DE SINCRONIZAÇÃO') + `<div class="cf-pasta"><input class="pv-in" data-sy-pasta value="${esc(s.pasta || '')}" placeholder="C:\\Users\\jaozin\\OneDrive"><button type="button" data-sy-escolher>${nativo ? 'ESCOLHER PASTA…' : 'USAR ESTE CAMINHO'}</button></div>` +
      `${(s.sugestoes || []).length ? `<div class="sy-sug"><span>DETECTADAS NESTE PC:</span>${s.sugestoes.map(x => `<button type="button" class="chip" data-sy-sug="${esc(x.caminho)}"><b>${esc(x.rotulo)}</b> ${esc(x.caminho)}</button>`).join('')}</div>` : '<div class="pg-nota">NENHUMA PASTA DE NUVEM DETECTADA. QUALQUER PASTA SERVE: REDE, PENDRIVE OU UMA PASTA QUE VOCÊ COPIA À MÃO.</div>'}` +
      `<div class="pg-nota">O CÓRTEX CRIA <code>${esc((s.pasta || '<PASTA>') + (/[\\/]$/.test(s.pasta || '') ? '' : (String(s.pasta || '').includes(String.fromCharCode(92)) ? String.fromCharCode(92) : '/')) + 'CORTEX-SYNC')}</code> DENTRO DELA.</div>` + (G ? this._grupo('SEM PASTA EM COMUM? PACOTE AVULSO') + `<div class="pg-nota" style="margin-top:0">GERE UM ARQUIVO <code>.cortexpack</code> AQUI, LEVE PARA O OUTRO PC (PENDRIVE, E-MAIL) E IMPORTE LÁ.</div>` + `<div class="sy-pac"><input class="pv-in" data-sy-exp placeholder="C:\\Users\\jaozin\\Desktop\\${esc((s.maquina?.nome || 'meu-pc').toLowerCase())}.cortexpack"><button data-sy-exportar>EXPORTAR PACOTE</button><input class="pv-in" data-sy-imp placeholder="CAMINHO DO .cortexpack DO OUTRO PC"><button data-sy-importar>IMPORTAR PACOTE</button></div>` : '') + `</details>`;
    b.innerHTML = this._sec('SINCRONIZAÇÃO', 'JUNTA OS CÉREBROS DOS SEUS PCs') +
      (G ? blocoGithub(s) + tabela : blocoOneDrive(s)) +
      `<label class="cf-l sy-liga"><div><b>SINCRONIZAÇÃO ${s.ativo ? '<em class="sy-est on">● LIGADA</em>' : '<em class="sy-est">○ DESLIGADA</em>'}</b><span>${s.ativo && pubT(s) ? `PUBLICADO HÁ ${fmtRel(pubT(s))}${s.ultimaPublicacao?.neuronios != null ? ' · ' + fmtN(s.ultimaPublicacao.neuronios) + ' NEURÔNIOS' : ''}${s.ultimaPublicacao?.bytes ? ' · ' + fmtN(Math.round(s.ultimaPublicacao.bytes / 1024)) + ' KB' : ''} · ` : ''}${s.erro ? `<span class="alerta">ERRO: ${esc(s.erro)}</span>` : (G ? 'CADA PC ESCREVE SÓ A PRÓPRIA PARTE DO REPOSITÓRIO' : 'CADA PC ESCREVE SÓ NA PRÓPRIA PASTA DENTRO DE CORTEX-SYNC')}</span></div><span class="cf-c"><input type="checkbox" class="sw" data-sy-ativo ${s.ativo ? 'checked' : ''}></span></label>` +
      `<div class="sy-aviso">${G ? '⚠ AO LIGAR, O CÓRTEX ENVIA OS DADOS DESTE PC (NOTAS, COMMITS, SESSÕES, DIÁRIO) PARA O SEU REPOSITÓRIO PRIVADO NO GITHUB. SÓ A SUA CONTA VÊ.' : `⚠ AO LIGAR, O CÓRTEX COPIA OS DADOS DESTE PC (NOTAS, COMMITS, SESSÕES, DIÁRIO) PARA A PASTA ESCOLHIDA. SE ELA ESTIVER NO ONEDRIVE, GOOGLE DRIVE OU DROPBOX, ESSES DADOS VÃO PARA A NUVEM DESSE SERVIÇO.`}</div>` +
      pastaManual +
      this._grupo('ESTE PC') + `<label class="cf-l"><div><b>NOME DESTE PC</b><span>APARECE NOS NEURÔNIOS COMO "DE: …" NOS OUTROS PCs · ID ${esc(String(s.maquina?.id || '').slice(0, 8))}</span></div><span class="cf-c"><input class="pv-in" data-sy-nome value="${esc(s.maquina?.nome || '')}" maxlength="40"></span></label>` +
      `<label class="cf-l"><div><b>INTERVALO</b><span>PUBLICA NO MÁXIMO A CADA N MINUTOS (E LOGO APÓS RECONSTRUIR)</span></div><span class="cf-c"><input type="number" class="pv-in curto" min="1" max="120" data-sy-int value="${esc(s.intervaloMin ?? 2)}"></span></label>` +
      this._grupo('O QUE COMPARTILHAR') +
      `<label class="cf-l"><div><b>NOTAS DO OBSIDIAN</b><span>"SÓ METADADOS" MANDA TÍTULO, DATAS E LIGAÇÕES, SEM O TEXTO</span></div><span class="cf-c"><span class="pv-seg">${[['conteudo', 'COM CONTEÚDO'], ['metadados', 'SÓ METADADOS']].map(([k, t]) => `<button type="button" data-sy-notas="${k}" class="${(c.notas || 'conteudo') === k ? 'on' : ''}">${t}</button>`).join('')}</span></span></label>` +
      [['git', 'COMMITS E ARQUIVOS DO GIT'], ['sessoes', 'SESSÕES DO CLAUDE CODE'], ['pastas', 'PASTAS COMUNS'], ['diario', 'DIÁRIO DAS SESSÕES']].map(([k, t]) => `<label class="cf-l"><div><b>${t}</b></div><span class="cf-c"><input type="checkbox" class="sw" data-sy-comp="${k}" ${c[k] !== false ? 'checked' : ''}></span></label>`).join('') +
      (G ? '' : tabela) +
      `<div class="sy-acoes"><button class="btn-acao" data-sy-agora ${s.ativo ? '' : 'disabled'}>SINCRONIZAR AGORA</button></div>` +
      (G ? `<div class="cf-msg" data-msg></div>` : this._grupo('SEM PASTA EM COMUM? PACOTE AVULSO') + `<div class="pg-nota" style="margin-top:0">GERE UM ARQUIVO <code>.cortexpack</code> AQUI, LEVE PARA O OUTRO PC (PENDRIVE, E-MAIL) E IMPORTE LÁ.</div>` + `<div class="sy-pac"><input class="pv-in" data-sy-exp placeholder="C:\\Users\\jaozin\\Desktop\\${esc((s.maquina?.nome || 'meu-pc').toLowerCase())}.cortexpack"><button data-sy-exportar>EXPORTAR PACOTE</button><input class="pv-in" data-sy-imp placeholder="CAMINHO DO .cortexpack DO OUTRO PC"><button data-sy-importar>IMPORTAR PACOTE</button></div><div class="cf-msg" data-msg></div>`);
    const msg = t => { b.querySelector('[data-msg]').innerHTML = t; };
    ligarOneDrive(b, S, () => { this._syncLido = false; this._sync(b); }); ligarGithub(b, S, () => { this._syncLido = false; this._sync(b); });
    const enviarSync = async (o, okTxt) => { try { const r = await enviar('/api/sync', o); S.atualizar(r && r.maquinas ? r : await obter('/api/sync')); if (okTxt) msg(`<span class="maquina-c">${okTxt}</span>`); } catch (e) { msg(`<span class="alerta">${esc(e.corpo?.erro || e.message)}</span>`); } };
    b.querySelector('[data-sy-ativo]').onchange = ev => { const p = b.querySelector('[data-sy-pasta]').value.trim(); if (ev.target.checked && !p && !s.pasta) { ev.target.checked = false; msg('<span class="alerta">ESCOLHA UMA PASTA PRIMEIRO.</span>'); return; } enviarSync({ ativo: ev.target.checked, ...(p && p !== s.pasta ? { pasta: p } : {}) }, ev.target.checked ? 'SINCRONIZAÇÃO LIGADA. FAÇA O MESMO NO OUTRO PC.' : 'SINCRONIZAÇÃO DESLIGADA.'); };
    const usarPasta = p => { if (!p) return; b.querySelector('[data-sy-pasta]').value = p; enviarSync({ pasta: p }, 'PASTA DEFINIDA: ' + esc(p) + (s.ativo ? '' : ' · AGORA LIGUE A SINCRONIZAÇÃO')); };
    b.querySelector('[data-sy-escolher]').onclick = async () => { if (nativo) { try { usarPasta(await window.cortexApp.escolherPasta()); } catch {} } else usarPasta(b.querySelector('[data-sy-pasta]').value.trim()); };
    b.querySelector('[data-sy-pasta]').onkeydown = ev => { if (ev.key === 'Enter') usarPasta(ev.target.value.trim()); };
    b.querySelectorAll('[data-sy-sug]').forEach(x => x.onclick = () => usarPasta(x.dataset.sySug));
    const nome = b.querySelector('[data-sy-nome]'); nome.onchange = () => { const v = nome.value.trim(); if (v && v !== s.maquina?.nome) enviarSync({ nome: v }, 'NOME SALVO. OS OUTROS PCs VEEM ISSO NA PRÓXIMA PUBLICAÇÃO.'); };
    b.querySelector('[data-sy-int]').onchange = ev => enviarSync({ intervaloMin: Math.max(1, +ev.target.value || 2) }, 'INTERVALO SALVO.');
    b.querySelectorAll('[data-sy-notas]').forEach(x => x.onclick = () => enviarSync({ compartilhar: { ...c, notas: x.dataset.syNotas } }, 'SALVO.'));
    b.querySelectorAll('[data-sy-comp]').forEach(x => x.onchange = () => enviarSync({ compartilhar: { ...c, [x.dataset.syComp]: x.checked } }, 'SALVO.'));
    b.querySelectorAll('[data-sy-esq]').forEach(x => x.onclick = async () => { x.textContent = '…'; try { await obter('/api/sync/maquinas/' + encodeURIComponent(x.dataset.syEsq), { method: 'DELETE' }); } catch {} this._syncLido = false; this._sync(b); });
    b.querySelector('[data-sy-agora]').onclick = async () => { msg('PUBLICANDO E RELENDO…'); await S.agora(); this._syncLido = false; this._sync(b); };
    b.querySelector('[data-sy-exportar]').onclick = async () => { const p = b.querySelector('[data-sy-exp]').value.trim() || b.querySelector('[data-sy-exp]').placeholder; msg('EXPORTANDO…'); try { const r = await enviar('/api/sync/exportar', { caminho: p }); msg(`<span class="maquina-c">PACOTE GRAVADO: ${esc(r.caminho || p)}${r.bytes ? ' · ' + fmtN(Math.round(r.bytes / 1024)) + ' KB' : ''}</span>`); } catch (e) { msg(`<span class="alerta">${esc(e.corpo?.erro || e.message)}</span>`); } };
    b.querySelector('[data-sy-importar]').onclick = async () => { const p = b.querySelector('[data-sy-imp]').value.trim(); if (!p) { msg('<span class="alerta">COLE O CAMINHO DO PACOTE.</span>'); return; } msg('IMPORTANDO…'); try { const r = await enviar('/api/sync/importar', { caminho: p }); msg(`<span class="maquina-c">IMPORTADO${r.maquina ? ': ' + esc(r.maquina.nome || r.maquina) : ''}. O CÉREBRO SE REDESENHA SOZINHO.</span>`); this._syncLido = false; setTimeout(() => this._sync(b), 1200); } catch (e) { msg(`<span class="alerta">${esc(e.corpo?.erro || e.message)}</span>`); } };
    if (this._focoExportar) { this._focoExportar = false; b.querySelector('[data-sy-exp]').focus(); b.querySelector('[data-sy-exp]').scrollIntoView({ block: 'center' }); }
  }
  async _atualizacoes(b) {
    const A = this.app.atualizacao; const noApp = A && A.disponivelNoApp;
    let st = this.status || {}; try { st = await obter('/api/status'); } catch {}
    if (!noApp) { b.innerHTML = this._sec('ATUALIZAÇÕES', 'O APP SE ATUALIZA SOZINHO') + `<div class="at-top at-solo"><div class="at-ver"><span>VERSÃO</span><b>${esc(st.versaoApp || '—')}</b></div></div><div class="pg-nota">VOCÊ ESTÁ NO NAVEGADOR. AS ATUALIZAÇÕES AUTOMÁTICAS APARECEM AQUI QUANDO O CÓRTEX É ABERTO PELO APP (CORTEX.EXE).</div>`; return; }
    const e = A.e || await A.ler() || {}; const nova = A.versaoNova();
    const ult = e.ultimaVerificacao || e.verificadoEm || e.ultimaChecagem;
    const fontes = (e.fontes || []).map(f => typeof f === 'string' ? { nome: f } : f);
    const estado = e.erro ? ['ERRO', 'alerta', esc(e.erro)] : e.pronta ? ['PRONTA PARA INSTALAR', 'pronta', `A ${esc(nova)} JÁ FOI BAIXADA. REINICIE QUANDO QUISER.`] : e.baixando ? ['BAIXANDO', 'baixando', `${esc(nova || '')}${e.progresso != null ? ' · ' + Math.round(e.progresso * (e.progresso <= 1 ? 100 : 1)) + '%' : ''}`] : e.verificando ? ['VERIFICANDO…', 'baixando', ''] : nova ? ['DISPONÍVEL', 'pronta', esc(nova)] : ['ATUALIZADO', 'ok', 'NENHUMA VERSÃO NOVA'];
    const origem = f => { const t = String(f.tipo || f.nome || f.origem || '').toLowerCase(); return /onedrive/.test(t) ? 'ONEDRIVE' : /github/.test(t) ? 'GITHUB' : String(f.nome || f.tipo || '—').toUpperCase(); };
    const fUsada = fontes.find(f => f.usada || f.ativa || f.escolhida) || (e.origem ? { nome: e.origem } : null);
    b.innerHTML = this._sec('ATUALIZAÇÕES', 'O APP SE ATUALIZA SOZINHO, SEM INSTALAR NADA DE NOVO') +
      `<div class="at-top"><div class="at-ver"><span>VERSÃO ATUAL</span><b>${esc(e.versaoAtual || st.versaoApp || '—')}</b></div><div class="at-st ${estado[1]}"><span>ESTADO</span><b>${estado[0]}</b><em>${estado[2]}</em></div>
        <div class="at-o"><span>ÚLTIMA VERIFICAÇÃO</span><b>${ult ? fmtDataHora(ult) : '—'}</b><em>${ult ? 'HÁ ' + fmtRel(ult) : ''}</em></div><div class="at-o"><span>ORIGEM</span><b>${fUsada ? origem(fUsada) : fontes.length ? fontes.map(origem).join(' + ') : '—'}</b><em>${fUsada?.caminho || fUsada?.url ? esc(fUsada.caminho || fUsada.url) : ''}</em></div></div>
      <div class="at-acoes"><button class="btn-acao" data-verificar ${e.verificando || e.baixando ? 'disabled' : ''}>${e.verificando ? 'VERIFICANDO…' : 'VERIFICAR AGORA'}</button>${e.pronta ? `<button class="btn-exec" data-reiniciar>REINICIAR AGORA · ${esc(nova)}</button>` : ''}</div>
      <div class="at-expl"><b>BASTA UM PC RECEBER A VERSÃO NOVA; OS OUTROS SE ATUALIZAM PELO ONEDRIVE.</b><span>QUEM BAIXA PRIMEIRO (DO GITHUB OU DE UM ZIP) DEIXA A VERSÃO NA PASTA DO ONEDRIVE. OS OUTROS PCs PEGAM DE LÁ E SE ATUALIZAM SOZINHOS NA PRÓXIMA VEZ QUE ABRIREM.</span></div>` +
      this._grupo(`FONTES DE ATUALIZAÇÃO · ${fontes.length}`) + `<div class="tb-lista"><div class="tbl h at4"><span>ORIGEM</span><span>ONDE</span><span>VERSÃO LÁ</span><span>STATUS</span></div>${fontes.map(f => `<div class="tbl at4"><span class="b">${origem(f)}</span><span class="c" title="${esc(f.caminho || f.url || '')}">${esc(f.caminho || f.url || '—')}</span><span>${esc(f.versao || '—')}</span><span class="s ${f.erro ? 'ERRO' : 'OK'}">${f.erro ? esc(f.erro) : f.usada || f.ativa ? 'EM USO' : f.ok === false ? 'INDISPONÍVEL' : 'OK'}</span></div>`).join('') || '<div class="tbl"><span class="apagado">NENHUMA FONTE INFORMADA PELO APP</span></div>'}</div>`;
    b.querySelector('[data-verificar]').onclick = () => A.verificar();
    const rb = b.querySelector('[data-reiniciar]'); if (rb) rb.onclick = () => { rb.textContent = 'REINICIANDO…'; try { window.cortexApp.atualizacao.reiniciarAgora(); } catch {} };
  }
  _dados(b) {
    const s = this.status || {}; const dir = this.caminhos?.dadosDir || s.dadosDir || this.extra?.sobre?.dados || '';
    b.innerHTML = this._sec('DADOS', 'CONFIG, CACHE E DIÁRIO FICAM FORA DA PASTA DO APP') +
      `<label class="cf-l"><div><b>PASTA DE DADOS</b><span>${esc(dir || '%APPDATA%\\CORTEX')}</span></div><span class="cf-c"><button class="btn-acao" data-abrir ${window.cortexApp?.abrirCaminho ? '' : 'disabled'}>ABRIR PASTA</button></span></label>
      <label class="cf-l"><div><b>EXPORTAR GRAFO</b><span>JSON COMPLETO (CONTRATO) DE ${fmtN(this.app.g?.nos.length || 0)} NEURÔNIOS</span></div><span class="cf-c"><button class="btn-acao" data-exp>EXPORTAR JSON</button></span></label>
      <label class="cf-l"><div><b>LIMPAR CACHE</b><span>RELÊ TUDO NA PRÓXIMA MONTAGEM</span></div><span class="cf-c"><button data-cache>LIMPAR</button></span></label>
      <label class="cf-l"><div><b>RECONSTRUIR</b><span>RELÊ AS FONTES E REFAZ O LAYOUT AGORA</span></div><span class="cf-c"><button class="btn-acao" data-recon>RECONSTRUIR</button></span></label><div class="cf-msg" data-msg></div>`;
    const msg = b.querySelector('[data-msg]');
    b.querySelector('[data-abrir]').onclick = () => { try { window.cortexApp.abrirCaminho(dir); } catch {} };
    b.querySelector('[data-exp]').onclick = async () => { msg.textContent = 'EXPORTANDO…'; const g = await obter('/api/graph'); baixar(`cortex-grafo-v${g.versao}.json`, JSON.stringify(g)); msg.textContent = 'GRAFO EXPORTADO'; };
    b.querySelector('[data-cache]').onclick = async () => { msg.textContent = 'LIMPANDO…'; try { await enviar('/api/cache/limpar', {}); msg.textContent = 'CACHE LIMPO'; } catch (e) { if (e.status === 404) { this.app.reconstruir(); msg.textContent = 'CACHE DESCARTADO · RECONSTRUINDO'; } else msg.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; } };
    b.querySelector('[data-recon]').onclick = () => { this.app.reconstruir(); msg.textContent = 'RECONSTRUÇÃO PEDIDA · ACOMPANHE NO LOG'; };
  }
  _sobre(b) {
    const s = this.status || {}, so = this.extra?.sobre || {}; const linhas = [['VERSÃO DO APP', window.cortexApp?.versao || so.versao || s.versaoApp || 'NAVEGADOR'], ['PLATAFORMA', window.cortexApp?.plataforma || navigator.platform], ['SERVIDOR', `127.0.0.1:${s.porta || location.port}`], ['GRAFO', 'V' + (s.versao ?? this.app.g?.versao ?? '—')], ['NEURÔNIOS', fmtN(s.neuronios ?? this.app.g?.nos.length)], ['DADOS', this.caminhos?.dadosDir || so.dados || '—'], ['DIÁRIO', this.caminhos?.diarioDir || '—'], ['CONFIG', this.caminhos?.configPath || so.config || '—'], ['APP', this.caminhos?.appDir || so.app || '—'], ['THREE.JS', '0.169.0'], ['FONTE', 'MARTIAN MONO VARIABLE']];
    b.innerHTML = this._sec('SOBRE', 'CÓRTEX · SEGUNDO CÉREBRO LOCAL') + `<div class="cf-sobre">${linhas.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div><div class="cf-logo">CÓRTEX<span class="cursor">█</span></div>`;
  }
  // ------------------------------------------------------------------ aparência + editor de tema
  _aparencia(b) {
    const aj = this.app.ajustes.a; const atual = tema.nome();
    const card = id => { const T = tema.TEMAS[id]; const sw = [T.ui.fundo, T.ui.painel, T.ui.linha, T.ui.cinza, T.ui.texto, T.ui.maquina, T.ui.acento]; return `<button class="tm${id === atual ? ' on' : ''}" data-tema="${esc(id)}" style="background:${T.ui.fundo};color:${T.ui.texto};border-color:${id === atual ? T.ui.acento : T.ui.linha}"><span class="tm-n">${esc(T.nome)}</span><span class="tm-d" style="color:${T.ui.cinza}">${esc(T.desc || '')}</span><span class="tm-sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</span></button>`; };
    const proprios = tema.NOMES.filter(n => tema.TEMAS[n].proprio);
    b.innerHTML = this._sec('APARÊNCIA', 'TEMAS, TEXTURA, PONTOS, RÓTULOS E FONTE') +
      this._grupo('TEMAS PRONTOS') + `<div class="tm-grade">${tema.PRONTOS.map(card).join('')}</div>` +
      this._grupo(`TEMAS PRÓPRIOS · ${proprios.length}`) + `<div class="tm-grade">${proprios.map(card).join('')}<button class="tm novo" data-novo>+ NOVO TEMA<span class="tm-d">A PARTIR DO ATUAL</span></button></div>` +
      `<div class="te" data-editor>${this.editor ? this._editorHtml() : ''}</div>` +
      this._grupo('TEXTURA') + this._sl('aj', 'scanlines', 'SCANLINES', 'LINHAS DE VARREDURA', 0, 1, 0.05) + this._sl('aj', 'ruido', 'RUÍDO', 'GRÃO ANIMADO', 0, 1, 0.05) + this._ckAj('animacoesReduzidas', 'ANIMAÇÕES REDUZIDAS', 'SEM PISCAR, SEM RUÍDO ANIMADO, TRANSIÇÕES CURTAS') +
      this._grupo('PONTOS E RÓTULOS') + this._sl('aj', 'brilho', 'BRILHO', '', 0.3, 2, 0.05) + this._sl('aj', 'tamanhoPonto', 'TAMANHO DOS PONTOS', '', 0.4, 2.5, 0.05) + this._sl('aj', 'orcamentoRotulos', 'ORÇAMENTO DE RÓTULOS', 'MÁXIMO DE RÓTULOS DE NEURÔNIO NA TELA', 0, 400, 10, x => String(Math.round(x))) +
      this._sel('aj', 'densidadeRotulos', 'DENSIDADE DE RÓTULOS', '', [['minima', 'MÍNIMA'], ['normal', 'NORMAL'], ['maxima', 'MÁXIMA']]) +
      this._grupo('FONTE DA INTERFACE · MARTIAN MONO') + this._sl('aj', 'fonteBase', 'TAMANHO BASE', 'ESCALA DO TEXTO DAS PÁGINAS', 0.85, 1.3, 0.05) + this._sl('aj', 'fonteLargura', 'LARGURA', 'DE CONDENSADA (75) A LARGA (112,5)', 75, 112.5, 2.5, x => String(x));
    b.querySelectorAll('[data-tema]').forEach(x => x.onclick = () => { this.app.ajustes.set('tema', x.dataset.tema); this.editor = null; this._aparencia(b); this._ligarCampos(b); });
    b.querySelector('[data-novo]').onclick = () => { const base = tema.nome(); const T = tema.TEMAS[base]; this.editor = { id: 'meu-' + Date.now().toString(36), nome: 'MEU ' + (T.proprio ? T.nome : T.nome), base: T.base || base, tokens: tema.tokensDe(base), novo: true }; this._aparencia(b); this._ligarCampos(b); this._previa(); b.querySelector('[data-editor]').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    if (this.editor) this._ligarEditor(b);
    // editar o tema próprio atual
    if (!this.editor && tema.TEMAS[atual]?.proprio) { const ed = b.querySelector('[data-editor]'); ed.innerHTML = `<div class="te-vazio"><button class="btn-acao" data-editar>EDITAR ${esc(tema.TEMAS[atual].nome)}</button></div>`; ed.querySelector('[data-editar]').onclick = () => { this.editor = { id: atual, nome: tema.TEMAS[atual].nome, base: tema.TEMAS[atual].base, tokens: tema.tokensDe(atual) }; this._aparencia(b); this._ligarCampos(b); }; }
  }
  _editorHtml() {
    const e = this.editor; const tk = e.tokens;
    const linha = k => `<label class="te-tk"><input type="color" data-tk="${k}" value="${tk[k]}"><span>${ROTULO_TOKEN[k]}</span><input class="pv-in te-hex" data-hex="${k}" value="${tk[k]}" maxlength="7"></label>`;
    return `<div class="te-cab"><div><div class="pg-sup">EDITOR DE TEMA · PRÉVIA AO VIVO NO APP INTEIRO</div><input class="pv-in te-nome" data-nome value="${esc(e.nome)}"></div>
      <div class="te-acoes"><button class="btn-acao" data-salvar>SALVAR</button><button data-dup>DUPLICAR</button><button data-exp>EXPORTAR JSON</button><label class="te-imp">IMPORTAR JSON<input type="file" accept="application/json,.json" data-imp hidden></label>${e.novo ? '' : '<button data-del>EXCLUIR</button>'}<button data-cancelar>CANCELAR</button></div></div>
      <div class="te-corpo"><div class="te-col"><div class="pg-rot">INTERFACE</div>${tema.TOKENS_UI.map(linha).join('')}</div><div class="te-col"><div class="pg-rot">3D POR FONTE</div>${tema.TOKENS_3D.map(linha).join('')}<div class="pg-rot">CONTRASTE (WCAG)</div><div data-contraste>${this._contraste()}</div></div>
      <div class="te-col te-prev" data-prev>${this._previaHtml()}</div></div><div class="cf-msg" data-msg></div>`;
  }
  _contraste() {
    const t = this.editor.tokens; const pares = [['TEXTO / FUNDO', t.texto, t.fundo], ['TEXTO / PAINEL', t.texto, t.painel], ['CINZA / FUNDO', t.cinza, t.fundo], ['ACENTO / FUNDO', t.acento, t.fundo], ['MÁQUINA / FUNDO', t.maquina, t.fundo], ['APAGADO / FUNDO', t.apagado, t.fundo]];
    return pares.map(([n, a, b2], i) => { const c = tema.contraste(a, b2); const nv = c >= 7 ? 'AAA' : c >= 4.5 ? 'AA' : c >= 3 ? 'AA GRANDE' : 'FALHA'; return `<div class="ct${i === 0 ? ' prin' : ''}"><span>${n}</span><b>${c.toFixed(2).replace('.', ',')}:1</b><em class="ct-${nv === 'FALHA' ? 'f' : nv === 'AAA' ? 'aaa' : 'aa'}">${nv}</em><i style="width:${Math.min(100, c / 21 * 100 * 1.6).toFixed(0)}%"></i></div>`; }).join('');
  }
  _previaHtml() {
    const t = this.editor.tokens;
    return `<div class="pv-mock" style="background:${t.fundo};color:${t.texto};border-color:${t.linha}"><div class="pm-cab" style="background:${t.painel};border-color:${t.linha}"><span>STATUS // PROCESSO</span><span style="color:${t.acento}">●</span></div>
      <div class="pm-num"><span style="color:${t.cinza}">NEURÔNIOS</span><b style="color:${t.acento}">11.452</b></div><div class="pm-num"><span style="color:${t.cinza}">SINAPSES</span><b>58.742</b></div>
      <div class="pm-log" style="border-color:${t.grade}"><div><span style="color:${t.apagado}">21:44:12.104</span> <span>PULSO</span> <span style="color:${t.cinza}">GIT</span> COMMIT a3f91c</div><div><span style="color:${t.apagado}">21:44:12.398</span> <span style="color:${t.maquina}">INFO</span> <span style="color:${t.cinza}">IA</span> SESSÃO ATIVA</div><div style="color:${t.alerta}"><span style="color:${t.apagado}">21:44:13.020</span> ALERTA FONTE AUSENTE</div></div>
      <svg viewBox="0 0 240 110" class="pm-3d">${Array.from({ length: 140 }, (_, i) => { const a = i * 2.39996, r = Math.sqrt(i / 140) * 44; const k = ['obsidian', 'obsidian', 'obsidian', 'git', 'claude', 'pasta', 'diario'][i % 7]; return `<rect x="${(120 + Math.cos(a) * r * 1.9).toFixed(1)}" y="${(55 + Math.sin(a) * r).toFixed(1)}" width="2.4" height="2.4" fill="${t[k]}"/>`; }).join('')}<line x1="120" y1="98" x2="120" y2="110" stroke="${t.dia}" stroke-width="3"/></svg>
      <div class="pm-tags"><span style="border-color:${t.maquina};color:${t.maquina}">#TAG DA MÁQUINA</span><span style="background:${t.acento};color:${t.fundo}">PROCESSANDO</span></div></div>`;
  }
  _previa() { const e = this.editor; tema.registrar({ id: '__previa', nome: e.nome, base: e.base, tokens: e.tokens }); tema.aplicar('__previa', false); }
  _ligarEditor(b) {
    const ed = b.querySelector('[data-editor]'); const e = this.editor; const msg = () => ed.querySelector('[data-msg]');
    const atualizar = () => { ed.querySelector('[data-contraste]').innerHTML = this._contraste(); ed.querySelector('[data-prev]').innerHTML = this._previaHtml(); clearTimeout(this._tp); this._tp = setTimeout(() => this._previa(), 60); };
    ed.querySelectorAll('[data-tk]').forEach(i => i.oninput = () => { e.tokens[i.dataset.tk] = i.value; ed.querySelector(`[data-hex="${i.dataset.tk}"]`).value = i.value; atualizar(); });
    ed.querySelectorAll('[data-hex]').forEach(i => i.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(i.value)) { e.tokens[i.dataset.hex] = i.value.toLowerCase(); ed.querySelector(`[data-tk="${i.dataset.hex}"]`).value = i.value.toLowerCase(); atualizar(); } });
    ed.querySelector('[data-nome]').oninput = ev => { e.nome = ev.target.value.toUpperCase(); };
    ed.querySelector('[data-salvar]').onclick = async () => { const t = { id: e.id, nome: e.nome, base: e.base, tokens: e.tokens }; try { await enviar('/api/temas', t); } catch (er) { msg().innerHTML = `<span class="alerta">SERVIDOR NÃO GUARDOU (${esc(er.message)}) · FICA SÓ NESTA JANELA</span>`; } tema.registrar(t); tema.remover('__previa'); this.editor = null; this.app.ajustes.set('tema', t.id); this._aparencia(b); this._ligarCampos(b); };
    ed.querySelector('[data-dup]').onclick = () => { this.editor = { ...e, tokens: { ...e.tokens }, id: 'meu-' + Date.now().toString(36), nome: e.nome + ' (CÓPIA)', novo: true }; this._aparencia(b); this._ligarCampos(b); this._previa(); };
    ed.querySelector('[data-exp]').onclick = () => baixar(`tema-${e.id}.json`, JSON.stringify({ id: e.id, nome: e.nome, base: e.base, tokens: e.tokens }, null, 2));
    ed.querySelector('[data-imp]').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); const tk = j.tokens || j; const novo = { ...tema.tokensDe(j.base || 'grafite') }; for (const k of [...tema.TOKENS_UI, ...tema.TOKENS_3D]) if (/^#[0-9a-f]{6}$/i.test(tk[k] || '')) novo[k] = tk[k].toLowerCase(); this.editor = { id: j.id && !tema.PRONTOS.includes(j.id) ? j.id : 'meu-' + Date.now().toString(36), nome: String(j.nome || 'IMPORTADO').toUpperCase(), base: j.base || 'grafite', tokens: novo, novo: true }; this._aparencia(b); this._ligarCampos(b); this._previa(); } catch (er) { msg().innerHTML = `<span class="alerta">JSON INVÁLIDO: ${esc(er.message)}</span>`; } };
    const del = ed.querySelector('[data-del]'); if (del) del.onclick = async () => { try { await obter('/api/temas/' + encodeURIComponent(e.id), { method: 'DELETE' }); } catch {} tema.remover(e.id); this.editor = null; this.app.ajustes.set('tema', 'grafite'); this._aparencia(b); this._ligarCampos(b); };
    ed.querySelector('[data-cancelar]').onclick = () => { tema.remover('__previa'); this.editor = null; tema.aplicar(this.app.ajustes.a.tema, false); this._aparencia(b); this._ligarCampos(b); };
  }
}
