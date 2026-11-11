'use strict';
// Descoberta do projeto de um caminho (sessão do Claude ou fonte). Ordem do CONTRATO V3:
// 1) apelidos da config (glob no basename)  2) git: --git-common-dir (worktree → repo principal) ou
// remote.origin.url (clone separado)  3) fora de git: fonte configurada que contém o caminho  4) basename.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { normPath, baseName, slug } = require('./util');

const cache = new Map(); // normPath -> { projeto, via }

function globParaRegex(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

function porApelido(nome, apelidos) {
  for (const [glob, projeto] of Object.entries(apelidos || {})) {
    if (globParaRegex(glob).test(nome)) return projeto;
  }
  return null;
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
  } catch { return null; }
}

function nomeRemoto(url) {
  if (!url) return null;
  const limpo = url.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const b = limpo.split(/[\\/:]+/).filter(Boolean).pop();
  return b || null;
}

// projetos conhecidos: nomes usados nas fontes configuradas (casam por slug)
function porGit(caminho, conhecidos) {
  if (!fs.existsSync(caminho)) return null;
  const topo = git(caminho, ['rev-parse', '--show-toplevel']);
  if (!topo) return null;
  const comum = git(caminho, ['rev-parse', '--git-common-dir']);
  if (comum) {
    const absComum = path.resolve(caminho, comum);
    const dono = path.basename(absComum).toLowerCase() === '.git' ? path.dirname(absComum) : absComum;
    // worktree: o .git comum mora em outro repo
    if (normPath(dono) !== normPath(topo)) {
      return { projeto: path.basename(dono).replace(/\.git$/i, ''), via: 'git-worktree', topo };
    }
  }
  const nomeTopo = path.basename(topo);
  if (conhecidos.has(slug(nomeTopo))) return { projeto: nomeTopo, via: 'git', topo };
  const remoto = nomeRemoto(git(caminho, ['config', '--get', 'remote.origin.url']));
  if (remoto) return { projeto: remoto, via: 'git-remote', topo };
  return { projeto: nomeTopo, via: 'git', topo };
}

// cfg: config atual (apelidos, fontes)
function descobrir(caminho, cfg) {
  if (!caminho) return { projeto: 'sem-projeto', via: 'nenhum', base: '' };
  const np = normPath(caminho);
  const base = baseName(caminho);
  const chaveCache = np + '|' + JSON.stringify(cfg.apelidos || {});
  const c = cache.get(chaveCache);
  if (c) return { ...c };
  let r = null;
  const ap = porApelido(base, cfg.apelidos);
  if (ap) r = { projeto: ap, via: 'apelido' };
  if (!r) {
    const conhecidos = new Set((cfg.fontes || []).filter((f) => f.projeto).map((f) => slug(f.projeto)));
    r = porGit(caminho, conhecidos);
    // o nome vindo do git ainda passa pelos apelidos (ex.: remoto "gp-x" → glass-pets)
    if (r) { const ap2 = porApelido(r.projeto, cfg.apelidos); if (ap2) r = { ...r, projeto: ap2, via: r.via + '+apelido' }; }
  }
  if (!r) {
    // fora de git: a fonte configurada mais específica que contém o caminho
    const fontes = (cfg.fontes || []).filter((f) => f.tipo !== 'claude' && f.projeto)
      .map((f) => ({ n: normPath(f.caminho), projeto: f.projeto })).sort((a, b) => b.n.length - a.n.length);
    for (const f of fontes) if (np === f.n || np.startsWith(f.n + '/')) { r = { projeto: f.projeto, via: 'fonte' }; break; }
  }
  if (!r) r = { projeto: base || 'sem-projeto', via: 'basename' };
  // subregião = pasta do worktree/clone (não a subpasta onde a sessão abriu)
  const baseFinal = r.topo ? path.basename(r.topo) : base;
  delete r.topo;
  r.base = baseFinal;
  cache.set(chaveCache, r);
  return { ...r };
}

function limparCache() { cache.clear(); }

module.exports = { descobrir, limparCache, globParaRegex };
