'use strict';
// Fonte: repositório git. Commits, branches e worktrees viram neurônios; arquivos tocados também.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { normPath } = require('../util');

const MAX_COMMITS = 20000;
const MAX_ARQUIVOS = 3000;
const MAX_TOCA_POR_COMMIT = 40;
const WIN_CASE = process.platform === 'win32';

function git(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', '-C', repo, ...args], { maxBuffer: 1024 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

// "a/{x => y}/b" e "x => y" → caminho novo
function caminhoRenomeado(p) {
  if (!p.includes('=>')) return p;
  const chave = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (chave) return (chave[1] + chave[3] + chave[4]).replace(/\/\//g, '/');
  const simples = p.split(' => ');
  return simples[simples.length - 1];
}

function autorCanonico(nome, email) {
  const s = (nome + ' ' + email).toLowerCase();
  if (s.includes('claude') || s.includes('anthropic')) return 'CLAUDE';
  if (s.includes('copilot')) return 'COPILOT';
  if (s.includes('[bot]') || s.includes('dependabot')) return 'BOT';
  return nome;
}

async function ler(fonte) {
  const repo = path.resolve(fonte.caminho);
  const SEP = '\x1f', REC = '\x1e';
  // --source: %S = ref pela qual o commit foi alcançado (diz em que branch/worktree um arquivo foi mexido)
  const saida = await git(repo, ['log', '--all', '--source', '--numstat', '--date-order', '-n', String(MAX_COMMITS), `--format=${REC}%H${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%ct${SEP}%s${SEP}%D${SEP}%S`]);
  const commits = [];
  for (const bloco of saida.split(REC)) {
    if (!bloco.trim()) continue;
    const linhas = bloco.split('\n');
    const h = linhas[0].split(SEP);
    if (h.length < 7) continue;
    const arquivos = [];
    let mais = 0, menos = 0;
    for (let i = 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l) continue;
      const m = l.split('\t');
      if (m.length < 3) continue;
      const a = m[0] === '-' ? 0 : parseInt(m[0], 10) || 0;
      const d = m[1] === '-' ? 0 : parseInt(m[1], 10) || 0;
      const p = caminhoRenomeado(m.slice(2).join('\t'));
      arquivos.push({ p, a, d });
      mais += a; menos += d;
    }
    commits.push({
      sha: h[0], pais: h[1] ? h[1].split(' ') : [], an: h[2], ae: h[3],
      at: parseInt(h[4], 10) * 1000, ct: parseInt(h[5], 10) * 1000, s: h[6], refs: h[7] || '', fonteRef: (h[8] || '').trim(),
      arquivos, mais, menos,
    });
  }

  const nos = [];
  const links = [];
  const eventos = [];
  // commits e branches são chaveados pelo .git comum: worktrees e o repo principal não duplicam neurônios
  let comum = repo;
  try { comum = path.resolve(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim()); } catch { /* usa o repo */ }
  const chaveRepo = normPath(comum);
  // commit = mesmo sha no mesmo projeto (clones separados do mesmo projeto também não duplicam)
  const chaveProj = fonte.projeto ? 'p:' + require('../util').slug(fonte.projeto) : chaveRepo;
  const chaveCommit = (sha) => 'commit:' + chaveProj + ':' + sha;
  const shaSet = new Set(commits.map((c) => c.sha));

  // worktrees (lidos antes: os arquivos usam o caminho real do checkout onde existem)
  const worktrees = []; // { caminho, branch, head }
  try {
    const wt = await git(repo, ['worktree', 'list', '--porcelain']);
    for (const bloco of wt.split(/\n\n+/)) {
      const m = {};
      for (const l of bloco.split('\n')) { const i = l.indexOf(' '); if (i > 0) m[l.slice(0, i)] = l.slice(i + 1); else if (l) m[l] = true; }
      if (m.worktree && !m.bare) worktrees.push({ caminho: path.resolve(m.worktree), branch: m.branch || null, head: m.HEAD || '' });
    }
  } catch { /* sem worktrees */ }
  const principal = worktrees.find((w) => normPath(w.caminho) === normPath(repo)) || { caminho: repo, branch: null };
  const porBranch = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch, w]));
  const nomeRef = (r) => String(r || '').replace(/^refs\/(heads|remotes)\//, '');

  // estatística de arquivos (todos, para datas de notas) e escolha dos mais tocados
  const stats = new Map(); // rel -> {n, first, last, linhas, refs:Set, ultimaRef}
  for (const c of commits) {
    for (const f of c.arquivos) {
      let s = stats.get(f.p);
      if (!s) { s = { n: 0, first: c.at, last: c.ct, linhas: 0, refs: new Set(), ultimaRef: c.fonteRef }; stats.set(f.p, s); }
      s.n++; s.linhas += f.a + f.d;
      if (c.at < s.first) s.first = c.at;
      if (c.ct >= s.last) { s.last = c.ct; s.ultimaRef = c.fonteRef || s.ultimaRef; }
      if (c.fonteRef) s.refs.add(c.fonteRef);
    }
  }
  const escolhidos = new Set([...stats.entries()].sort((a, b) => b[1].n - a[1].n || b[1].linhas - a[1].linhas).slice(0, MAX_ARQUIVOS).map((e) => e[0]));

  // um nó por caminho relativo no projeto; caminho = checkout real onde o arquivo existe
  const caminhosDe = new Map(); // rel -> [abs existentes]
  const chaveArquivo = (rel) => 'arquivo:' + chaveProj + ':' + (WIN_CASE ? rel.toLowerCase() : rel);
  for (const [rel, s] of stats) {
    if (!escolhidos.has(rel)) continue;
    const onde = [];
    if (fs.existsSync(path.join(principal.caminho, rel))) onde.push(principal);
    for (const r of s.refs) {
      const w = porBranch.get(r);
      if (w && w !== principal && !onde.includes(w) && fs.existsSync(path.join(w.caminho, rel))) onde.push(w);
    }
    const abs = onde.map((w) => path.join(w.caminho, rel));
    caminhosDe.set(rel, abs);
    const base = rel.split('/').pop();
    const nomesWt = onde.map((w) => path.basename(w.caminho));
    let titulo = base;
    if (!onde.length) titulo = `${base} @ ${nomeRef(s.ultimaRef) || 'histórico'}`; // só existe numa branch sem worktree (ou foi apagado)
    else if (onde[0] !== principal) titulo = `${base} · ${nomesWt[0]}`;
    nos.push({
      chave: chaveArquivo(rel), tipo: 'arquivo', fonte: 'git',
      titulo, subregiao: rel.includes('/') ? rel.split('/')[0] : 'raiz',
      criado: s.first, modificado: s.last, palavras: s.linhas, autor: 'GIT',
      hash: '', caminho: abs[0] || null, texto: rel.replace(/[\/._-]+/g, ' ') + ' ' + nomesWt.join(' '),
      worktrees: nomesWt,
      // caminhos = onde existe; candidatos = todo checkout do repo (para casar com notas e com arquivos citados pelas sessões)
      extra: { rel, toques: s.n, linhas: s.linhas, caminhos: abs, candidatos: [...new Set([repo, ...worktrees.map((w) => w.caminho)].map((c) => path.join(c, rel)))],
        worktrees: nomesWt, ultimaRef: nomeRef(s.ultimaRef) },
    });
  }
  // datas de arquivos (para notas do Obsidian dentro do repo), por todos os caminhos onde o arquivo existe
  const datasArquivos = {}; // normPath(abs) -> {first,last,n}
  for (const [rel, s] of stats) {
    const d = { first: s.first, last: s.last, n: s.n };
    datasArquivos[normPath(path.join(repo, rel))] = d;
    for (const a of caminhosDe.get(rel) || []) datasArquivos[normPath(a)] = d;
  }

  for (const c of commits) {
    const k = chaveCommit(c.sha);
    nos.push({
      chave: k, tipo: 'commit', fonte: 'git', titulo: c.s || '(sem mensagem)', subregiao: 'COMMITS',
      criado: c.at, modificado: c.ct, palavras: c.mais + c.menos, autor: autorCanonico(c.an, c.ae),
      hash: c.sha.slice(0, 12), caminho: repo,
      texto: c.s + ' ' + c.arquivos.slice(0, 30).map((f) => f.p).join(' '),
      extra: { sha: c.sha, fonteRef: nomeRef(c.fonteRef), pais: c.pais, mais: c.mais, menos: c.menos, refs: c.refs, autorNome: c.an,
        arquivos: c.arquivos.slice(0, 300), nArquivos: c.arquivos.length },
    });
    for (const p of c.pais) if (shaSet.has(p)) links.push({ de: k, para: chaveCommit(p), tipo: 'PAI', peso: 0.8 });
    const top = c.arquivos.slice().sort((a, b) => (b.a + b.d) - (a.a + a.d)).slice(0, MAX_TOCA_POR_COMMIT);
    for (const f of top) {
      // aponta pela chave do arquivo; o grafo troca por nota do Obsidian quando o arquivo é uma nota
      if (!escolhidos.has(f.p)) continue;
      const peso = Math.min(1, 0.25 + Math.log10(1 + f.a + f.d) / 4);
      links.push({ de: k, para: chaveArquivo(f.p), tipo: 'TOCA', peso });
    }
    eventos.push({ t: c.ct, fonte: 'git', msg: `COMMIT ${c.sha.slice(0, 7)} +${c.mais}/-${c.menos} ${c.s}`.slice(0, 160), chave: k, hash: c.sha.slice(0, 12) });
  }

  // branches. Num clone separado do mesmo projeto, o título leva o nome do clone ("main · gp-clone")
  const donoComum = path.basename(comum).toLowerCase() === '.git' ? path.dirname(comum) : comum;
  const nomeDono = path.basename(donoComum).replace(/\.git$/i, '');
  const sufixoClone = fonte.projeto && require('../util').slug(nomeDono) !== require('../util').slug(fonte.projeto) ? ' · ' + nomeDono : '';
  try {
    const refs = await git(repo, ['for-each-ref', `--format=%(refname)${SEP}%(objectname)${SEP}%(committerdate:unix)${SEP}%(refname:short)`, 'refs/heads', 'refs/remotes']);
    for (const l of refs.split('\n')) {
      const [ref, obj, cd, curto] = l.split(SEP);
      if (!ref || ref.endsWith('/HEAD')) continue;
      const k = 'branch:' + chaveRepo + ':' + ref;
      const t = (parseInt(cd, 10) || 0) * 1000;
      nos.push({ chave: k, tipo: 'branch', fonte: 'git', titulo: curto + sufixoClone, subregiao: 'BRANCHES', criado: t, modificado: t,
        palavras: 0, autor: 'GIT', hash: (obj || '').slice(0, 12), caminho: repo, texto: 'branch ' + curto, extra: { ref, sha: obj } });
      if (shaSet.has(obj)) links.push({ de: k, para: chaveCommit(obj), tipo: 'BRANCH', peso: 1 });
    }
  } catch { /* repo sem refs */ }

  // worktrees
  for (const w of worktrees) {
    const k = 'worktree:' + normPath(w.caminho);
    const c = commits.find((x) => x.sha === w.head);
    const t = c ? c.ct : Date.now();
    nos.push({ chave: k, tipo: 'worktree', fonte: 'git', titulo: path.basename(w.caminho) + (w.branch ? ' @ ' + nomeRef(w.branch) : ''),
      subregiao: 'BRANCHES', criado: t, modificado: t, palavras: 0, autor: 'GIT', hash: (w.head || '').slice(0, 12), caminho: w.caminho,
      // texto só com nomes relativos: o caminho absoluto (ex.: /home/x/testdata) viraria tag de ruído
      texto: 'worktree ' + path.basename(w.caminho) + (w.branch ? ' ' + nomeRef(w.branch) : ''), extra: { branch: w.branch, head: w.head } });
    if (shaSet.has(w.head)) links.push({ de: k, para: chaveCommit(w.head), tipo: 'BRANCH', peso: 0.9 });
  }

  // índice arquivo -> commits (para histórico de notas e arquivos)
  const historicoArquivos = new Map(); // normAbs -> [{t, sha, s}]
  for (const c of commits) {
    for (const f of c.arquivos) {
      const na = normPath(path.join(repo, f.p));
      let h = historicoArquivos.get(na);
      if (!h) { h = []; historicoArquivos.set(na, h); for (const a of caminhosDe.get(f.p) || []) historicoArquivos.set(normPath(a), h); }
      if (h.length < 60) h.push({ t: c.ct, sha: c.sha, s: c.s, a: f.a, d: f.d, ref: nomeRef(c.fonteRef) });
    }
  }

  return { nos, links, eventos, itens: commits.length, datasArquivos, historicoArquivos, repo };
}

async function mensagemCompleta(repo, sha) {
  try { return (await git(repo, ['show', '-s', '--format=%B', sha])).trim(); } catch { return ''; }
}

module.exports = { ler, mensagemCompleta };
