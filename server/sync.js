'use strict';
/*
 * Sincronização entre PCs (CONTRATO V5).
 * Cada instalação publica o que leu das próprias fontes em <pasta>/CORTEX-SYNC/maquinas/<id>/ e lê as pastas
 * das outras máquinas (e os pacotes importados em <dados>/importados/) como fontes "remoto".
 * Regras: só escreve na própria pasta; nunca reexporta o que veio de fora; escrita atômica (tmp + rename);
 * pacote parcial/corrompido (nuvem sincronizando no meio) é ignorado, com ALERTA uma vez e nova tentativa.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const chokidar = require('chokidar');
const config = require('./config');
const { readJSON, writeJSON, slug } = require('./util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const FORMATO = 1;
const MAX_CONTEUDO = 200 * 1024;
const ANTIGO_MS = 14 * 864e5;
const TIPOS_SIN = ['LINK', 'EMBED', 'PAI', 'TOCA', 'SEQ', 'DIA', 'BRANCH', 'TAG'];
const PADRAO = { ativo: false, pasta: null, intervaloMin: 2, compartilhar: { notas: 'conteudo', git: true, sessoes: true, pastas: true, diario: true }, esquecidas: [] };

let ctx = null; // { log, telemetry, aoMudarRemotos(motivo), obterGrafo(), broadcast(msg), versaoApp }
let maq = null;
const remotos = new Map(); // id -> { id, nome, origem, dir, arquivo, mtimeMs, size, status, erro, geradoEm, manifesto, pacote, parcial }
let watcher = null;
let timerPub = null, timerRetry = null, timerVarredura = null;
let ultimaPublicacao = null, ultimoHashLocal = null, publicando = null, erro = null;

// ------------------------------------------------------------ identidade e config
function maquina() {
  if (maq) return maq;
  const arq = path.join(config.DADOS_DIR, 'maquina.json');
  maq = readJSON(arq, null);
  if (!maq || !maq.id) {
    maq = { id: crypto.randomUUID(), nome: os.hostname() || 'PC', criadoEm: Date.now() };
    try { writeJSON(arq, maq); } catch { /* pasta só de leitura: id só desta sessão */ }
  }
  return maq;
}

function cfg() {
  const c = config.get();
  const s = c.sync || {};
  return { ...PADRAO, ...s, compartilhar: { ...PADRAO.compartilhar, ...(s.compartilhar || {}) }, esquecidas: Array.isArray(s.esquecidas) ? s.esquecidas : [] };
}

const raizSync = () => { const c = cfg(); return c.pasta ? path.join(c.pasta, 'CORTEX-SYNC') : null; };
const pastaImportados = () => path.join(config.DADOS_DIR, 'importados');

// sugestões de pasta já sincronizada por um serviço de nuvem (só as que existem)
function sugestoes() {
  const home = os.homedir();
  const env = process.env;
  const cands = [];
  if (process.platform === 'win32') {
    if (env.OneDrive) cands.push(['OneDrive', env.OneDrive]);
    if (env.OneDriveConsumer) cands.push(['OneDrive pessoal', env.OneDriveConsumer]);
    if (env.OneDriveCommercial) cands.push(['OneDrive corporativo', env.OneDriveCommercial]);
    cands.push(['Google Drive', path.join(home, 'Google Drive')], ['Google Drive (G:)', 'G:\\My Drive'], ['Google Drive (G:)', 'G:\\Meu Drive']);
    cands.push(['Dropbox', path.join(home, 'Dropbox')], ['iCloud Drive', path.join(env.USERPROFILE || home, 'iCloudDrive')]);
  } else {
    if (env.OneDrive) cands.push(['OneDrive', env.OneDrive]);
    cands.push(['OneDrive', path.join(home, 'OneDrive')], ['Google Drive', path.join(home, 'Google Drive')], ['Google Drive', path.join(home, 'GoogleDrive')],
      ['Google Drive', path.join(home, 'google-drive')], ['Dropbox', path.join(home, 'Dropbox')], ['iCloud Drive', path.join(home, 'iCloudDrive')],
      ['iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')]);
  }
  const vistos = new Set();
  const out = [];
  for (const [rotulo, caminho] of cands) {
    if (!caminho) continue;
    const k = path.resolve(caminho).toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    try { if (fs.statSync(caminho).isDirectory()) out.push({ rotulo, caminho: path.resolve(caminho) }); } catch { /* não existe */ }
  }
  return out;
}

// ------------------------------------------------------------ pacote: montar e publicar
function hashLocal(G) {
  const h = crypto.createHash('sha1');
  for (const n of G.interno.nos) if (n._origemLocal) { const b = n._local || n; h.update(n.id + (b.hash || '') + (b.modificado || 0) + '|'); }
  h.update(':' + G.interno.sinapsesLocais.length + JSON.stringify(cfg().compartilhar) + maquina().nome);
  return h.digest('hex');
}

function compartilha(n, comp) {
  if (n.tipo === 'dia') return false;
  if (n.fonte === 'diario') return comp.diario;
  if (n.fonte === 'git') return comp.git;
  if (n.fonte === 'claude') return comp.sessoes;
  if (n.fonte === 'pasta') return comp.pastas;
  return true; // notas do Obsidian (conteúdo controlado por comp.notas)
}

const EXTRA_OK = {
  commit: ['sha', 'fonteRef', 'pais', 'mais', 'menos', 'refs', 'autorNome', 'nArquivos'],
  sessao: ['sessionId', 'cwd', 'branch', 'versao', 'modelo', 'msgsUser', 'msgsAssist', 'ferramentas', 'totalFerramentas', 'duracaoMs', 'prompts', 'agente', 'mtimeMs'],
  arquivo: ['rel', 'toques', 'linhas', 'worktrees', 'ultimaRef'],
  nota: ['rel', 'tagsTexto', 'aliases', 'diario'],
  doc: ['rel', 'ext', 'tamanho', 'trecho'],
  branch: ['ref', 'sha'], worktree: ['branch', 'head'],
};

async function montarPacote(G) {
  const comp = cfg().compartilhar;
  const I = G.interno;
  const nos = [];
  const idx = new Map(); // índice interno -> índice no pacote
  const conteudos = {};
  const leituras = [];
  I.nos.forEach((n, i) => {
    if (!n._origemLocal || !compartilha(n, comp)) return;
    const b = n._local ? { ...n, ...n._local } : n; // versão local (nunca a que veio de outra máquina)
    const extra = {};
    for (const k of EXTRA_OK[n.tipo] || []) if (b.extra && b.extra[k] !== undefined) extra[k] = b.extra[k];
    if (n.tipo === 'commit' && b.extra && b.extra.arquivos) extra.arquivos = b.extra.arquivos.slice(0, 40);
    if (n.tipo === 'sessao' && b.extra) extra.arquivos = (b.extra.arquivos || []).slice(-100);
    const semConteudo = n.tipo === 'nota' && n.fonte !== 'diario' && comp.notas === 'metadados';
    const x = {
      chave: n.chave, tipo: n.tipo, fonte: n.fonte, titulo: b.titulo, projeto: I.nomeProj.get(n.projeto) || n.projeto, subregiao: n.subregiao,
      criado: Math.round(b.criado), modificado: Math.round(b.modificado), palavras: b.palavras, autor: b.autor, hash: b.hash, caminho: b.caminho || null, extra,
    };
    if (b.tagsAutor && b.tagsAutor.length) x.tagsAutor = b.tagsAutor;
    if (n.worktrees && n.worktrees.length) x.worktrees = n.worktrees;
    if (n.tipo === 'sessao' && b._eventos) x.eventos = b._eventos.slice(-200).map((e) => [e.t, e.ferramenta, e.arquivo ? path.basename(e.arquivo) : null]);
    if ((n.tipo === 'nota' || n.tipo === 'doc') && !semConteudo && b.caminho) {
      leituras.push(fs.promises.readFile(b.caminho, 'utf8').then((t) => {
        conteudos[n.chave] = t.length > MAX_CONTEUDO ? t.slice(0, MAX_CONTEUDO) + '\n\n…(cortado em 200 KB)' : t;
      }).catch(() => { x.texto = (b.texto || '').slice(0, 4000); }));
    } else if (!semConteudo) x.texto = (b.texto || '').slice(0, 4000);
    idx.set(i, nos.length);
    nos.push(x);
  });
  await Promise.all(leituras);
  const sinapses = [];
  for (const e of I.sinapsesLocais) {
    const s = G.publico.sinapses[e];
    const a = idx.get(s.a), b = idx.get(s.b);
    if (a === undefined || b === undefined) continue;
    sinapses.push([a, b, TIPOS_SIN.indexOf(s.tipo), s.peso]);
  }
  return { formato: FORMATO, maquina: maquina(), versaoApp: ctx.versaoApp, geradoEm: Date.now(), nos, sinapses, conteudos };
}

function manifestoDe(pacote) {
  const cont = { neuronios: pacote.nos.length, notas: 0, commits: 0, sessoes: 0, diario: 0 };
  const projetos = new Set();
  for (const n of pacote.nos) {
    projetos.add(n.projeto);
    if (n.fonte === 'diario') cont.diario++;
    else if (n.tipo === 'nota') cont.notas++;
    else if (n.tipo === 'commit') cont.commits++;
    else if (n.tipo === 'sessao' && !(n.extra && n.extra.agente)) cont.sessoes++;
  }
  const fontes = config.get().fontes.map((f) => ({ tipo: f.tipo, projeto: f.projeto || null, caminho: f.caminho }));
  return { id: pacote.maquina.id, nome: pacote.maquina.nome, versaoApp: pacote.versaoApp, geradoEm: pacote.geradoEm, contadores: cont, projetos: [...projetos].sort(), fontes };
}

async function escreverAtomico(arq, dados) {
  await fs.promises.mkdir(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, dados);
  await fs.promises.rename(tmp, arq);
}

async function serializar(G) {
  const t0 = Date.now();
  const pacote = await montarPacote(G);
  const json = Buffer.from(JSON.stringify(pacote));
  const gz = await gzip(json, { level: 6 });
  return { pacote, gz, bruto: json.length, ms: Date.now() - t0 };
}

// publica na pasta de sync (se ligada). forcar: publica mesmo sem mudança local
async function publicar({ forcar = false, motivo = '' } = {}) {
  const c = cfg();
  const G = ctx && ctx.obterGrafo();
  if (!c.ativo || !c.pasta || !G) return null;
  if (publicando) return publicando;
  publicando = (async () => {
    try {
      const t0 = Date.now();
      const h = hashLocal(G);
      if (!forcar && h === ultimoHashLocal) return { pulado: true };
      const { pacote, gz, bruto, ms } = await serializar(G);
      const dir = path.join(raizSync(), 'maquinas', maquina().id);
      await escreverAtomico(path.join(dir, 'pacote.json.gz'), gz);
      const man = manifestoDe(pacote);
      man.bytes = gz.length;
      await escreverAtomico(path.join(dir, 'manifesto.json'), JSON.stringify(man, null, 2));
      garantirLeiaMe();
      ultimoHashLocal = h;
      ultimaPublicacao = { em: Date.now(), neuronios: pacote.nos.length, sinapses: pacote.sinapses.length, bytes: gz.length, bytesBruto: bruto, ms: Date.now() - t0, msMontar: ms };
      erro = null;
      ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `PUBLICADO · ${pacote.nos.length} NEURÔNIOS · ${(gz.length / 1048576).toFixed(1)} MB${motivo ? ' · ' + motivo.toUpperCase() : ''}` });
      avisar();
      return ultimaPublicacao;
    } catch (e) {
      erro = 'falha ao publicar: ' + e.message;
      ctx.telemetry.emitir({ nivel: 'ALERTA', fonte: 'sistema', msg: 'SYNC ' + erro.toUpperCase() });
      avisar();
      return { erro };
    } finally { publicando = null; }
  })();
  return publicando;
}

// depois de cada reconstrução: publica, no máximo a cada intervaloMin
function agendarPublicacao() {
  const c = cfg();
  if (!c.ativo || !c.pasta || timerPub) return;
  const intervalo = Math.max(0.25, Number(c.intervaloMin) || 2) * 60000;
  const desde = ultimaPublicacao ? Date.now() - ultimaPublicacao.em : Infinity;
  const espera = desde >= intervalo ? 1500 : intervalo - desde;
  timerPub = setTimeout(() => { timerPub = null; publicar({ motivo: 'reconstrução' }); }, espera);
  timerPub.unref();
}

function garantirLeiaMe() {
  const arq = path.join(raizSync(), 'LEIA-ME.txt');
  if (fs.existsSync(arq)) return;
  try {
    fs.writeFileSync(arq, [
      'CÓRTEX · pasta de sincronização entre PCs',
      '',
      'Cada PC com o CÓRTEX escreve só na própria pasta em maquinas/<id>/ (manifesto.json e pacote.json.gz).',
      'Os outros PCs leem esses pacotes e juntam tudo no cérebro deles. Não edite os arquivos à mão.',
      'Para um PC parar de compartilhar: CONFIGURAÇÕES → SINCRONIZAÇÃO → desligar.',
      '',
    ].join('\r\n'));
  } catch { /* opcional */ }
}

// ------------------------------------------------------------ leitura das outras máquinas
function candidatos() {
  const c = cfg();
  const out = [];
  const eu = maquina().id;
  if (c.ativo && c.pasta) {
    const dir = path.join(raizSync(), 'maquinas');
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { ents = []; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === eu || c.esquecidas.includes(e.name)) continue;
      out.push({ id: e.name, origem: 'pasta', arquivo: path.join(dir, e.name, 'pacote.json.gz'), manifesto: path.join(dir, e.name, 'manifesto.json') });
    }
  }
  let imps = [];
  try { imps = fs.readdirSync(pastaImportados()).filter((f) => f.endsWith('.cortexpack')); } catch { imps = []; }
  for (const f of imps) {
    const id = f.replace(/\.cortexpack$/, '');
    if (id === eu || c.esquecidas.includes(id) || out.some((x) => x.id === id)) continue;
    out.push({ id, origem: 'importado', arquivo: path.join(pastaImportados(), f) });
  }
  return out;
}

async function lerPacote(arquivo) {
  const buf = await fs.promises.readFile(arquivo);
  const json = buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : buf;
  const p = JSON.parse(json.toString('utf8'));
  if (!p || p.formato !== FORMATO || !Array.isArray(p.nos) || !p.maquina || !p.maquina.id) throw new Error(`formato desconhecido (${p && p.formato})`);
  return p;
}

// relê o que mudou; devolve true se algum pacote novo entrou ou saiu.
// forcar: tenta de novo também os que falharam com o mesmo arquivo (nova tentativa de 30 s)
async function lerRemotos(forcar = false) {
  const cands = candidatos();
  let mudou = false;
  let falhou = false;
  const vistos = new Set();
  for (const c of cands) {
    vistos.add(c.id);
    let st;
    try { st = await fs.promises.stat(c.arquivo); } catch { st = null; }
    const atual = remotos.get(c.id);
    if (!st) {
      if (!atual) remotos.set(c.id, { id: c.id, nome: c.id.slice(0, 8), origem: c.origem, arquivo: c.arquivo, status: 'ERRO', erro: 'sem pacote ainda', pacote: null });
      continue;
    }
    const mesmo = (m, z) => m === st.mtimeMs && z === st.size;
    if (atual && atual.pacote && mesmo(atual.mtimeMs, atual.size)) continue; // nada novo
    if (!forcar && atual && atual.erro && mesmo(atual.erroMtime, atual.erroSize)) { falhou = true; continue; } // mesmo arquivo ruim
    try {
      const p = await lerPacote(c.arquivo);
      if (p.maquina.id === maquina().id) { remotos.delete(c.id); continue; } // nunca lê a si mesmo
      const novo = { id: c.id, nome: p.maquina.nome || c.id.slice(0, 8), origem: c.origem, arquivo: c.arquivo, mtimeMs: st.mtimeMs, size: st.size,
        status: Date.now() - p.geradoEm > ANTIGO_MS ? 'ANTIGO' : 'OK', geradoEm: p.geradoEm, versaoApp: p.versaoApp, pacote: p, parcial: null };
      remotos.set(c.id, novo); // sem campo erro: a versão boa substitui o aviso
      mudou = true;
      ctx.telemetry.emitir({ nivel: 'PULSO', fonte: 'sistema', msg: `RECEBIDO DE ${String(novo.nome).toUpperCase()} · ${p.nos.length} NEURÔNIOS${c.origem === 'importado' ? ' · IMPORTADO' : ''}` });
    } catch (e) {
      // arquivo parcial (nuvem copiando) ou corrompido: mantém a última versão boa, avisa uma vez por arquivo e tenta de novo
      const msg = e.message.slice(0, 160);
      const antes = atual || { id: c.id, nome: c.id.slice(0, 8), origem: c.origem, arquivo: c.arquivo, pacote: null, status: 'ERRO' };
      const jaAvisou = antes.erro && mesmo(antes.erroMtime, antes.erroSize);
      remotos.set(c.id, { ...antes, status: antes.pacote ? antes.status : 'ERRO', erro: msg, erroMtime: st.mtimeMs, erroSize: st.size });
      if (!jaAvisou) ctx.telemetry.emitir({ nivel: 'ALERTA', fonte: 'sistema', msg: `SYNC PACOTE ILEGÍVEL DE ${String(antes.nome).toUpperCase()} (${msg}) · TENTO DE NOVO EM 30 S` });
      falhou = true;
    }
  }
  for (const id of [...remotos.keys()]) if (!vistos.has(id)) { remotos.delete(id); mudou = true; }
  if (falhou && !timerRetry && ctx) {
    timerRetry = setTimeout(async () => {
      timerRetry = null;
      if (!ctx) return;
      if (await lerRemotos(true)) await ctx.aoMudarRemotos('pacote recebido');
      avisar();
    }, 30000);
    timerRetry.unref();
  }
  if (mudou) avisar();
  return mudou;
}

// pacotes remotos no formato de leitura de fonte (server/graph.js)
function parciaisRemotas() {
  const out = [];
  const apel = config.get().apelidos || {};
  const { globParaRegex } = require('./projeto');
  const regras = Object.entries(apel).map(([g, p]) => [globParaRegex(g), p]);
  const apelido = (nome) => { for (const [re, p] of regras) if (re.test(nome)) return p; return nome; };
  for (const r of remotos.values()) {
    if (!r.pacote) continue;
    if (!r.parcial) {
      const p = r.pacote;
      const nos = p.nos.map((x) => {
        const corpo = p.conteudos ? p.conteudos[x.chave] : undefined;
        const n = {
          chave: x.chave, tipo: x.tipo, fonte: x.fonte, titulo: x.titulo, subregiao: x.subregiao || 'raiz', criado: x.criado, modificado: x.modificado,
          palavras: x.palavras || 0, autor: x.autor, hash: x.hash || '', caminho: x.caminho, extra: x.extra || {},
          texto: x.texto !== undefined ? x.texto : (corpo ? corpo.slice(0, 4000) : ''),
          projetoNota: apelido(x.projeto || 'sem-projeto'), remoto: true, maquina: r.nome, maquinas: [r.nome], maquinaId: r.id,
        };
        if (x.tagsAutor) n.tagsAutor = x.tagsAutor;
        if (x.worktrees) n.worktrees = x.worktrees;
        if (x.eventos) n._eventos = x.eventos.map(([t, ferramenta, arquivo]) => ({ t, ferramenta, arquivo }));
        if (corpo !== undefined) n._conteudo = corpo;
        if (n.tipo === 'sessao' && n.extra) n.extra.arquivos = n.extra.arquivos || [];
        return n;
      });
      const links = (p.sinapses || []).map(([a, b, t, w]) => ({ de: nos[a].chave, para: nos[b].chave, tipo: TIPOS_SIN[t] || 'LINK', peso: w }));
      r.parcial = { nos, links, eventos: [], itens: nos.length };
    }
    out.push({ fonte: { id: 'rem_' + r.id, tipo: 'remoto', projeto: null, caminho: r.arquivo, maquina: r.nome, interno: true }, r: r.parcial });
  }
  return out;
}

function statusRemotos() {
  return [...remotos.values()].map((r) => ({ id: 'rem_' + r.id, tipo: 'remoto', caminho: r.arquivo, projeto: null, maquina: r.nome, origem: r.origem,
    status: r.pacote ? r.status : 'ERRO', itens: r.pacote ? r.pacote.nos.length : 0, ...(r.erro ? { erro: r.erro } : {}), interno: true }));
}

// ------------------------------------------------------------ vigilância da pasta
function vigiar() {
  pararVigia();
  const c = cfg();
  if (!c.ativo || !c.pasta) return;
  const dir = path.join(raizSync(), 'maquinas');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { erro = 'pasta de sync inacessível: ' + e.message; avisar(); return; }
  let t = null;
  watcher = chokidar.watch(dir, { ignoreInitial: true, depth: 2, ignored: (p) => p.endsWith('.tmp') });
  const disparar = (p) => {
    if (p && p.includes(path.join('maquinas', maquina().id))) return; // a minha própria publicação
    clearTimeout(t);
    t = setTimeout(async () => { if (await lerRemotos()) ctx.aoMudarRemotos('pacote recebido'); }, 5000);
  };
  for (const ev of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) watcher.on(ev, disparar);
  watcher.on('error', () => { /* pasta de nuvem pode sumir por um tempo */ });
  // serviços de nuvem nem sempre geram eventos: varredura leve a cada intervalo
  timerVarredura = setInterval(async () => { if (await lerRemotos()) ctx.aoMudarRemotos('pacote recebido'); }, Math.max(0.5, Number(c.intervaloMin) || 2) * 60000);
  timerVarredura.unref();
}

function pararVigia() {
  if (watcher) { watcher.close().catch(() => {}); watcher = null; }
  clearInterval(timerVarredura); timerVarredura = null;
}

// ------------------------------------------------------------ estado / API
function estado() {
  const c = cfg();
  const eu = maquina();
  const maquinas = [];
  if (c.ativo && c.pasta) maquinas.push({ id: eu.id, nome: eu.nome, eu: true, geradoEm: ultimaPublicacao ? ultimaPublicacao.em : null, neuronios: ultimaPublicacao ? ultimaPublicacao.neuronios : 0,
    projetos: null, status: erro ? 'ERRO' : 'OK', origem: 'local' });
  for (const r of remotos.values()) {
    maquinas.push({ id: r.id, nome: r.nome, eu: false, geradoEm: r.geradoEm || null, neuronios: r.pacote ? r.pacote.nos.length : 0,
      projetos: r.pacote ? [...new Set(r.pacote.nos.map((n) => n.projeto))].sort() : [], status: r.pacote ? r.status : 'ERRO', origem: r.origem, ...(r.erro ? { erro: r.erro } : {}) });
  }
  if (eu && maquinas.length && maquinas[0].eu) {
    const G = ctx && ctx.obterGrafo();
    if (G) maquinas[0].projetos = [...new Set(G.interno.nos.filter((n) => n._origemLocal && n.tipo !== 'dia').map((n) => G.interno.nomeProj.get(n.projeto) || n.projeto))].sort();
  }
  return { ativo: !!c.ativo, pasta: c.pasta, maquina: { id: eu.id, nome: eu.nome }, compartilhar: c.compartilhar, intervaloMin: c.intervaloMin,
    ultimaPublicacao, ...(erro ? { erro } : {}), sugestoes: sugestoes(), maquinas };
}

function avisar() { if (ctx && ctx.broadcast) ctx.broadcast({ tipo: 'sync', ...estado() }); }

function validar(o) {
  const erros = [];
  const novo = {};
  if (o.ativo !== undefined) { if (typeof o.ativo !== 'boolean') erros.push({ campo: 'sync.ativo', erro: 'precisa ser verdadeiro/falso' }); else novo.ativo = o.ativo; }
  if (o.pasta !== undefined) {
    if (o.pasta === null || o.pasta === '') novo.pasta = null;
    else if (typeof o.pasta !== 'string') erros.push({ campo: 'sync.pasta', erro: 'precisa ser um caminho' });
    else {
      const p = path.resolve(o.pasta.trim());
      try { if (!fs.statSync(p).isDirectory()) throw new Error(); novo.pasta = p; } catch { erros.push({ campo: 'sync.pasta', erro: 'pasta não existe' }); }
    }
  }
  if (o.nome !== undefined) { const nm = String(o.nome).trim(); if (!nm || nm.length > 40) erros.push({ campo: 'sync.nome', erro: 'nome de 1 a 40 caracteres' }); else novo.nome = nm; }
  if (o.intervaloMin !== undefined) { const n = Number(o.intervaloMin); if (!Number.isFinite(n) || n < 0.5 || n > 1440) erros.push({ campo: 'sync.intervaloMin', erro: 'entre 0.5 e 1440 minutos' }); else novo.intervaloMin = n; }
  if (o.compartilhar !== undefined) {
    const cp = o.compartilhar;
    if (!cp || typeof cp !== 'object') erros.push({ campo: 'sync.compartilhar', erro: 'precisa ser objeto' });
    else {
      novo.compartilhar = {};
      if (cp.notas !== undefined) { if (!['conteudo', 'metadados'].includes(cp.notas)) erros.push({ campo: 'sync.compartilhar.notas', erro: 'use conteudo ou metadados' }); else novo.compartilhar.notas = cp.notas; }
      for (const k of ['git', 'sessoes', 'pastas', 'diario']) if (cp[k] !== undefined) { if (typeof cp[k] !== 'boolean') erros.push({ campo: 'sync.compartilhar.' + k, erro: 'precisa ser verdadeiro/falso' }); else novo.compartilhar[k] = cp[k]; }
    }
  }
  if (novo.ativo === true && !(novo.pasta || cfg().pasta)) erros.push({ campo: 'sync.pasta', erro: 'escolha uma pasta antes de ligar' });
  return { erros, novo };
}

// aplica (já validado). Devolve { mudancas[] }
async function definir(o) {
  const { erros, novo } = validar(o || {});
  if (erros.length) return { erros };
  const c = config.get();
  const antes = cfg();
  const mudancas = [];
  if (novo.nome !== undefined && novo.nome !== maquina().nome) {
    maq.nome = novo.nome;
    writeJSON(path.join(config.DADOS_DIR, 'maquina.json'), maq);
    mudancas.push('sync.nome');
  }
  const s = { ...antes, ...(c.sync || {}) };
  for (const k of ['ativo', 'pasta', 'intervaloMin']) if (novo[k] !== undefined && novo[k] !== antes[k]) { s[k] = novo[k]; mudancas.push('sync.' + k); }
  if (novo.compartilhar) { const cp = { ...antes.compartilhar, ...novo.compartilhar }; if (JSON.stringify(cp) !== JSON.stringify(antes.compartilhar)) { s.compartilhar = cp; mudancas.push('sync.compartilhar'); } }
  c.sync = { ativo: s.ativo, pasta: s.pasta, intervaloMin: s.intervaloMin, compartilhar: s.compartilhar, esquecidas: s.esquecidas || [] };
  config.salvar();
  if (mudancas.some((m) => m === 'sync.ativo' || m === 'sync.pasta' || m === 'sync.intervaloMin')) {
    vigiar();
    remotos.forEach((r, id) => { if (r.origem === 'pasta') remotos.delete(id); });
    await lerRemotos();
    ctx.aoMudarRemotos('sincronização reconfigurada');
  }
  if (mudancas.length && cfg().ativo) { ultimoHashLocal = null; await publicar({ forcar: true, motivo: 'configuração' }); }
  avisar();
  return { mudancas };
}

async function agora() {
  const pub = await publicar({ forcar: true, motivo: 'manual' });
  remotos.forEach((r) => { r.mtimeMs = -1; });
  const mudou = await lerRemotos(true);
  if (mudou) await ctx.aoMudarRemotos('sincronizar agora');
  return { publicado: pub, recebidos: mudou };
}

async function exportar(caminho) {
  const G = ctx.obterGrafo();
  if (!G) throw Object.assign(new Error('o cérebro ainda está montando'), { status: 503 });
  if (!caminho) throw Object.assign(new Error('informe o caminho do arquivo'), { status: 400 });
  let arq = path.resolve(String(caminho));
  if (!/\.cortexpack$/i.test(arq)) arq += '.cortexpack';
  const { pacote, gz } = await serializar(G);
  await escreverAtomico(arq, gz);
  ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `EXPORTADO ${pacote.nos.length} NEURÔNIOS → ${path.basename(arq)} (${(gz.length / 1048576).toFixed(1)} MB)` });
  return { caminho: arq, bytes: gz.length, neuronios: pacote.nos.length, sinapses: pacote.sinapses.length };
}

async function importar(caminho) {
  if (!caminho) throw Object.assign(new Error('informe o caminho do pacote'), { status: 400 });
  const arq = path.resolve(String(caminho));
  let p;
  try { p = await lerPacote(arq); } catch (e) { throw Object.assign(new Error('pacote inválido: ' + e.message), { status: 400 }); }
  if (p.maquina.id === maquina().id) throw Object.assign(new Error('esse pacote é deste próprio PC'), { status: 400 });
  const destino = path.join(pastaImportados(), p.maquina.id + '.cortexpack');
  await fs.promises.mkdir(pastaImportados(), { recursive: true });
  await fs.promises.copyFile(arq, destino + '.tmp');
  await fs.promises.rename(destino + '.tmp', destino);
  const c = config.get();
  if (c.sync && Array.isArray(c.sync.esquecidas) && c.sync.esquecidas.includes(p.maquina.id)) { c.sync.esquecidas = c.sync.esquecidas.filter((x) => x !== p.maquina.id); config.salvar(); }
  remotos.delete(p.maquina.id);
  await lerRemotos();
  await ctx.aoMudarRemotos('pacote importado');
  return { maquina: p.maquina, neuronios: p.nos.length, geradoEm: p.geradoEm, caminho: destino };
}

async function esquecer(id) {
  const c = config.get();
  const r = remotos.get(id);
  const existe = r || candidatos().some((x) => x.id === id);
  if (!existe) return false;
  if (r && r.origem === 'importado') { try { fs.rmSync(r.arquivo, { force: true }); } catch { /* já foi */ } }
  else {
    c.sync = { ...cfg(), ...(c.sync || {}) };
    c.sync.esquecidas = [...new Set([...(c.sync.esquecidas || []), id])];
    config.salvar();
  }
  remotos.delete(id);
  ctx.telemetry.emitir({ nivel: 'ALERTA', fonte: 'sistema', msg: `MÁQUINA ESQUECIDA ${r ? String(r.nome).toUpperCase() : id}` });
  await ctx.aoMudarRemotos('máquina esquecida');
  avisar();
  return true;
}

async function iniciar(c) {
  ctx = c;
  maq = null; remotos.clear(); ultimaPublicacao = null; ultimoHashLocal = null; erro = null;
  maquina();
  vigiar();
  await lerRemotos();
}

// ao fechar: publica uma última vez e para de vigiar
async function parar() {
  clearTimeout(timerPub); timerPub = null;
  clearTimeout(timerRetry); timerRetry = null;
  pararVigia();
  try { if (ctx && cfg().ativo) await publicar({ motivo: 'encerrando' }); } catch { /* fecha mesmo assim */ }
  ctx = null;
}

module.exports = { iniciar, parar, maquina, cfg, estado, definir, validar, agora, exportar, importar, esquecer, publicar, agendarPublicacao, lerRemotos, parciaisRemotas, statusRemotos, sugestoes, PADRAO };
