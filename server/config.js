'use strict';
// Configuração do CÓRTEX: cortex.config.json + .env (lido à mão, sem dotenv).
//
// Diretórios (V4):
//   appDir   = código do app (web/, skills/, node_modules/). Padrão: a pasta acima de server/.
//   dadosDir = dados do usuário (cortex.config.json, data/, diario/, .env). Ordem: iniciar({ dadosDir })
//              → env CORTEX_DADOS → env CORTEX_DATA (apelido antigo) → appDir (modo script/instalação antiga).
//              O app de desktop passa %APPDATA%\CORTEX.
//   configPath = iniciar({ configPath }) → env CORTEX_CONFIG → <dadosDir>/cortex.config.json
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { readJSON, existe, baseName } = require('./util');

const ROOT = path.resolve(__dirname, '..');
const TIPOS = new Set(['obsidian', 'git', 'claude', 'pasta']);
// worktrees/clones das sessões do glass-pets ficam todos no mesmo lobo
const APELIDOS_PADRAO = { 'gp-*': 'glass-pets' };

const dirs = { appDir: ROOT, dadosDir: ROOT, configPath: path.join(ROOT, 'cortex.config.json') };
let definido = false;

function definirDiretorios({ appDir, dadosDir, configPath } = {}) {
  dirs.appDir = path.resolve(appDir || ROOT);
  const dEnv = process.env.CORTEX_DADOS || process.env.CORTEX_DATA;
  dirs.dadosDir = path.resolve(dadosDir || dEnv || dirs.appDir);
  dirs.configPath = path.resolve(configPath || process.env.CORTEX_CONFIG || path.join(dirs.dadosDir, 'cortex.config.json'));
  definido = true;
  atual = null;
  return { ...dirs };
}
function garantirDirs() { if (!definido) definirDiretorios(); }

// Migração única: instalação antiga com config/data/diario ao lado do app → dadosDir novo
function migrarSeNecessario(log = () => {}) {
  garantirDirs();
  const origem = dirs.appDir, destino = dirs.dadosDir;
  if (path.resolve(origem) === path.resolve(destino)) return { migrado: false };
  const marca = path.join(destino, '.migrado-de-instalacao-antiga');
  if (existe(marca) || existe(path.join(destino, 'cortex.config.json'))) return { migrado: false };
  const itens = ['cortex.config.json', 'data', 'diario', '.env'].filter((x) => existe(path.join(origem, x)));
  if (!itens.length) return { migrado: false };
  fs.mkdirSync(destino, { recursive: true });
  const copiados = [];
  for (const x of itens) {
    try {
      fs.cpSync(path.join(origem, x), path.join(destino, x), { recursive: true, force: false, errorOnExist: false });
      copiados.push(x);
    } catch (e) { log(`migração: falhou ao copiar ${x}: ${e.message}`); }
  }
  fs.writeFileSync(marca, `migrado de ${origem} em ${new Date().toISOString()}\n${copiados.join('\n')}\n`);
  log(`migração: ${copiados.join(', ')} copiados de ${origem} para ${destino} (os originais ficaram onde estavam)`);
  return { migrado: true, de: origem, para: destino, itens: copiados };
}

function novoId() {
  return 'src_' + crypto.randomBytes(3).toString('hex');
}

// seções editáveis por /api/config (V4)
const SECOES_PADRAO = {
  geral: { porta: 4747, iniciarComWindows: false, fecharParaBandeja: true, atalhoGlobal: 'Ctrl+Alt+C', idioma: 'pt' },
  organizacao: { regrasLocais: true, limitePorHora: 120 },
  cerebro: { profundidadeIdade: 1, espacamentoLobos: 1, mostrarTecido: true, mostrarGrade: true, mostrarSinapses: true, rotacaoAuto: false, velocidadeReplay: 1 },
  desempenho: { limiteNeuronios: 40000, fpsMax: 60, qualidadeSinapses: 'media' },
  notificacoes: { registroDiario: true, commitNovo: true, sessaoNova: false },
};
const IGNORAR_PADRAO = ['*.tmp', '~$*', 'Thumbs.db', '.DS_Store'];

function configPadrao() {
  const home = os.homedir();
  const builder = path.join(home, 'Documents', 'Claude Builder');
  return {
    porta: 4747,
    fontes: [
      { id: novoId(), tipo: 'obsidian', caminho: path.join(builder, 'glass-pets', 'wiki'), projeto: 'glass-pets', ativo: true },
      { id: novoId(), tipo: 'git', caminho: path.join(builder, 'glass-pets'), projeto: 'glass-pets', ativo: true },
      { id: novoId(), tipo: 'claude', caminho: path.join(home, '.claude', 'projects'), ativo: true },
    ],
    apelidos: { ...APELIDOS_PADRAO },
    ignorar: [...IGNORAR_PADRAO],
    claude: { ativo: false, modelo: 'claude-haiku-5-5' },
    som: false,
  };
}

let atual = null;

function carregar() {
  garantirDirs();
  if (!existe(dirs.configPath)) {
    atual = configPadrao();
    salvar();
  } else {
    atual = readJSON(dirs.configPath, null) || configPadrao();
  }
  atual.porta = atual.porta || 4747;
  atual.fontes = Array.isArray(atual.fontes) ? atual.fontes : [];
  for (const f of atual.fontes) {
    if (!f.id) f.id = novoId();
    if (f.ativo === undefined) f.ativo = true;
    if (!f.projeto && f.tipo !== 'claude') f.projeto = require('./projeto').descobrir(f.caminho, atual).projeto || baseName(f.caminho) || 'sem-nome';
  }
  atual.claude = Object.assign({ ativo: false, modelo: 'claude-haiku-5-5' }, atual.claude || {});
  if (atual.som === undefined) atual.som = false;
  let mudou = false;
  if (!atual.apelidos || typeof atual.apelidos !== 'object') { atual.apelidos = { ...APELIDOS_PADRAO }; mudou = true; }
  if (!Array.isArray(atual.ignorar)) { atual.ignorar = [...IGNORAR_PADRAO]; mudou = true; }
  for (const [s, pad] of Object.entries(SECOES_PADRAO)) atual[s] = { ...pad, ...(atual[s] || {}) };
  atual.geral.porta = atual.porta;
  if (mudou) salvar();
  criarEnvExemplo();
  return atual;
}

function salvar() {
  garantirDirs();
  fs.mkdirSync(path.dirname(dirs.configPath), { recursive: true });
  fs.writeFileSync(dirs.configPath, JSON.stringify(atual, null, 2));
}

function get() { return atual || carregar(); }

function adicionarFonte({ tipo, caminho, projeto, ignorar }) {
  if (!TIPOS.has(tipo)) throw new Error('tipo inválido: ' + tipo);
  if (!caminho) throw new Error('caminho obrigatório');
  const f = { id: novoId(), tipo, caminho: String(caminho), ativo: true };
  if (tipo !== 'claude') f.projeto = projeto || require('./projeto').descobrir(caminho, get()).projeto || baseName(caminho) || 'sem-nome';
  if (Array.isArray(ignorar)) f.ignorar = ignorar;
  get().fontes.push(f);
  salvar();
  return f;
}

function removerFonte(id) {
  const c = get();
  const i = c.fontes.findIndex((f) => f.id === id);
  if (i < 0) return null;
  const [f] = c.fontes.splice(i, 1);
  salvar();
  return f;
}

// ---- .env simples: CHAVE=valor, # comentários, aspas opcionais
const envPath = () => { garantirDirs(); return path.join(dirs.dadosDir, '.env'); };

function lerEnv() {
  const out = {};
  try {
    const txt = fs.readFileSync(envPath(), 'utf8');
    for (const linha of txt.split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch { /* sem .env */ }
  return out;
}

// grava/remove uma variável no .env preservando o resto do arquivo
function gravarEnv(chave, valor) {
  let linhas = [];
  try { linhas = fs.readFileSync(envPath(), 'utf8').split(/\r?\n/); } catch { /* novo */ }
  const re = new RegExp('^\\s*' + chave + '\\s*=');
  linhas = linhas.filter((l) => !re.test(l));
  while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  if (valor) linhas.push(`${chave}=${valor}`);
  fs.mkdirSync(path.dirname(envPath()), { recursive: true });
  fs.writeFileSync(envPath(), linhas.join('\n') + '\n', { mode: 0o600 });
}

function chaveClaude() {
  return lerEnv().ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
}

function mascarar(k) { return k ? `${k.slice(0, 3)}...${k.slice(-4)}` : null; }

function criarEnvExemplo() {
  const ex = path.join(dirs.dadosDir, '.env.exemplo');
  if (existe(ex)) return;
  try {
    fs.mkdirSync(dirs.dadosDir, { recursive: true });
    fs.writeFileSync(ex, [
      '# Copie este arquivo para .env e preencha só se quiser a organização com o Claude.',
      '# Sem chave, o CÓRTEX classifica tudo localmente por regras. Nada sai do seu computador.',
      '# No app: CONFIGURAÇÕES → ORGANIZAÇÃO grava a chave aqui sozinho.',
      'ANTHROPIC_API_KEY=',
      '',
    ].join('\n'));
  } catch { /* pasta só de leitura */ }
}

module.exports = {
  ROOT, TIPOS, APELIDOS_PADRAO, IGNORAR_PADRAO, SECOES_PADRAO,
  get APP_DIR() { garantirDirs(); return dirs.appDir; },
  get DADOS_DIR() { garantirDirs(); return dirs.dadosDir; },
  get CONFIG_PATH() { garantirDirs(); return dirs.configPath; },
  get DATA_DIR() { garantirDirs(); return path.join(dirs.dadosDir, 'data'); },
  get DIARIO_DIR() { garantirDirs(); return path.join(dirs.dadosDir, 'diario'); },
  get ENV_PATH() { return envPath(); },
  definirDiretorios, migrarSeNecessario,
  carregar, salvar, get, adicionarFonte, removerFonte, lerEnv, gravarEnv, chaveClaude, mascarar,
};
