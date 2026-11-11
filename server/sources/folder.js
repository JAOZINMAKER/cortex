'use strict';
// Fonte: pasta comum (documentos, roteiros, vídeos). Título, data, tamanho e trecho se for texto.
const fs = require('fs');
const path = require('path');
const { sha1, normPath, contarPalavras, ehTexto } = require('../util');

const MAX_PROF = 6;
const MAX_ARQ = 5000;
const MAX_LER = 200 * 1024;

async function ler(fonte) {
  const raiz = path.resolve(fonte.caminho);
  const ignorar = new Set((fonte.ignorar || []).map((x) => normPath(path.resolve(raiz, x))));
  const arquivos = [];
  async function rec(dir, prof) {
    if (prof > MAX_PROF || arquivos.length >= MAX_ARQ) return;
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (arquivos.length >= MAX_ARQ) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (ignorar.has(normPath(p))) continue;
      if (e.isDirectory()) await rec(p, prof + 1);
      else if (e.isFile()) arquivos.push(p);
    }
  }
  await rec(raiz, 0);

  const nos = [];
  for (const abs of arquivos) {
    let st;
    try { st = await fs.promises.stat(abs); } catch { continue; }
    const rel = path.relative(raiz, abs).split(path.sep).join('/');
    const ext = path.extname(abs).toLowerCase();
    let texto = '', palavras = 0, hash;
    if (ehTexto(abs) && st.size <= MAX_LER * 5) {
      try {
        const fd = await fs.promises.open(abs, 'r');
        const buf = Buffer.alloc(Math.min(st.size, MAX_LER));
        await fd.read(buf, 0, buf.length, 0);
        await fd.close();
        texto = buf.toString('utf8');
        palavras = contarPalavras(texto);
        hash = sha1(texto).slice(0, 12);
      } catch { /* sem leitura */ }
    }
    if (!hash) hash = sha1(abs + ':' + st.size + ':' + st.mtimeMs).slice(0, 12);
    const birth = st.birthtimeMs && st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
    nos.push({
      chave: 'doc:' + normPath(abs), tipo: 'doc', fonte: 'pasta',
      titulo: path.basename(abs), subregiao: rel.includes('/') ? rel.split('/')[0] : 'raiz',
      criado: birth, modificado: st.mtimeMs, palavras, autor: 'EU', hash, caminho: abs,
      texto: (path.basename(abs, ext).replace(/[_\-.]+/g, ' ') + '\n' + texto).slice(0, 4000),
      extra: { rel, ext, tamanho: st.size, trecho: texto.slice(0, 600) },
    });
  }
  return { nos, links: [], eventos: [], itens: nos.length };
}

module.exports = { ler };
