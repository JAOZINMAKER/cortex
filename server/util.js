'use strict';
// Utilidades compartilhadas do servidor do CÓRTEX.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const WIN = process.platform === 'win32';

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

// Caminho normalizado para comparação: absoluto, barras "/", minúsculas no Windows.
function normPath(p) {
  if (!p) return '';
  let r = String(p);
  // caminhos estilo Windows ("C:\x") lidos em outra plataforma não devem virar relativos
  if (!/^[a-zA-Z]:[\\/]/.test(r)) r = path.resolve(r);
  r = r.replace(/\\/g, '/').replace(/\/+$/, '');
  if (WIN || /^[a-zA-Z]:\//.test(r)) r = r.toLowerCase();
  return r;
}

function baseName(p) {
  const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// PRNG determinístico (mulberry32)
function prng(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function slug(s) {
  return String(s || 'sem-nome')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-nome';
}

function contarPalavras(txt) {
  const m = String(txt || '').match(/\S+/g);
  return m ? m.length : 0;
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function readJSON(f, padrao) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; }
}

function writeJSON(f, obj) {
  ensureDir(path.dirname(f));
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
}

function existe(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

const EXT_TEXTO = new Set(['.txt', '.md', '.srt', '.json', '.csv', '.vtt', '.lua', '.luau', '.js', '.ts', '.py', '.html', '.css', '.yml', '.yaml', '.toml', '.ini', '.xml', '.sh', '.bat', '.ps1', '.tsx', '.jsx', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.cs']);

function ehTexto(p) {
  return EXT_TEXTO.has(path.extname(p).toLowerCase());
}

module.exports = { WIN, sha1, normPath, baseName, prng, dayKey, slug, contarPalavras, ensureDir, readJSON, writeJSON, existe, ehTexto };
