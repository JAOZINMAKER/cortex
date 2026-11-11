'use strict';
/*
 * Sincronização pelo GitHub (CONTRATO V6). Transporte do server/sync.js no modo "github".
 *
 * - Identidade: a conta do GitHub que o git do PC já conhece (`git credential fill`, sem prompt nem janela).
 * - Repositório PRIVADO <usuario>/cortex-dados (criado se não existir; nunca cria repositório público).
 * - Clone local mínimo em <DADOS>/sync-git (git init + fetch). A URL não leva o token; o token vai só em
 *   `-c http.extraheader=...` na linha de comando do fetch/push e é apagado de qualquer mensagem de erro.
 * - Cada máquina publica um commit ÓRFÃO na branch maquina/<id> (push -f): o histórico não cresce.
 * - Leitura: fetch de refs/heads/maquina/* e `git cat-file blob` das partes cujo blob mudou.
 * - Teste: sync.repoUrl (ex.: file:///…/bare.git) pula credenciais e API.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const config = require('./config');

const ESTADOS = ['OK', 'PRECISA_ENTRAR', 'SEM_GIT', 'ERRO', 'PREPARANDO'];
const ENV_NAO_INTERATIVO = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_GUI_PROMPT: 'false' };
const IDENT = { GIT_AUTHOR_NAME: 'CORTEX', GIT_AUTHOR_EMAIL: 'cortex@localhost', GIT_COMMITTER_NAME: 'CORTEX', GIT_COMMITTER_EMAIL: 'cortex@localhost' };

const st = {
  estado: 'PREPARANDO', erro: null, usuario: null, repo: null, url: null, privado: null,
  ultimoFetch: null, ultimoPush: null, ultimoErroRede: null, entrando: false,
};
let segredo = null; // { usuario, token } só em memória
let segredosConhecidos = []; // strings a esconder em qualquer mensagem

const dirClone = () => path.join(config.DADOS_DIR, 'sync-git');

// ------------------------------------------------------------ utilidades
function limpar(txt) {
  let s = String(txt || '');
  for (const seg of segredosConhecidos) if (seg && seg.length >= 4) s = s.split(seg).join('***');
  return s.replace(/(AUTHORIZATION:\s*basic\s+)[A-Za-z0-9+/=]+/gi, '$1***').replace(/(https?:\/\/)[^@\s/]+@/g, '$1***@');
}

function run(args, { cwd, input, env = {}, timeout = 60000, buffer = false, auth = false } = {}) {
  return new Promise((resolve, reject) => {
    const pre = [];
    if (auth && segredo && segredo.token) {
      const b64 = Buffer.from(`${segredo.usuario || 'x-access-token'}:${segredo.token}`).toString('base64');
      segredosConhecidos = [...new Set([segredo.token, b64])];
      pre.push('-c', `http.extraheader=AUTHORIZATION: basic ${b64}`);
    }
    const filho = execFile('git', [...pre, ...args], {
      cwd, timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 1024, encoding: buffer ? 'buffer' : 'utf8',
      env: { ...process.env, ...ENV_NAO_INTERATIVO, ...IDENT, ...env },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = limpar(((stderr && stderr.toString()) || err.message || '').trim()).split('\n').filter(Boolean).slice(-3).join(' · ');
        const e = new Error(msg || 'git falhou');
        e.code = err.code; e.semGit = err.code === 'ENOENT';
        e.auth = /authentication failed|could not read username|403|401|permission denied|access denied|invalid username or password|terminal prompts disabled/i.test(msg);
        e.rede = /could not resolve host|unable to access|failed to connect|timed out|connection (reset|refused)|network is unreachable|ssl/i.test(msg) && !e.auth;
        return reject(e);
      }
      resolve(stdout);
    });
    if (input !== undefined) { filho.stdin.on('error', () => {}); filho.stdin.end(input); }
  });
}

async function temGit() {
  try { const v = await run(['--version'], { timeout: 10000 }); return v.trim(); } catch { return null; }
}

// `git credential fill` para github.com, sem nunca abrir prompt (a não ser que interativo=true)
async function credencialFill({ interativo = false, env = {}, timeout } = {}) {
  const extra = interativo ? { GCM_INTERACTIVE: 'always', GIT_TERMINAL_PROMPT: '0', GCM_GUI_PROMPT: 'true' } : {};
  let out;
  try {
    out = await run(['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', env: { ...extra, ...env }, timeout: timeout || (interativo ? 5 * 60000 : 15000) });
  } catch (e) { if (e.semGit) throw e; return null; }
  const o = {};
  for (const l of out.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); }
  if (!o.password) return null;
  return { usuario: o.username || null, token: o.password };
}

async function aprovarCredencial(c, env = {}) {
  try { await run(['credential', 'approve'], { input: `protocol=https\nhost=github.com\nusername=${c.usuario || ''}\npassword=${c.token}\n\n`, env, timeout: 15000 }); } catch { /* opcional */ }
}

async function api(metodo, rota, corpo) {
  const r = await fetch('https://api.github.com' + rota, {
    method: metodo,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${segredo.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'CORTEX', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, json };
}

function definirEstado(estado, erro) {
  st.estado = ESTADOS.includes(estado) ? estado : 'ERRO';
  st.erro = erro ? limpar(erro) : null;
}

// ------------------------------------------------------------ preparo: credencial, repositório, clone
// cfg: { repo, repoUrl }. Devolve o estado.
async function preparar(cfg) {
  if (!(await temGit())) { definirEstado('SEM_GIT', 'o git não está instalado neste PC (https://git-scm.com)'); return st.estado; }
  try {
    if (cfg.repoUrl) {
      segredo = null;
      st.usuario = null; st.repo = cfg.repoUrl; st.url = cfg.repoUrl; st.privado = null;
    } else {
      const cred = await credencialFill();
      if (!cred) { segredo = null; definirEstado('PRECISA_ENTRAR', 'nenhuma conta do GitHub guardada no git deste PC'); return st.estado; }
      segredo = { usuario: cred.usuario, token: cred.token };
      segredosConhecidos = [cred.token];
      if (!segredo.usuario) {
        const u = await api('GET', '/user');
        if (u.status === 401 || u.status === 403) { definirEstado('PRECISA_ENTRAR', 'a credencial do GitHub foi recusada'); return st.estado; }
        if (u.status !== 200 || !u.json || !u.json.login) throw new Error(`GitHub /user respondeu ${u.status}`);
        segredo.usuario = u.json.login;
      }
      st.usuario = segredo.usuario;
      const repo = cfg.repo || `${segredo.usuario}/cortex-dados`;
      st.repo = repo;
      const g = await api('GET', `/repos/${repo}`);
      if (g.status === 401) { definirEstado('PRECISA_ENTRAR', 'a credencial do GitHub foi recusada'); return st.estado; }
      if (g.status === 404) {
        const [dono, nome] = repo.split('/');
        if (dono.toLowerCase() !== String(segredo.usuario).toLowerCase()) throw new Error(`o repositório ${repo} não existe e só crio na sua conta (${segredo.usuario})`);
        const c = await api('POST', '/user/repos', { name: nome, private: true, description: 'Dados do CÓRTEX (sincronização entre PCs)', auto_init: false });
        if (c.status === 401 || c.status === 403) { definirEstado('PRECISA_ENTRAR', 'sem permissão para criar o repositório privado (o token precisa do escopo "repo")'); return st.estado; }
        if (c.status === 422) { // outro PC criou ao mesmo tempo: confere que existe e é privado
          const g2 = await api('GET', `/repos/${repo}`);
          if (g2.status !== 200 || !g2.json.private) throw new Error(`o repositório ${repo} já existe mas não é privado ou não está acessível`);
        } else if (c.status !== 201) throw new Error(`não consegui criar ${repo} (GitHub respondeu ${c.status}${c.json && c.json.message ? ': ' + c.json.message : ''})`);
        st.privado = true;
      } else if (g.status === 200) {
        st.privado = !!g.json.private;
        if (!g.json.private) { definirEstado('ERRO', `o repositório ${repo} é PÚBLICO: o CÓRTEX só guarda dados em repositório privado. Torne-o privado no GitHub ou escolha outro nome.`); return st.estado; }
      } else if (g.status === 403) { definirEstado('PRECISA_ENTRAR', 'o GitHub recusou o acesso (403)'); return st.estado; }
      else throw new Error(`GitHub respondeu ${g.status} para ${repo}`);
      st.url = `https://github.com/${repo}.git`; // sem token: o credential manager (ou o extraheader) autentica
    }
    await garantirClone(st.url);
    definirEstado('OK');
  } catch (e) {
    if (e.semGit) definirEstado('SEM_GIT', 'o git não está instalado neste PC');
    else if (e.auth) definirEstado('PRECISA_ENTRAR', e.message);
    else { st.ultimoErroRede = Date.now(); definirEstado('ERRO', e.name === 'TimeoutError' || /fetch failed|ENOTFOUND|ECONN/i.test(e.message) ? 'sem conexão com o GitHub; tento de novo em seguida' : e.message); }
  }
  return st.estado;
}

async function garantirClone(url) {
  const dir = dirClone();
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    await run(['init', '-q'], { cwd: dir });
  }
  // nunca credencial no config: só a URL limpa e configurações locais neutras
  const atual = await run(['config', '--get', 'remote.origin.url'], { cwd: dir }).catch(() => '');
  if (!atual.trim()) await run(['remote', 'add', 'origin', url], { cwd: dir });
  else if (atual.trim() !== url) await run(['remote', 'set-url', 'origin', url], { cwd: dir });
  await run(['config', 'gc.auto', '256'], { cwd: dir });
  await run(['config', 'core.autocrlf', 'false'], { cwd: dir });
}

const pronto = () => st.estado === 'OK';

// ------------------------------------------------------------ transporte
// fetch das branches maquina/*; devolve [{ id, commit }]
async function buscar() {
  if (!pronto()) return null;
  const dir = dirClone();
  try {
    await run(['fetch', '-q', '--no-tags', '--prune', 'origin', '+refs/heads/maquina/*:refs/remotes/origin/maquina/*'], { cwd: dir, auth: true, timeout: 120000 });
    st.ultimoFetch = Date.now();
    if (st.erro && st.estado === 'OK') st.erro = null;
  } catch (e) {
    if (e.auth) definirEstado('PRECISA_ENTRAR', e.message);
    else st.erro = (e.rede ? 'sem rede: ' : 'fetch falhou: ') + e.message; // continua OK: tenta de novo no próximo ciclo
    throw e;
  }
  return refs();
}

async function refs() {
  const out = await run(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/origin/maquina/'], { cwd: dirClone() }).catch(() => '');
  return out.split('\n').filter(Boolean).map((l) => {
    const [ref, commit] = l.split(' ');
    return { id: ref.slice('refs/remotes/origin/maquina/'.length), ref, commit };
  });
}

// árvore de um ref: Map nome -> blob sha
async function arvore(ref) {
  const out = await run(['ls-tree', ref], { cwd: dirClone() });
  const m = new Map();
  for (const l of out.split('\n')) { const mm = l.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/); if (mm) m.set(mm[2], mm[1]); }
  return m;
}

async function blob(sha) { return run(['cat-file', 'blob', sha], { cwd: dirClone(), buffer: true, timeout: 120000 }); }

// partes já publicadas por mim (para não reescrever depois de reabrir o app)
async function minhaArvore(id) {
  try { return await arvore(`refs/heads/maquina/${id}`); } catch { return new Map(); }
}

// publica: arquivos = Map nome -> Buffer (novos ou mudados); manter = Map nome -> blob sha (inalterados)
// Commit órfão em refs/heads/maquina/<id> + push -f. Devolve { commit, arvore, mudou }
async function publicar(id, arquivos, manter) {
  if (!pronto()) throw new Error('GitHub não está pronto: ' + st.estado);
  const dir = dirClone();
  const tmp = path.join(dir, '.git', 'cortex-publicar');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const nomes = [...arquivos.keys()];
  const shas = new Map(manter);
  if (nomes.length) {
    const caminhos = nomes.map((n, i) => { const p = path.join(tmp, String(i)); fs.writeFileSync(p, arquivos.get(n)); return p; });
    const out = await run(['hash-object', '-w', '--', ...caminhos], { cwd: dir });
    out.trim().split('\n').forEach((sha, i) => shas.set(nomes[i], sha.trim()));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const linhas = [...shas.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, sha]) => `100644 blob ${sha}\t${n}`).join('\n') + '\n';
  const tree = (await run(['mktree'], { cwd: dir, input: linhas })).trim();
  const ref = `refs/heads/maquina/${id}`;
  let anterior = null;
  try { anterior = (await run(['rev-parse', `${ref}^{tree}`], { cwd: dir })).trim(); } catch { /* primeira vez */ }
  const remotoTree = await run(['rev-parse', `refs/remotes/origin/maquina/${id}^{tree}`], { cwd: dir }).then((s) => s.trim()).catch(() => null);
  if (anterior === tree && remotoTree === tree) return { mudou: false, arvore: tree };
  const commit = (await run(['commit-tree', tree, '-m', `CÓRTEX · ${id} · ${new Date().toISOString()}`], { cwd: dir })).trim(); // sem -p: commit órfão
  await run(['update-ref', ref, commit], { cwd: dir });
  try {
    await run(['push', '-q', '-f', 'origin', `${ref}:${ref}`], { cwd: dir, auth: true, timeout: 300000 });
  } catch (e) {
    if (e.auth) definirEstado('PRECISA_ENTRAR', e.message);
    throw e;
  }
  await run(['update-ref', `refs/remotes/origin/maquina/${id}`, commit], { cwd: dir }).catch(() => {});
  st.ultimoPush = Date.now();
  if (st.erro && st.estado === 'OK') st.erro = null;
  return { mudou: true, commit, arvore: tree };
}

async function limparObjetos() {
  try { await run(['gc', '--prune=now', '--quiet'], { cwd: dirClone(), timeout: 120000 }); } catch { /* opcional */ }
}

// ------------------------------------------------------------ login interativo
// GCM 2.x: `git credential-manager github login` abre o navegador. Sem ele: `git credential fill` interativo.
function entrar(aoTerminar) {
  if (st.entrando) return { iniciado: false, motivo: 'login já em andamento' };
  st.entrando = true;
  const env = { ...process.env, ...IDENT, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'always' };
  const fim = async (ok, msg) => {
    st.entrando = false;
    try { await aoTerminar(ok, msg ? limpar(msg) : null); } catch { /* segue */ }
  };
  let saida = '';
  const p = spawn('git', ['credential-manager', 'github', 'login'], { env, windowsHide: false });
  p.stdout.on('data', (d) => { saida += d; });
  p.stderr.on('data', (d) => { saida += d; });
  p.on('error', async () => fim(...(await fillInterativo())));
  p.on('close', async (code) => {
    if (code === 0) return fim(true, null);
    // GCM antigo ou ausente ("is not a git command" / "Unknown command"): plano B
    if (/not a git command|unknown|unrecognized|no such|não é um comando/i.test(saida) || code === 1) return fim(...(await fillInterativo()));
    return fim(false, saida.trim().slice(-300) || `login terminou com código ${code}`);
  });
  return { iniciado: true };
}

async function fillInterativo() {
  try {
    const c = await credencialFill({ interativo: true });
    if (!c) return [false, 'nenhuma credencial informada'];
    await aprovarCredencial(c);
    return [true, null];
  } catch (e) { return [false, e.message]; }
}

function estado() {
  return { usuario: st.usuario, repo: st.repo, estado: st.estado, ...(st.erro ? { erro: st.erro } : {}), privado: st.privado,
    ultimoFetch: st.ultimoFetch, ultimoPush: st.ultimoPush, entrando: st.entrando, clone: dirClone() };
}

function reiniciar() {
  segredo = null; segredosConhecidos = [];
  Object.assign(st, { estado: 'PREPARANDO', erro: null, usuario: null, repo: null, url: null, privado: null, ultimoFetch: null, ultimoPush: null, entrando: false });
}

module.exports = { preparar, pronto, buscar, refs, arvore, blob, minhaArvore, publicar, limparObjetos, entrar, estado, reiniciar, credencialFill, temGit, limpar, run };
