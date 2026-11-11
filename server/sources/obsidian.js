'use strict';
// Fonte: cofre do Obsidian. Cada nota = neurônio; [[link]] = sinapse; pasta = subregião.
const fs = require('fs');
const path = require('path');
const { sha1, normPath, contarPalavras } = require('../util');

const IGNORAR_DIR = new Set(['.obsidian', '.trash', 'node_modules', '.git']);

async function listarMd(raiz) {
  const out = [];
  async function rec(dir) {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || IGNORAR_DIR.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await rec(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
    }
  }
  await rec(raiz);
  return out;
}

function parseFrontmatter(txt) {
  const fm = {};
  if (!txt.startsWith('---')) return { fm, corpo: txt };
  const fim = txt.indexOf('\n---', 3);
  if (fim < 0) return { fm, corpo: txt };
  const bloco = txt.slice(3, fim).split(/\r?\n/);
  let chaveLista = null;
  for (const linha of bloco) {
    const item = linha.match(/^\s*-\s+(.*)$/);
    if (item && chaveLista) { fm[chaveLista].push(limpar(item[1])); continue; }
    const m = linha.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (v === '') { fm[k] = []; chaveLista = k; continue; }
    chaveLista = null;
    if (v.startsWith('[') && v.endsWith(']')) fm[k] = v.slice(1, -1).split(',').map(limpar).filter(Boolean);
    else fm[k] = limpar(v);
  }
  const corpo = txt.slice(fim + 4).replace(/^\r?\n/, '');
  return { fm, corpo };
}

function limpar(s) {
  return String(s).trim().replace(/^["']|["']$/g, '');
}

function listaTags(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((t) => String(t).replace(/^#/, '')).filter(Boolean);
  return String(v).split(/[,\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean);
}

const RE_WIKI = /(!?)\[\[([^\]\|#\^\n]*)(#[^\]\|\n]*)?(\|[^\]\n]*)?\]\]/g;
const RE_MD = /\[[^\]\n]*\]\(([^)\s]+?\.md)(#[^)]*)?\)/gi;

function parseData(v) {
  if (!v) return 0;
  const t = Date.parse(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(t) ? t : 0;
}

async function ler(fonte) {
  const raiz = path.resolve(fonte.caminho);
  const arquivos = await listarMd(raiz);
  const notas = [];
  const porNome = new Map(); // basename minúsculo sem .md -> [idx]
  const porRel = new Map(); // caminho relativo minúsculo sem .md -> idx

  const LOTE = 64;
  for (let i = 0; i < arquivos.length; i += LOTE) {
    const lote = arquivos.slice(i, i + LOTE);
    const lidos = await Promise.all(lote.map(async (abs) => {
      try {
        const [txt, st] = await Promise.all([fs.promises.readFile(abs, 'utf8'), fs.promises.stat(abs)]);
        return { abs, txt, st };
      } catch { return null; }
    }));
    for (const r of lidos) {
      if (!r) continue;
      const rel = path.relative(raiz, r.abs).split(path.sep).join('/');
      const semExt = rel.replace(/\.md$/i, '');
      const nome = semExt.split('/').pop();
      const { fm, corpo } = parseFrontmatter(r.txt);
      const tagsTexto = listaTags(fm.tags || fm.tag);
      const inline = corpo.match(/(^|\s)#([A-Za-zÀ-ÿ0-9_\-\/]{2,40})/g) || [];
      for (const t of inline) tagsTexto.push(t.trim().slice(1));
      const criadoFm = parseData(fm.created || fm.criado || fm.date || fm.data);
      const birth = r.st.birthtimeMs && r.st.birthtimeMs > 0 ? r.st.birthtimeMs : r.st.mtimeMs;
      let sub = rel.includes('/') ? rel.split('/')[0] : '/';
      let projetoNota;
      if (fonte.projetoPorPasta) {
        // diário interno: <projeto>/<arquivo>.md; o frontmatter guarda o nome exato do projeto
        projetoNota = limpar(fm.projeto || sub);
        sub = 'DIÁRIO';
      }
      const idx = notas.length;
      notas.push({
        chave: 'nota:' + normPath(r.abs),
        tipo: 'nota', fonte: 'obsidian',
        titulo: limpar(fm.title || fm.titulo || nome),
        subregiao: sub,
        criado: criadoFm || Math.min(birth, r.st.mtimeMs),
        modificado: r.st.mtimeMs,
        datasDoArquivo: !criadoFm, // datas vêm só do sistema de arquivos (o git pode corrigir)
        palavras: contarPalavras(corpo),
        autor: limpar(fm.author || fm.autor || 'EU').toUpperCase(),
        hash: sha1(r.txt).slice(0, 12),
        caminho: r.abs,
        texto: corpo.slice(0, 4000),
        extra: { rel, tagsTexto: [...new Set(tagsTexto)].slice(0, 30), aliases: listaTags(fm.aliases), ...(projetoNota ? { diario: true } : {}) },
        ...(projetoNota ? { projetoNota } : {}),
        _ligar: listaTags(fm.ligar),
        _corpo: corpo,
      });
      const nl = nome.toLowerCase();
      if (!porNome.has(nl)) porNome.set(nl, []);
      porNome.get(nl).push(idx);
      porRel.set(semExt.toLowerCase(), idx);
      for (const al of listaTags(fm.aliases)) {
        const a = al.toLowerCase();
        if (!porNome.has(a)) porNome.set(a, []);
        porNome.get(a).push(idx);
      }
    }
  }

  function resolver(alvo, deIdx) {
    let t = alvo.trim().replace(/\\/g, '/');
    try { t = decodeURIComponent(t); } catch { /* mantém */ }
    t = t.replace(/\.md$/i, '').replace(/^\.\//, '').replace(/^\//, '');
    if (!t) return -1;
    const tl = t.toLowerCase();
    if (tl.includes('/')) {
      if (porRel.has(tl)) return porRel.get(tl);
      const dirDe = notas[deIdx].extra.rel.split('/').slice(0, -1).join('/');
      const rel = path.posix.normalize((dirDe ? dirDe + '/' : '') + t).toLowerCase();
      if (porRel.has(rel)) return porRel.get(rel);
      // sufixo do caminho
      for (const [k, v] of porRel) if (k.endsWith('/' + tl)) return v;
      const nome = tl.split('/').pop();
      const c = porNome.get(nome);
      return c ? c[0] : -1;
    }
    const cands = porNome.get(tl);
    if (!cands || !cands.length) return -1;
    if (cands.length === 1) return cands[0];
    const dirDe = notas[deIdx].extra.rel.split('/').slice(0, -1).join('/');
    const mesmo = cands.find((c) => notas[c].extra.rel.split('/').slice(0, -1).join('/') === dirDe);
    if (mesmo !== undefined) return mesmo;
    return cands.slice().sort((a, b) => notas[a].extra.rel.length - notas[b].extra.rel.length)[0];
  }

  const links = [];
  const vistos = new Set();
  notas.forEach((n, i) => {
    const corpo = n._corpo;
    delete n._corpo;
    // ligações explícitas por id (diário): o grafo resolve entre fontes
    for (const id of n._ligar || []) links.push({ de: n.chave, para: { id }, tipo: 'LINK', peso: 0.8 });
    delete n._ligar;
    let m;
    RE_WIKI.lastIndex = 0;
    while ((m = RE_WIKI.exec(corpo))) {
      if (!m[2]) continue;
      const j = resolver(m[2], i);
      if (j < 0 || j === i) continue;
      const tipo = m[1] ? 'EMBED' : 'LINK';
      const k = i + '>' + j + tipo;
      if (vistos.has(k)) continue;
      vistos.add(k);
      links.push({ de: n.chave, para: notas[j].chave, tipo, peso: tipo === 'EMBED' ? 0.9 : 0.7 });
    }
    RE_MD.lastIndex = 0;
    while ((m = RE_MD.exec(corpo))) {
      if (/^[a-z]+:\/\//i.test(m[1])) continue;
      const j = resolver(m[1], i);
      if (j < 0 || j === i) continue;
      const k = i + '>' + j + 'LINK';
      if (vistos.has(k)) continue;
      vistos.add(k);
      links.push({ de: n.chave, para: notas[j].chave, tipo: 'LINK', peso: 0.6 });
    }
  });

  return { nos: notas, links, eventos: [], itens: notas.length };
}

// Corpo completo de uma nota (para /api/no)
function lerCorpo(abs) {
  try {
    const txt = fs.readFileSync(abs, 'utf8');
    return parseFrontmatter(txt);
  } catch { return { fm: {}, corpo: '' }; }
}

module.exports = { ler, lerCorpo };
