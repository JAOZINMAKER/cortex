'use strict';
/*
 * Instalação das skills do CÓRTEX no Claude Code (%USERPROFILE%\.claude\skills\<nome>).
 * Usado pelo servidor (/api/skills) e pelo instalar.js / CLI. Sem estado, sem efeito colateral no require.
 *
 * API:
 *   listar({ appDir, home? })                  → Skill[]   (lê <appDir>/skills/<nome>/meta.json + SKILL.md e compara com o instalado)
 *   instalar(nome | 'todas', { appDir, home?, cortexDir? }) → { resultados: { nome, caminho, mudou, versao }[] }
 *   remover(nome | 'todas', { appDir, home? })  → { resultados: { nome, caminho, removida, motivo? }[] }
 *   renderizar(texto, cortexDir)              → texto com {{CORTEX_DIR}} trocado (barras "/")
 *   versaoDe(texto)                           → { v: number|null, hash: string }   (<!-- cortex-skill v:N --> ou sha1 de 12)
 *
 *   Skill = { nome, titulo, descricao, executavel, parametros, versaoApp, versaoInstalada, instalada,
 *             status: 'instalada'|'desatualizada'|'nao-instalada', caminho, origem }
 *   home padrão = os.homedir(); cortexDir padrão = appDir (é o que entra no lugar de {{CORTEX_DIR}}).
 *   Só remove pastas que o próprio CÓRTEX instalou (SKILL.md com o marcador "cortex-skill").
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MARCA = /<!--\s*cortex-skill\s+v:(\d+)\s*-->/i;
const barra = (p) => String(p).replace(/\\/g, '/');
const EXT_TEXTO = new Set(['.md', '.txt', '.json', '.js', '.sh', '.ps1', '.cmd', '.bat', '.yml', '.yaml']);

function renderizar(texto, cortexDir) {
  return String(texto).split('{{CORTEX_DIR}}').join(barra(cortexDir));
}

function versaoDe(texto) {
  if (texto === null || texto === undefined) return { v: null, hash: null };
  const m = MARCA.exec(texto);
  return { v: m ? parseInt(m[1], 10) : null, hash: crypto.createHash('sha1').update(String(texto).replace(/\r\n/g, '\n')).digest('hex').slice(0, 12) };
}

const ler = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const pastaSkills = (appDir) => path.join(appDir, 'skills');
const destinoDe = (home, nome) => path.join(home || os.homedir(), '.claude', 'skills', nome);

function frontmatter(txt) {
  const out = {};
  if (!txt || !txt.startsWith('---')) return out;
  const fim = txt.indexOf('\n---', 3);
  for (const l of txt.slice(3, fim > 0 ? fim : 0).split(/\r?\n/)) {
    const m = l.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function nomesDisponiveis(appDir) {
  try {
    return fs.readdirSync(pastaSkills(appDir), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(pastaSkills(appDir), e.name, 'SKILL.md')))
      .map((e) => e.name).sort((a, b) => (a === 'cortex' ? -1 : b === 'cortex' ? 1 : a.localeCompare(b)));
  } catch { return []; }
}

function info(nome, { appDir, home, cortexDir }) {
  const origem = path.join(pastaSkills(appDir), nome);
  const txtApp = ler(path.join(origem, 'SKILL.md'));
  if (txtApp === null) return null;
  let meta = {};
  try { meta = JSON.parse(ler(path.join(origem, 'meta.json')) || '{}'); } catch { meta = {}; }
  const fm = frontmatter(txtApp);
  const caminho = destinoDe(home, nome);
  const txtInst = ler(path.join(caminho, 'SKILL.md'));
  const vApp = versaoDe(renderizar(txtApp, cortexDir || appDir));
  const vInst = versaoDe(txtInst);
  let status = 'nao-instalada';
  if (txtInst !== null) {
    // em dia = conteúdo idêntico (mesma versão e mesmo caminho do app); uma versão instalada maior também conta como em dia
    const igual = vInst.hash === vApp.hash || (vApp.v !== null && vInst.v !== null && vInst.v > vApp.v);
    status = igual ? 'instalada' : 'desatualizada';
  }
  return {
    nome, titulo: meta.titulo || fm.name || nome, descricao: meta.descricao || fm.description || '',
    executavel: !!meta.executavel, parametros: Array.isArray(meta.parametros) ? meta.parametros : [],
    versaoApp: vApp.v !== null ? vApp.v : vApp.hash, versaoInstalada: txtInst === null ? null : (vInst.v !== null ? vInst.v : vInst.hash),
    instalada: txtInst !== null, status, caminho, origem,
  };
}

function listar({ appDir, home, cortexDir } = {}) {
  return nomesDisponiveis(appDir).map((n) => info(n, { appDir, home, cortexDir })).filter(Boolean);
}

function alvos(nome, appDir) {
  const todos = nomesDisponiveis(appDir);
  if (nome === 'todas' || nome === 'todos' || !nome) return todos;
  if (todos.includes(nome)) return [nome];
  if (todos.includes('cortex-' + nome)) return ['cortex-' + nome];
  const e = new Error(`skill não encontrada: ${nome} (disponíveis: ${todos.join(', ')})`);
  e.code = 'ENOENT';
  throw e;
}

function copiarPasta(origem, destino, cortexDir) {
  let mudou = false;
  fs.mkdirSync(destino, { recursive: true });
  for (const e of fs.readdirSync(origem, { withFileTypes: true })) {
    if (e.name === 'meta.json') continue; // metadado do app, não da skill
    const de = path.join(origem, e.name), para = path.join(destino, e.name);
    if (e.isDirectory()) { mudou = copiarPasta(de, para, cortexDir) || mudou; continue; }
    const texto = EXT_TEXTO.has(path.extname(e.name).toLowerCase());
    const novo = texto ? Buffer.from(renderizar(fs.readFileSync(de, 'utf8'), cortexDir)) : fs.readFileSync(de);
    let atual = null;
    try { atual = fs.readFileSync(para); } catch { /* novo */ }
    if (atual && atual.equals(novo)) continue;
    fs.writeFileSync(para, novo);
    mudou = true;
  }
  return mudou;
}

function instalar(nome, { appDir, home, cortexDir } = {}) {
  const resultados = [];
  for (const n of alvos(nome, appDir)) {
    const origem = path.join(pastaSkills(appDir), n);
    const caminho = destinoDe(home, n);
    const mudou = copiarPasta(origem, caminho, cortexDir || appDir);
    const i = info(n, { appDir, home, cortexDir });
    resultados.push({ nome: n, caminho, mudou, versao: i ? i.versaoApp : null });
  }
  return { resultados };
}

function remover(nome, { appDir, home } = {}) {
  const resultados = [];
  for (const n of alvos(nome, appDir)) {
    const caminho = destinoDe(home, n);
    const txt = ler(path.join(caminho, 'SKILL.md'));
    if (txt === null) { resultados.push({ nome: n, caminho, removida: false, motivo: 'não estava instalada' }); continue; }
    if (!MARCA.test(txt)) { resultados.push({ nome: n, caminho, removida: false, motivo: 'pasta não foi instalada pelo CÓRTEX (sem marcador cortex-skill); deixei como está' }); continue; }
    fs.rmSync(caminho, { recursive: true, force: true });
    resultados.push({ nome: n, caminho, removida: true });
  }
  return { resultados };
}

module.exports = { listar, instalar, remover, renderizar, versaoDe };
