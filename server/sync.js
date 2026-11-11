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
const gh = require('./sync-github');
const { readJSON, writeJSON, slug } = require('./util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const FORMATO = 1; // pacote único (.cortexpack e versão anterior)
const FORMATO_PARTE = 2; // manifesto + uma parte por fonte
const MAX_CONTEUDO = 200 * 1024;
const ANTIGO_MS = 14 * 864e5;
const TIPOS_SIN = ['LINK', 'EMBED', 'PAI', 'TOCA', 'SEQ', 'DIA', 'BRANCH', 'TAG'];
// V6: modo "github" é o padrão (repo privado <usuario>/cortex-dados); "pasta" (OneDrive etc.) fica como avançado
const PADRAO = { ativo: false, modo: 'github', repo: null, repoUrl: null, pasta: null, intervaloMin: 2, compartilhar: { notas: 'conteudo', git: true, sessoes: true, pastas: true, diario: true }, esquecidas: [] };
const FETCH_MS = () => Number(process.env.CORTEX_GITHUB_FETCH_MS) || 60000;

let ctx = null; // { log, telemetry, aoMudarRemotos(motivo), obterGrafo(), broadcast(msg), versaoApp }
let maq = null;
const remotos = new Map(); // id -> { id, nome, origem, dir, arquivo, mtimeMs, size, status, erro, geradoEm, manifesto, pacote, parcial }
let watcher = null;
let timerPub = null, timerRetry = null, timerVarredura = null, timerGithub = null;
let refsGithub = []; // [{ id, ref, commit }] do último fetch
let blobsPublicados = new Map(); // modo github: arquivo -> blob sha da minha branch
let ultimaPublicacao = null, publicando = null, erro = null;

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
const modoGithub = () => cfg().modo !== 'pasta';
// pronto para publicar/ler: github com credencial e repo OK, ou pasta escolhida
function transporteAtivo() {
  const c = cfg();
  if (!c.ativo) return false;
  return modoGithub() ? gh.pronto() : !!c.pasta;
}
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
// V5.1: um arquivo por fonte local (maquinas/<id>/<fonteId>.json.gz) + manifesto com o hash de cada parte.
// Só a parte cujo conteúdo mudou é reescrita (uma sessão ativa troca só o pacote pequeno das sessões).
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

const nomeArquivoParte = (fonteId) => slug(fonteId) + '.json.gz';

// grupos por fonte local: { fonteId -> { idxs: [índices de nós], arestas: [índices de sinapses] } }
function grupos(G) {
  const comp = cfg().compartilhar;
  const I = G.interno;
  const g = new Map();
  const de = new Map(); // índice do nó -> fonteId
  I.nos.forEach((n, i) => {
    if (!n._origemLocal || !compartilha(n, comp)) return;
    const f = n._fonteId || 'local';
    if (!g.has(f)) g.set(f, { idxs: [], arestas: [] });
    g.get(f).idxs.push(i);
    de.set(i, f);
  });
  for (const [e, f] of I.sinapsesLocais) {
    const s = G.publico.sinapses[e];
    if (!de.has(s.a) || !de.has(s.b)) continue;
    const dono = g.has(f) ? f : de.get(s.a); // a sinapse vai com a fonte que a criou
    g.get(dono).arestas.push(e);
  }
  return g;
}

// hash barato do conteúdo de uma parte (antes de serializar): muda só quando algo dela muda
function preHash(G, grupo) {
  const I = G.interno;
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(cfg().compartilhar) + '|' + maquina().nome + '|' + FORMATO_PARTE);
  for (const i of grupo.idxs) {
    const n = I.nos[i];
    const b = n._local ? { ...n, ...n._local } : n;
    h.update(`${n.id}|${b.hash || ''}|${Math.round(b.modificado || 0)}|${b.titulo}|${b.palavras}|${n.subregiao}|${(n.worktrees || []).join(',')}|`);
    if (n.tipo === 'sessao' && b.extra) h.update(`${b.extra.totalFerramentas}|${b.extra.msgsUser}|${b.extra.duracaoMs}|`);
  }
  for (const e of grupo.arestas) { const s = G.publico.sinapses[e]; h.update(`${I.nos[s.a].id}>${I.nos[s.b].id}${s.tipo}${s.peso};`); }
  return h.digest('hex').slice(0, 20);
}

function noDoPacote(G, n, comp, conteudos, leituras) {
  const I = G.interno;
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
  return x;
}

// monta um pacote com os nós dos índices dados. Sinapses: [a, b, tipo, peso]; a/b = índice no pacote ou chave (nó de outra parte)
async function montar(G, idxs, arestas) {
  const comp = cfg().compartilhar;
  const I = G.interno;
  const nos = [], conteudos = {}, leituras = [];
  const pos = new Map();
  for (const i of idxs) { pos.set(i, nos.length); nos.push(noDoPacote(G, I.nos[i], comp, conteudos, leituras)); }
  await Promise.all(leituras);
  const sinapses = arestas.map((e) => {
    const s = G.publico.sinapses[e];
    const a = pos.has(s.a) ? pos.get(s.a) : I.nos[s.a].chave;
    const b = pos.has(s.b) ? pos.get(s.b) : I.nos[s.b].chave;
    return [a, b, TIPOS_SIN.indexOf(s.tipo), s.peso];
  });
  return { nos, sinapses, conteudos };
}

// pacote único (formato 1): .cortexpack exportado
async function montarPacote(G) {
  const gs = grupos(G);
  const idxs = [], arestas = [];
  for (const g of gs.values()) { idxs.push(...g.idxs); arestas.push(...g.arestas); }
  const corpo = await montar(G, idxs, arestas);
  return { formato: FORMATO, maquina: maquina(), versaoApp: ctx.versaoApp, geradoEm: Date.now(), ...corpo };
}

function fontesInfo() {
  const m = new Map(config.get().fontes.map((f) => [f.id, f]));
  m.set('src_diario', { id: 'src_diario', tipo: 'diario', projeto: null });
  return m;
}

function manifestoBase(partes) {
  const cont = { neuronios: 0, notas: 0, commits: 0, sessoes: 0, diario: 0 };
  const projetos = new Set();
  for (const p of partes) {
    cont.neuronios += p.neuronios;
    for (const k of ['notas', 'commits', 'sessoes', 'diario']) cont[k] += p.contadores[k] || 0;
    for (const pr of p.projetos) projetos.add(pr);
  }
  const fontes = config.get().fontes.map((f) => ({ id: f.id, tipo: f.tipo, projeto: f.projeto || null, caminho: f.caminho }));
  const eu = maquina();
  return { formato: FORMATO_PARTE, id: eu.id, nome: eu.nome, versaoApp: ctx.versaoApp, geradoEm: Date.now(), contadores: cont, projetos: [...projetos].sort(), fontes, partes };
}

function contadoresParte(nos) {
  const c = { notas: 0, commits: 0, sessoes: 0, diario: 0 };
  const projetos = new Set();
  for (const n of nos) {
    projetos.add(n.projeto);
    if (n.fonte === 'diario') c.diario++;
    else if (n.tipo === 'nota') c.notas++;
    else if (n.tipo === 'commit') c.commits++;
    else if (n.tipo === 'sessao' && !(n.extra && n.extra.agente)) c.sessoes++;
  }
  return { c, projetos: [...projetos].sort() };
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

let partesPublicadas = new Map();
let timerConvergir = null; // arquivo -> entrada do manifesto já escrita

// publica na pasta de sync (se ligada), só as partes que mudaram. forcar: reescreve todas
async function publicar({ forcar = false, motivo = '' } = {}) {
  const c = cfg();
  const G = ctx && ctx.obterGrafo();
  if (!transporteAtivo() || !G) return null;
  if (publicando) return publicando;
  const github = modoGithub();
  publicando = (async () => {
    try {
      const t0 = Date.now();
      const dir = github ? null : path.join(raizSync(), 'maquinas', maquina().id);
      if (!partesPublicadas.size && !forcar) {
        // reabriu o app: aproveita o manifesto já publicado (na pasta ou na minha branch do GitHub)
        let man = null;
        if (github) {
          blobsPublicados = await gh.minhaArvore(maquina().id);
          if (blobsPublicados.has('manifesto.json')) { try { man = JSON.parse((await gh.blob(blobsPublicados.get('manifesto.json'))).toString('utf8')); } catch { man = null; } }
          if (man && man.formato === FORMATO_PARTE && Array.isArray(man.partes)) for (const p of man.partes) if (blobsPublicados.has(p.arquivo)) partesPublicadas.set(p.arquivo, p);
        } else {
          man = readJSON(path.join(dir, 'manifesto.json'), null);
          if (man && man.formato === FORMATO_PARTE && Array.isArray(man.partes)) for (const p of man.partes) if (fs.existsSync(path.join(dir, p.arquivo))) partesPublicadas.set(p.arquivo, p);
        }
      }
      const novosGit = new Map(); // modo github: arquivo -> Buffer
      const gs = grupos(G);
      const info = fontesInfo();
      const partes = [];
      const escritas = [];
      let bytesEscritos = 0;
      for (const [fonteId, g] of gs) {
        const arquivo = nomeArquivoParte(fonteId);
        const hash = preHash(G, g);
        const ant = partesPublicadas.get(arquivo);
        if (!forcar && ant && ant.hash === hash) { partes.push(ant); continue; }
        const corpo = await montar(G, g.idxs, g.arestas);
        const f = info.get(fonteId) || { tipo: '?', projeto: null };
        const parte = { formato: FORMATO_PARTE, maquina: maquina(), fonte: { id: fonteId, tipo: f.tipo, projeto: f.projeto || null }, hash, geradoEm: Date.now(), ...corpo };
        const gz = await gzip(Buffer.from(JSON.stringify(parte)), { level: 6 });
        if (github) novosGit.set(arquivo, gz);
        else await escreverAtomico(path.join(dir, arquivo), gz);
        const { c: cont, projetos } = contadoresParte(corpo.nos);
        const entrada = { arquivo, fonte: fonteId, tipo: f.tipo, projeto: f.projeto || null, hash, neuronios: corpo.nos.length, sinapses: corpo.sinapses.length, bytes: gz.length, geradoEm: parte.geradoEm, contadores: cont, projetos };
        partes.push(entrada);
        escritas.push(entrada);
        bytesEscritos += gz.length;
      }
      // partes de fontes que sumiram (ou que deixaram de ser compartilhadas)
      const atuais = new Set(partes.map((p) => p.arquivo));
      let removidas = 0;
      for (const arq of [...partesPublicadas.keys()]) if (!atuais.has(arq)) { if (!github) { try { fs.rmSync(path.join(dir, arq), { force: true }); } catch { /* já foi */ } } removidas++; }
      if (!escritas.length && !removidas && partesPublicadas.size && !forcar) return { pulado: true };
      const man = manifestoBase(partes);
      const manTxt = JSON.stringify(man, null, 2);
      if (github) {
        // um commit órfão com todas as partes (as inalteradas reaproveitam o blob já publicado)
        const manter = new Map();
        for (const p of partes) if (!novosGit.has(p.arquivo) && blobsPublicados.has(p.arquivo)) manter.set(p.arquivo, blobsPublicados.get(p.arquivo));
        for (const p of partes) if (!novosGit.has(p.arquivo) && !manter.has(p.arquivo)) throw new Error(`parte ${p.arquivo} sumiu do clone local; republicando tudo na próxima`);
        novosGit.set('manifesto.json', Buffer.from(manTxt));
        const r = await gh.publicar(maquina().id, novosGit, manter);
        blobsPublicados = await gh.minhaArvore(maquina().id);
        if (!r.mudou && !forcar) { partesPublicadas = new Map(partes.map((p) => [p.arquivo, p])); return { pulado: true, motivo: 'árvore igual à publicada' }; }
      } else {
        await escreverAtomico(path.join(dir, 'manifesto.json'), manTxt); // manifesto por último: quem lê nunca vê hash de parte que ainda não existe
        try { fs.rmSync(path.join(dir, 'pacote.json.gz'), { force: true }); } catch { /* formato antigo */ }
        garantirLeiaMe();
      }
      partesPublicadas = new Map(partes.map((p) => [p.arquivo, p]));
      const total = partes.reduce((a, p) => a + p.bytes, 0);
      ultimaPublicacao = { em: Date.now(), neuronios: man.contadores.neuronios, sinapses: partes.reduce((a, p) => a + p.sinapses, 0), bytes: total,
        bytesEscritos: bytesEscritos + manTxt.length, partesEscritas: escritas.map((p) => p.arquivo), partes: partes.length, ms: Date.now() - t0 };
      erro = null;
      ultimaPublicacao.via = github ? 'github' : 'pasta';
      ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `PUBLICADO${github ? ' NO GITHUB' : ''} · ${escritas.length} DE ${partes.length} PARTES · ${(bytesEscritos / 1024).toFixed(0)} KB ENVIADOS${motivo ? ' · ' + motivo.toUpperCase() : ''}` });
      avisar();
      if (github) setImmediate(() => cicloGithub().catch(() => {})); // logo depois de publicar, vê se os outros mudaram
      return ultimaPublicacao;
    } catch (e) {
      if (github && /sumiu do clone/.test(e.message)) { partesPublicadas = new Map(); blobsPublicados = new Map(); }
      erro = 'falha ao publicar: ' + gh.limpar(e.message);
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
  if (!transporteAtivo() || timerPub) return;
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
      'Cada PC com o CÓRTEX escreve só na própria pasta em maquinas/<id>/: manifesto.json e um <fonte>.json.gz por fonte.',
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
  if (c.ativo && modoGithub()) {
    for (const r of refsGithub) {
      if (r.id === eu || c.esquecidas.includes(r.id)) continue;
      out.push({ id: r.id, origem: 'github', ref: r.ref, commit: r.commit });
    }
  } else if (c.ativo && c.pasta) {
    const dir = path.join(raizSync(), 'maquinas');
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { ents = []; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === eu || c.esquecidas.includes(e.name)) continue;
      out.push({ id: e.name, origem: 'pasta', dir: path.join(dir, e.name), arquivo: path.join(dir, e.name, 'pacote.json.gz'), manifesto: path.join(dir, e.name, 'manifesto.json') });
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

async function lerGz(arquivo) {
  const buf = await fs.promises.readFile(arquivo);
  const json = buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : buf;
  return JSON.parse(json.toString('utf8'));
}

async function lerPacote(arquivo) {
  const p = await lerGz(arquivo);
  if (!p || p.formato !== FORMATO || !Array.isArray(p.nos) || !p.maquina || !p.maquina.id) throw new Error(`formato desconhecido (${p && p.formato})`);
  return p;
}

// lê uma máquina: manifesto com partes (só as de hash novo) ou pacote único (formato 1 / importado).
// devolve { mudou, bytes, partesLidas } ou lança erro (o chamador mantém a versão boa anterior)
async function lerMaquina(c, atual, forcar) {
  if (c.origem === 'github') return lerMaquinaGithub(c, atual);
  const r = atual && atual.partes ? atual : { id: c.id, nome: c.id.slice(0, 8), origem: c.origem, dir: c.dir, arquivo: c.arquivo, partes: new Map(), status: 'ERRO' };
  let man = null;
  if (c.manifesto) {
    try { man = JSON.parse(await fs.promises.readFile(c.manifesto, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('manifesto ilegível: ' + e.message); }
  }
  if (man && man.formato === FORMATO_PARTE && Array.isArray(man.partes)) {
    if (man.id === maquina().id) return { eu: true };
    let mudou = false, bytes = 0;
    const lidas = [];
    const novas = new Map();
    for (const p of man.partes) {
      const ja = r.partes.get(p.arquivo);
      if (ja && ja.hash === p.hash) { novas.set(p.arquivo, ja); continue; } // mesma parte: não baixa de novo
      const arq = path.join(c.dir, p.arquivo);
      const parte = await lerGz(arq);
      if (!parte || parte.formato !== FORMATO_PARTE || parte.hash !== p.hash) throw new Error(`parte ${p.arquivo} ainda sincronizando (hash diferente do manifesto)`);
      novas.set(p.arquivo, { hash: p.hash, pacote: parte, parcial: null, bytes: p.bytes });
      bytes += p.bytes || 0;
      lidas.push(p.arquivo);
      mudou = true;
    }
    if (novas.size !== r.partes.size || [...r.partes.keys()].some((k) => !novas.has(k))) mudou = true;
    Object.assign(r, { nome: man.nome || r.nome, partes: novas, geradoEm: man.geradoEm, versaoApp: man.versaoApp, status: Date.now() - man.geradoEm > ANTIGO_MS ? 'ANTIGO' : 'OK', formato: FORMATO_PARTE });
    delete r.erro;
    return { r, mudou, bytes, lidas };
  }
  // formato 1: pacote único (versão anterior do app, ou .cortexpack importado)
  const st = await fs.promises.stat(c.arquivo).catch(() => null);
  if (!st) throw Object.assign(new Error('sem pacote ainda'), { semPacote: true });
  const ja = r.partes.get('pacote');
  if (ja && ja.mtimeMs === st.mtimeMs && ja.size === st.size) return { r, mudou: false, bytes: 0, lidas: [] };
  const p = await lerPacote(c.arquivo);
  if (p.maquina.id === maquina().id) return { eu: true };
  r.partes = new Map([['pacote', { hash: String(st.mtimeMs) + ':' + st.size, mtimeMs: st.mtimeMs, size: st.size, pacote: p, parcial: null, bytes: st.size }]]);
  Object.assign(r, { nome: p.maquina.nome || r.nome, geradoEm: p.geradoEm, versaoApp: p.versaoApp, status: Date.now() - p.geradoEm > ANTIGO_MS ? 'ANTIGO' : 'OK', formato: FORMATO });
  delete r.erro;
  return { r, mudou: true, bytes: st.size, lidas: ['pacote'] };
}

// branch maquina/<id> no GitHub: lê o manifesto e só as partes cujo blob mudou
async function lerMaquinaGithub(c, atual) {
  const r = atual && atual.partes ? atual : { id: c.id, nome: c.id.slice(0, 8), origem: 'github', partes: new Map(), status: 'ERRO' };
  if (r.commit === c.commit && r.partes.size) return { r, mudou: false, bytes: 0, lidas: [] };
  const arv = await gh.arvore(c.ref);
  if (!arv.has('manifesto.json')) throw Object.assign(new Error('branch sem manifesto'), { semPacote: true });
  const man = JSON.parse((await gh.blob(arv.get('manifesto.json'))).toString('utf8'));
  if (man.id === maquina().id) return { eu: true };
  if (man.formato !== FORMATO_PARTE || !Array.isArray(man.partes)) throw new Error(`formato desconhecido (${man.formato})`);
  let mudou = false, bytes = 0;
  const lidas = [];
  const novas = new Map();
  for (const p of man.partes) {
    const sha = arv.get(p.arquivo);
    if (!sha) throw new Error(`parte ${p.arquivo} ausente no commit`);
    const ja = r.partes.get(p.arquivo);
    if (ja && (ja.blob === sha || ja.hash === p.hash)) { novas.set(p.arquivo, { ...ja, blob: sha }); continue; } // mesmo blob: não lê de novo
    const buf = await gh.blob(sha);
    const parte = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : buf).toString('utf8'));
    if (!parte || parte.formato !== FORMATO_PARTE || parte.hash !== p.hash) throw new Error(`parte ${p.arquivo} inconsistente com o manifesto`);
    novas.set(p.arquivo, { hash: p.hash, blob: sha, pacote: parte, parcial: null, bytes: buf.length });
    bytes += buf.length;
    lidas.push(p.arquivo);
    mudou = true;
  }
  if (novas.size !== r.partes.size || [...r.partes.keys()].some((k) => !novas.has(k))) mudou = true;
  Object.assign(r, { nome: man.nome || r.nome, partes: novas, commit: c.commit, geradoEm: man.geradoEm, versaoApp: man.versaoApp, status: Date.now() - man.geradoEm > ANTIGO_MS ? 'ANTIGO' : 'OK', formato: FORMATO_PARTE });
  delete r.erro;
  return { r, mudou, bytes, lidas };
}

// relê o que mudou; devolve true se algo entrou ou saiu. forcar: relê tudo (inclusive o que falhou antes)
async function lerRemotos(forcar = false) {
  const cands = candidatos();
  let mudou = false, falhou = false;
  const vistos = new Set();
  for (const c of cands) {
    vistos.add(c.id);
    const atual = remotos.get(c.id);
    try {
      const res = await lerMaquina(c, atual, forcar);
      if (res.eu) { remotos.delete(c.id); continue; } // nunca lê a si mesmo
      remotos.set(c.id, res.r);
      if (res.mudou) {
        mudou = true;
        const n = [...res.r.partes.values()].reduce((a, p) => a + p.pacote.nos.length, 0);
        if (res.lidas.length) ctx.telemetry.emitir({ nivel: 'PULSO', fonte: 'sistema', msg: `RECEBIDO DE ${String(res.r.nome).toUpperCase()} · ${res.lidas.length} PARTE(S) · ${(res.bytes / 1024).toFixed(0)} KB · ${n} NEURÔNIOS${c.origem === 'importado' ? ' · IMPORTADO' : ''}` });
      }
    } catch (e) {
      const msg = e.message.slice(0, 160);
      const antes = atual || { id: c.id, nome: c.id.slice(0, 8), origem: c.origem, dir: c.dir, arquivo: c.arquivo, partes: new Map(), status: 'ERRO' };
      const temDados = antes.partes && antes.partes.size > 0;
      if (e.semPacote) { remotos.set(c.id, { ...antes, status: temDados ? antes.status : 'ERRO', erro: msg }); continue; }
      // parcial (nuvem copiando) ou corrompido: mantém a última versão boa, avisa uma vez por mensagem e tenta de novo
      const jaAvisou = antes.erro === msg;
      remotos.set(c.id, { ...antes, status: temDados ? antes.status : 'ERRO', erro: msg });
      if (!jaAvisou) ctx.telemetry.emitir({ nivel: 'ALERTA', fonte: 'sistema', msg: `SYNC PACOTE ILEGÍVEL DE ${String(antes.nome).toUpperCase()} (${msg}) · TENTO DE NOVO EM 30 S` });
      falhou = true;
    }
  }
  // GitHub fora do ar / sem credencial: mantém o que já foi lido (não some com os outros PCs por falta de rede)
  const manterGithub = modoGithub() && cfg().ativo && !gh.pronto();
  for (const [id, r] of [...remotos.entries()]) {
    if (vistos.has(id)) continue;
    if (manterGithub && r.origem === 'github') continue;
    remotos.delete(id); mudou = true;
  }
  if (falhou && !timerRetry && ctx) {
    timerRetry = setTimeout(async () => {
      timerRetry = null;
      if (!ctx) return;
      if (await lerRemotos()) await ctx.aoMudarRemotos('pacote recebido');
      avisar();
    }, 30000);
    timerRetry.unref();
  }
  if (mudou) avisar();
  return mudou;
}

// partes remotas no formato de leitura de fonte (server/graph.js); uma fonte "remoto" por parte
function parciaisRemotas() {
  const out = [];
  const apel = config.get().apelidos || {};
  const { globParaRegex } = require('./projeto');
  const regras = Object.entries(apel).map(([g, p]) => [globParaRegex(g), p]);
  const apelido = (nome) => { for (const [re, p] of regras) if (re.test(nome)) return p; return nome; };
  for (const r of remotos.values()) {
    for (const [arq, parte] of r.partes || []) {
      if (!parte.pacote) continue;
      if (!parte.parcial) {
        const p = parte.pacote;
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
        const ref = (v) => (typeof v === 'number' ? (nos[v] ? nos[v].chave : null) : v); // número = nesta parte; texto = chave de outra parte
        const links = (p.sinapses || []).map(([a, b, t, w]) => ({ de: ref(a), para: ref(b), tipo: TIPOS_SIN[t] || 'LINK', peso: w })).filter((l) => l.de && l.para);
        parte.parcial = { nos, links, eventos: [], itens: nos.length };
      }
      out.push({ fonte: { id: `rem_${r.id}_${arq}`, tipo: 'remoto', projeto: null, caminho: r.dir || r.arquivo, maquina: r.nome, interno: true }, r: parte.parcial });
    }
  }
  return out;
}

const neuroniosDe = (r) => [...(r.partes || new Map()).values()].reduce((a, p) => a + (p.pacote ? p.pacote.nos.length : 0), 0);
const projetosDe = (r) => [...new Set([...(r.partes || new Map()).values()].flatMap((p) => (p.pacote ? p.pacote.nos.map((n) => n.projeto) : [])))].sort();

function statusRemotos() {
  return [...remotos.values()].map((r) => ({ id: 'rem_' + r.id, tipo: 'remoto', caminho: r.dir || r.arquivo, projeto: null, maquina: r.nome, origem: r.origem,
    status: (r.partes && r.partes.size) || r.formato ? r.status : 'ERRO', itens: neuroniosDe(r), partes: r.partes ? r.partes.size : 0, ...(r.erro ? { erro: r.erro } : {}), interno: true }));
}

// ------------------------------------------------------------ vigilância da pasta
// modo github: fetch a cada 60 s (e logo depois de publicar); tenta preparar de novo se faltou rede/credencial
let cicloRodando = null;
let ciclos = 0;
async function cicloGithub() {
  if (!ctx || !modoGithub() || !cfg().ativo) return false;
  if (cicloRodando) return cicloRodando;
  cicloRodando = (async () => {
    try {
      if (!gh.pronto()) {
        const antes = gh.estado().estado;
        await gh.preparar(cfg());
        if (gh.pronto() && antes !== 'OK') {
          ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `SYNC GITHUB PRONTO · ${gh.estado().repo}${gh.estado().usuario ? ' · ' + gh.estado().usuario : ''}` });
          partesPublicadas = new Map();
          agendarPublicacao();
        }
        avisar();
        if (!gh.pronto()) return false;
      }
      const antes = JSON.stringify(refsGithub);
      try { refsGithub = await gh.buscar(); } catch { avisar(); return false; } // sem rede: tenta no próximo ciclo
      if (++ciclos % 60 === 0) gh.limparObjetos(); // commits órfãos antigos (meus e dos outros) não acumulam no clone
      if (JSON.stringify(refsGithub) === antes && remotos.size) { avisar(); return false; }
      const mudou = await lerRemotos();
      if (mudou) await ctx.aoMudarRemotos('recebido do GitHub');
      avisar();
      return mudou;
    } finally { cicloRodando = null; }
  })();
  return cicloRodando;
}

function vigiar() {
  pararVigia();
  const c = cfg();
  if (!c.ativo) return;
  if (modoGithub()) {
    timerGithub = setInterval(() => { cicloGithub().catch(() => {}); }, FETCH_MS());
    timerGithub.unref();
    return;
  }
  if (!c.pasta) return;
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
  clearInterval(timerGithub); timerGithub = null;
  if (watcher) { watcher.close().catch(() => {}); watcher = null; }
  clearInterval(timerVarredura); timerVarredura = null;
}

// ------------------------------------------------------------ estado / API
function estado() {
  const c = cfg();
  const eu = maquina();
  const maquinas = [];
  if (transporteAtivo() || (c.ativo && ultimaPublicacao)) maquinas.push({ id: eu.id, nome: eu.nome, eu: true, geradoEm: ultimaPublicacao ? ultimaPublicacao.em : null, neuronios: ultimaPublicacao ? ultimaPublicacao.neuronios : 0,
    partes: partesPublicadas.size,
    projetos: null, status: erro ? 'ERRO' : 'OK', origem: 'local' });
  for (const r of remotos.values()) {
    const tem = (r.partes && r.partes.size > 0) || !!r.formato; // manifesto lido (mesmo sem partes: PC sem fontes)
    maquinas.push({ id: r.id, nome: r.nome, eu: false, geradoEm: r.geradoEm || null, neuronios: neuroniosDe(r), partes: r.partes ? r.partes.size : 0,
      projetos: projetosDe(r), status: tem && !r.erro ? r.status : (tem ? r.status : 'ERRO'), origem: r.origem, ...(r.erro ? { erro: r.erro } : {}) });
  }
  if (eu && maquinas.length && maquinas[0].eu) {
    const G = ctx && ctx.obterGrafo();
    if (G) maquinas[0].projetos = [...new Set(G.interno.nos.filter((n) => n._origemLocal && n.tipo !== 'dia').map((n) => G.interno.nomeProj.get(n.projeto) || n.projeto))].sort();
  }
  return { ativo: !!c.ativo, modo: modoGithub() ? 'github' : 'pasta', github: { ...gh.estado(), repoConfigurado: c.repo || null, ...(c.repoUrl ? { repoUrl: c.repoUrl } : {}) },
    pasta: c.pasta, maquina: { id: eu.id, nome: eu.nome }, compartilhar: c.compartilhar, intervaloMin: c.intervaloMin,
    ultimaPublicacao, ...(erro ? { erro } : {}), sugestoes: sugestoes(), maquinas,
    diagnostico: { pastaOneDrive: pastaOneDrive(), outrasMaquinasNaPasta: cfg().pasta ? outrasMaquinasEm(cfg().pasta) : 0, contaOneDrive: process.env.OneDrive || null } };
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
      // cria a pasta quando pedido (botão "usar OneDrive") ou quando fica dentro do OneDrive deste PC
      const od = pastaOneDrive();
      if (!fs.existsSync(p) && (o.criar || (od && p.toLowerCase().startsWith(path.dirname(od).toLowerCase())))) { try { fs.mkdirSync(p, { recursive: true }); } catch { /* cai no erro abaixo */ } }
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
  if (o.modo !== undefined) { if (!['github', 'pasta'].includes(o.modo)) erros.push({ campo: 'sync.modo', erro: 'use github ou pasta' }); else novo.modo = o.modo; }
  if (o.repo !== undefined) {
    if (o.repo === null || o.repo === '') novo.repo = null;
    else if (typeof o.repo !== 'string' || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(o.repo.trim())) erros.push({ campo: 'sync.repo', erro: 'use usuario/repositorio' });
    else novo.repo = o.repo.trim();
  }
  if (o.repoUrl !== undefined) {
    if (o.repoUrl === null || o.repoUrl === '') novo.repoUrl = null;
    else if (typeof o.repoUrl !== 'string' || /\/\/[^/]*@/.test(o.repoUrl)) erros.push({ campo: 'sync.repoUrl', erro: 'URL inválida (não coloque usuário/token na URL)' });
    else novo.repoUrl = o.repoUrl.trim();
  }
  const modoFinal = novo.modo || cfg().modo;
  if (novo.ativo === true && modoFinal === 'pasta' && !(novo.pasta || cfg().pasta)) erros.push({ campo: 'sync.pasta', erro: 'escolha uma pasta antes de ligar' });
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
  for (const k of ['ativo', 'pasta', 'intervaloMin', 'modo', 'repo', 'repoUrl']) if (novo[k] !== undefined && novo[k] !== antes[k]) { s[k] = novo[k]; mudancas.push('sync.' + k); }
  if (novo.modo !== undefined) s.modoEscolhido = true; // escolha explícita: a migração automática não mexe mais
  if (novo.compartilhar) { const cp = { ...antes.compartilhar, ...novo.compartilhar }; if (JSON.stringify(cp) !== JSON.stringify(antes.compartilhar)) { s.compartilhar = cp; mudancas.push('sync.compartilhar'); } }
  c.sync = { ...(c.sync || {}), ativo: s.ativo, modo: s.modo, repo: s.repo || null, repoUrl: s.repoUrl || null, pasta: s.pasta, intervaloMin: s.intervaloMin,
    compartilhar: s.compartilhar, esquecidas: s.esquecidas || [], ...(s.modoEscolhido ? { modoEscolhido: true } : {}) };
  config.salvar();
  const transporteMudou = mudancas.some((m) => ['sync.ativo', 'sync.pasta', 'sync.intervaloMin', 'sync.modo', 'sync.repo', 'sync.repoUrl'].includes(m));
  if (transporteMudou) {
    // destino novo (ou religado): o que foi publicado antes não está lá, então publica tudo de novo
    partesPublicadas = new Map(); blobsPublicados = new Map(); refsGithub = [];
    remotos.forEach((r, id) => { if (r.origem === 'pasta' || r.origem === 'github') remotos.delete(id); });
    if (modoGithub() && cfg().ativo) { gh.reiniciar(); await gh.preparar(cfg()); }
    vigiar();
    if (modoGithub()) await cicloGithub(); else await lerRemotos();
    ctx.aoMudarRemotos('sincronização reconfigurada');
  }
  if (mudancas.length && transporteAtivo()) await publicar({ forcar: mudancas.some((m) => ['sync.pasta', 'sync.compartilhar', 'sync.nome', 'sync.modo', 'sync.repo', 'sync.repoUrl'].includes(m)), motivo: 'configuração' });
  avisar();
  return { mudancas };
}

async function agora() {
  if (modoGithub() && cfg().ativo && !gh.pronto()) await cicloGithub();
  const pub = await publicar({ motivo: 'manual' }); // só as partes que mudaram
  if (modoGithub()) { try { refsGithub = (await gh.buscar()) || refsGithub; } catch { /* sem rede */ } }
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

// O instalador deixa <dados>/sync-auto.json { pasta } quando acha o OneDrive. Aplica uma vez só,
// e só se a sincronização nunca foi configurada neste PC (escolha do usuário sempre vence).
// Sem o aviso do instalador, mas com OneDrive neste PC e nada configurado: liga sozinho em <OneDrive>\CORTEX,
// a mesma pasta em todos os PCs (o usuário não precisa saber qual é). Desligar no app grava ativo:false e isso não volta.
function pastaOneDrive() {
  const e = process.env;
  for (const n of [e.OneDrive, e.OneDriveConsumer, e.OneDriveCommercial]) if (n && fs.existsSync(n)) return path.join(n, 'CORTEX');
  return null;
}

function aplicarSyncAuto() {
  const arq = path.join(config.DADOS_DIR, 'sync-auto.json');
  if (modoGithub()) { try { fs.rmSync(arq, { force: true }); } catch { /* tanto faz */ } return; } // V6: o GitHub junta os PCs
  let auto = readJSON(arq, null);
  try { fs.rmSync(arq, { force: true }); } catch { /* tanto faz */ }
  const c = config.get();
  if (c.sync && (c.sync.pasta || c.sync.ativo === false)) return; // o usuário já escolheu (ou desligou)
  if (!auto || !auto.pasta) { const od = pastaOneDrive(); if (!od) return; auto = { pasta: od }; }
  try { fs.mkdirSync(auto.pasta, { recursive: true }); } catch (e) { ctx.telemetry.emitir({ nivel: 'ALERTA', fonte: 'sistema', msg: `SYNC AUTOMÁTICO FALHOU: ${e.message}` }); return; }
  c.sync = { ...PADRAO, ...(c.sync || {}), ativo: true, pasta: auto.pasta };
  config.salvar();
  ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `SINCRONIZAÇÃO LIGADA PELO INSTALADOR → ${auto.pasta}` });
}

// Quantas OUTRAS máquinas publicaram numa pasta de sync (olha só os manifestos, não lê pacotes)
function outrasMaquinasEm(pasta) {
  try {
    const dir = path.join(pasta, 'CORTEX-SYNC', 'maquinas');
    return fs.readdirSync(dir).filter((id) => id !== maquina().id && fs.existsSync(path.join(dir, id, 'manifesto.json'))).length;
  } catch { return 0; }
}

// Convergência: todos os PCs devem acabar na mesma pasta sem o usuário saber qual é.
// Se este PC está sozinho na pasta atual e o OneDrive\CORTEX é outro lugar, muda para lá
// (a escolha manual só é mantida quando ela de fato junta este PC com outro).
function convergir() {
  if (modoGithub()) return null; // V6: a convergência para o OneDrive só existe no modo pasta
  const c = config.get();
  const s = c.sync || {};
  if (s.ativo === false && s.pasta) return null; // desligado de propósito
  const od = pastaOneDrive();
  if (!od) return null;
  const atual = s.pasta ? path.resolve(s.pasta) : null;
  if (atual && atual.toLowerCase() === path.resolve(od).toLowerCase()) return null;
  if (atual && outrasMaquinasEm(atual) > 0) return null; // a pasta escolhida já junta PCs: respeita
  try { fs.mkdirSync(od, { recursive: true }); } catch { return null; }
  c.sync = { ...PADRAO, ...s, ativo: true, pasta: od };
  config.salvar();
  partesPublicadas = new Map();
  ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `SYNC: ${atual ? 'SOZINHO EM ' + atual + ' · ' : ''}MUDANDO PARA ${od} (MESMA PASTA EM TODOS OS PCs)` });
  return od;
}

// Migração 2.2.0: o modo github vira o padrão em todos os PCs, mesmo os que estavam em OneDrive
// (contas de OneDrive diferentes nunca se juntam; a conta do GitHub é a identidade comum).
// Sem git: mantém o modo anterior. Sem credencial: fica em github com PRECISA_ENTRAR (e não usa o OneDrive).
async function migrarModoGithub() {
  const c = config.get();
  const s = c.sync || {};
  if (s.migradoV22 || s.modoEscolhido) return null;
  if (!(await gh.temGit())) { c.sync = { ...PADRAO, ...s, migradoV22: true, modo: s.pasta ? 'pasta' : 'github' }; config.salvar(); return 'sem-git'; }
  const antes = s.modo || (s.pasta ? 'pasta' : 'github');
  c.sync = { ...PADRAO, ...s, modo: 'github', ativo: true, migradoV22: true };
  config.salvar();
  ctx.telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `SINCRONIZAÇÃO AGORA PELO GITHUB (REPOSITÓRIO PRIVADO)${antes === 'pasta' ? ' · O ONEDRIVE DEIXOU DE SER USADO' : ''}` });
  return antes;
}

// login interativo no GitHub (abre o navegador); ao terminar, prepara e sincroniza sozinho
function entrarGithub() {
  const r = gh.entrar(async (ok, msg) => {
    if (!ctx) return;
    ctx.telemetry.emitir({ nivel: ok ? 'INFO' : 'ALERTA', fonte: 'sistema', msg: ok ? 'GITHUB: LOGIN CONCLUÍDO' : `GITHUB: LOGIN NÃO CONCLUÍDO (${msg || 'cancelado'})` });
    const c = config.get();
    if (ok && c.sync && c.sync.ativo === false) { c.sync.ativo = true; config.salvar(); }
    gh.reiniciar();
    await cicloGithub().catch(() => {});
    avisar();
  });
  avisar();
  return { ...r, github: gh.estado() };
}

async function iniciar(c) {
  ctx = c;
  maq = null; remotos.clear(); ultimaPublicacao = null; erro = null; partesPublicadas = new Map(); blobsPublicados = new Map(); refsGithub = [];
  gh.reiniciar();
  maquina();
  try { await migrarModoGithub(); } catch (e) { ctx.log('sync: migração para o GitHub falhou:', e.message); }
  aplicarSyncAuto();
  convergir();
  // de 5 em 5 min: se outro PC aparecer no OneDrive enquanto este está sozinho noutra pasta, junta
  clearInterval(timerConvergir);
  timerConvergir = setInterval(async () => {
    try { if (convergir()) { vigiar(); remotos.forEach((r, id) => { if (r.origem === 'pasta') remotos.delete(id); }); await lerRemotos(); ctx.aoMudarRemotos('sincronização: pasta do OneDrive'); await publicar({ forcar: true, motivo: 'pasta do OneDrive' }); } } catch { /* tenta de novo depois */ }
  }, 5 * 60000);
  if (timerConvergir.unref) timerConvergir.unref();
  vigiar();
  if (modoGithub() && cfg().ativo) {
    // credencial + repositório + fetch em segundo plano: o boot não espera a rede
    cicloGithub().catch(() => {});
  } else await lerRemotos();
}

// ao fechar: publica uma última vez e para de vigiar
async function parar() {
  clearInterval(timerConvergir); timerConvergir = null;
  clearTimeout(timerPub); timerPub = null;
  clearTimeout(timerRetry); timerRetry = null;
  pararVigia();
  // publica uma última vez, sem segurar o fechamento por mais de 20 s (push lento)
  try { if (ctx && cfg().ativo) await Promise.race([publicar({ motivo: 'encerrando' }), new Promise((r) => setTimeout(r, 20000).unref())]); } catch { /* fecha mesmo assim */ }
  ctx = null;
}

module.exports = { entrarGithub, cicloGithub, iniciar, parar, maquina, cfg, estado, definir, validar, agora, exportar, importar, esquecer, publicar, agendarPublicacao, lerRemotos, parciaisRemotas, statusRemotos, sugestoes, PADRAO };
