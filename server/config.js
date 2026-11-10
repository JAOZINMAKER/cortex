'use strict';
// Configuração do CÓRTEX: cortex.config.json + .env (lido à mão, sem dotenv).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { readJSON, writeJSON, existe, baseName } = require('./util');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.CORTEX_CONFIG ? path.resolve(process.env.CORTEX_CONFIG) : path.join(ROOT, 'cortex.config.json');
const DATA_DIR = process.env.CORTEX_DATA ? path.resolve(process.env.CORTEX_DATA) : path.join(ROOT, 'data');
const ENV_PATH = path.join(ROOT, '.env');
const TIPOS = new Set(['obsidian', 'git', 'claude', 'pasta']);

function novoId() {
  return 'src_' + crypto.randomBytes(3).toString('hex');
}

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
    claude: { ativo: false, modelo: 'claude-haiku-5-5' },
    som: false,
  };
}

let atual = null;

function carregar() {
  if (!existe(CONFIG_PATH)) {
    atual = configPadrao();
    salvar();
  } else {
    atual = readJSON(CONFIG_PATH, null) || configPadrao();
  }
  atual.porta = atual.porta || 4747;
  atual.fontes = Array.isArray(atual.fontes) ? atual.fontes : [];
  for (const f of atual.fontes) {
    if (!f.id) f.id = novoId();
    if (f.ativo === undefined) f.ativo = true;
    if (!f.projeto && f.tipo !== 'claude') f.projeto = baseName(f.caminho) || 'sem-nome';
  }
  atual.claude = Object.assign({ ativo: false, modelo: 'claude-haiku-5-5' }, atual.claude || {});
  if (atual.som === undefined) atual.som = false;
  criarEnvExemplo();
  return atual;
}

function salvar() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(atual, null, 2));
}

function get() { return atual || carregar(); }

function adicionarFonte({ tipo, caminho, projeto, ignorar }) {
  if (!TIPOS.has(tipo)) throw new Error('tipo inválido: ' + tipo);
  if (!caminho) throw new Error('caminho obrigatório');
  const f = { id: novoId(), tipo, caminho: String(caminho), ativo: true };
  if (tipo !== 'claude') f.projeto = projeto || baseName(caminho) || 'sem-nome';
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

// .env simples: CHAVE=valor, # comentários, aspas opcionais
function lerEnv() {
  const out = {};
  try {
    const txt = fs.readFileSync(ENV_PATH, 'utf8');
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

function chaveClaude() {
  return lerEnv().ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
}

function criarEnvExemplo() {
  const ex = path.join(ROOT, '.env.exemplo');
  if (existe(ex)) return;
  fs.writeFileSync(ex, [
    '# Copie este arquivo para .env e preencha só se quiser a organização com o Claude.',
    '# Sem chave, o CÓRTEX classifica tudo localmente por regras. Nada sai do seu computador.',
    '# Também é preciso ligar "claude": { "ativo": true } no cortex.config.json.',
    'ANTHROPIC_API_KEY=',
    '',
  ].join('\n'));
}

module.exports = { ROOT, CONFIG_PATH, DATA_DIR, TIPOS, carregar, salvar, get, adicionarFonte, removerFonte, lerEnv, chaveClaude };
