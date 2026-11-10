'use strict';
// Vigilância: chokidar por fonte, com debounce de 1,5 s. Avisa quais caminhos mudaram.
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

const DEBOUNCE = 1500;
const vigias = new Map(); // fonteId -> { w, timer, mudancas }

function alvos(fonte) {
  const p = path.resolve(fonte.caminho);
  if (fonte.tipo === 'git') {
    // repo normal (.git pasta) ou worktree (.git arquivo apontando para gitdir)
    let gitDir = path.join(p, '.git');
    try {
      if (fs.statSync(gitDir).isFile()) {
        const m = fs.readFileSync(gitDir, 'utf8').match(/gitdir:\s*(.+)/);
        if (m) gitDir = path.resolve(p, m[1].trim());
      }
    } catch { /* sem .git */ }
    return {
      paths: ['HEAD', 'refs', 'logs', 'packed-refs'].map((x) => path.join(gitDir, x)),
      opts: { depth: 8 },
    };
  }
  if (fonte.tipo === 'claude') return { paths: [p], opts: { depth: 3 } }; // inclui <sessão>/subagents/*.jsonl
  if (fonte.tipo === 'pasta') return { paths: [p], opts: { depth: 6 } };
  return { paths: [p], opts: { depth: 30 } };
}

function ignorado(fonte) {
  const ign = (fonte.ignorar || []).map((x) => path.resolve(fonte.caminho, x));
  return (p) => {
    const b = path.basename(p);
    if (fonte.tipo !== 'git' && (b.startsWith('.') && p !== path.resolve(fonte.caminho))) return true;
    if (b === 'node_modules') return true;
    if (fonte.tipo === 'claude' && /\.(json)$/i.test(b)) return true;
    for (const i of ign) if (p === i || p.startsWith(i + path.sep)) return true;
    return false;
  };
}

function vigiar(fonte, aoMudar) {
  parar(fonte.id);
  if (!fonte.ativo) return;
  let a;
  try { a = alvos(fonte); } catch { return; }
  const existentes = a.paths.filter((p) => { try { fs.accessSync(p); return true; } catch { return false; } });
  if (!existentes.length) return;
  const w = chokidar.watch(existentes, {
    ignoreInitial: true, usePolling: false, persistent: true, ignored: ignorado(fonte), ...a.opts,
    awaitWriteFinish: false,
  });
  const reg = { w, timer: null, mudancas: new Map() };
  const marcar = (tipo) => (p) => {
    if (fonte.tipo === 'obsidian' && !p.toLowerCase().endsWith('.md') && tipo !== 'addDir' && tipo !== 'unlinkDir') return;
    if (fonte.tipo === 'claude' && !p.endsWith('.jsonl')) return;
    reg.mudancas.set(p, tipo);
    clearTimeout(reg.timer);
    reg.timer = setTimeout(() => {
      const m = [...reg.mudancas.entries()].map(([caminho, t]) => ({ caminho, tipo: t }));
      reg.mudancas.clear();
      aoMudar(fonte, m);
    }, DEBOUNCE);
  };
  for (const ev of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) w.on(ev, marcar(ev));
  w.on('error', () => { /* pastas que somem não derrubam o app */ });
  vigias.set(fonte.id, reg);
}

function parar(id) {
  const r = vigias.get(id);
  if (!r) return;
  clearTimeout(r.timer);
  r.w.close().catch(() => {});
  vigias.delete(id);
}

function pararTodos() { for (const id of [...vigias.keys()]) parar(id); }

module.exports = { vigiar, parar, pararTodos };
