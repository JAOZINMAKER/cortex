'use strict';
// Fonte: conversas do Claude Code (<projects>/*/*.jsonl). Cada sessão = neurônio.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { normPath, baseName, readJSON, writeJSON } = require('../util');
const { DATA_DIR } = require('../config');

const MAX_EVENTOS_SESSAO = 2000;
const GAP_ATIVO = 30 * 60 * 1000;
const ATIVA_MS = 5 * 60 * 1000;

function textoDe(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  return '';
}

// tira blocos injetados pelo sistema (lembretes, anexos) e fica com o que a pessoa escreveu
function limparPrompt(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<(command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, ' ')
    .split(/\r?\n/).filter((l) => !/^\s*\[(Attachment|Image|Request interrupted)/i.test(l) && !/^\s*@"?\/mnt\//.test(l)).join('\n')
    .replace(/\s+/g, ' ').trim();
}

function ehPromptReal(d) {
  if (d.isMeta || d.isSidechain) return false;
  const c = d.message && d.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  const t = textoDe(c).trim();
  return t.length > 0;
}

function arquivoDoInput(input) {
  if (!input || typeof input !== 'object') return null;
  return input.file_path || input.notebook_path || input.path || null;
}

async function lerSessao(arquivo) {
  const s = {
    sessionId: path.basename(arquivo, '.jsonl'), arquivo, cwd: null, inicio: 0, fim: 0,
    msgsUser: 0, msgsAssist: 0, ferramentas: {}, arquivos: [], modelo: null, duracaoMs: 0,
    titulo: '', prompts: [], eventos: [], resumo: '', branch: null, versao: null,
  };
  const arqSet = new Set();
  const tempos = [];
  const stream = fs.createReadStream(arquivo, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const linha of rl) {
    if (!linha || linha[0] !== '{') continue;
    let d;
    try { d = JSON.parse(linha); } catch { continue; }
    const t = d.timestamp ? Date.parse(d.timestamp) : 0;
    if (t) {
      tempos.push(t);
      if (!s.inicio || t < s.inicio) s.inicio = t;
      if (t > s.fim) s.fim = t;
    }
    if (d.cwd && !s.cwd) s.cwd = d.cwd;
    if (d.gitBranch && !s.branch) s.branch = d.gitBranch;
    if (d.version && !s.versao) s.versao = d.version;
    if (d.type === 'summary' && d.summary && !s.resumo) s.resumo = String(d.summary);
    if (d.type === 'user' && d.message) {
      if (ehPromptReal(d)) {
        s.msgsUser++;
        const txt = limparPrompt(textoDe(d.message.content)) || textoDe(d.message.content).trim();
        if (s.prompts.length < 10) s.prompts.push({ t, texto: txt.slice(0, 300) });
      }
    } else if (d.type === 'assistant' && d.message) {
      s.msgsAssist++;
      if (d.message.model && !String(d.message.model).startsWith('<')) s.modelo = d.message.model;
      const c = d.message.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (!b || b.type !== 'tool_use') continue;
          const nome = b.name || 'tool';
          s.ferramentas[nome] = (s.ferramentas[nome] || 0) + 1;
          let f = arquivoDoInput(b.input);
          if (f && s.cwd && !path.isAbsolute(f) && !/^[a-zA-Z]:[\\/]/.test(f)) f = path.join(s.cwd, f);
          if (f) arqSet.add(f);
          s.eventos.push({ t: t || s.fim, ferramenta: nome, arquivo: f || null });
        }
      }
    }
  }
  tempos.sort((a, b) => a - b);
  for (let i = 1; i < tempos.length; i++) {
    const dt = tempos[i] - tempos[i - 1];
    if (dt > 0 && dt <= GAP_ATIVO) s.duracaoMs += dt;
  }
  if (s.eventos.length > MAX_EVENTOS_SESSAO) s.eventos = s.eventos.slice(-MAX_EVENTOS_SESSAO);
  s.arquivos = [...arqSet].slice(0, 500);
  const primeiro = s.prompts.find((p) => p.texto && !/^[<\[]/.test(p.texto)) || s.prompts[0];
  s.titulo = (s.resumo || (primeiro ? primeiro.texto : '') || ('sessão ' + s.sessionId.slice(0, 8))).replace(/\s+/g, ' ').slice(0, 80);
  return s;
}

function projetoDe(s, pastaProjeto) {
  if (s.cwd) return baseName(s.cwd);
  // fallback: "C--Users-x-Documents-proj" → último trecho
  const partes = pastaProjeto.split('-').filter(Boolean);
  return partes[partes.length - 1] || pastaProjeto;
}

async function ler(fonte) {
  const raiz = path.resolve(fonte.caminho);
  const cacheArq = path.join(DATA_DIR, 'cache', 'claude-' + fonte.id + '.json');
  const cache = readJSON(cacheArq, {});
  const novoCache = {};
  const sessoes = [];
  let pastas = [];
  try { pastas = (await fs.promises.readdir(raiz, { withFileTypes: true })).filter((e) => e.isDirectory()); } catch { pastas = []; }
  for (const p of pastas) {
    const dir = path.join(raiz, p.name);
    let arqs = [];
    try { arqs = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const a of arqs) {
      const abs = path.join(dir, a);
      let st;
      try { st = await fs.promises.stat(abs); } catch { continue; }
      const c = cache[abs];
      let s;
      if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) s = c.s;
      else {
        try { s = await lerSessao(abs); } catch { continue; }
      }
      novoCache[abs] = { mtimeMs: st.mtimeMs, size: st.size, s };
      if (!s.inicio) continue; // sessão vazia
      sessoes.push({ ...s, pastaProjeto: p.name, mtimeMs: st.mtimeMs, ativa: Date.now() - st.mtimeMs < ATIVA_MS });
    }
  }
  try { writeJSON(cacheArq, novoCache); } catch { /* cache é opcional */ }

  const nos = [];
  const links = [];
  const eventos = [];
  for (const s of sessoes) {
    const chave = 'sessao:' + s.sessionId;
    const total = Object.values(s.ferramentas).reduce((a, b) => a + b, 0);
    nos.push({
      chave, tipo: 'sessao', fonte: 'claude', titulo: s.titulo, subregiao: 'SESSOES',
      criado: s.inicio, modificado: s.fim, palavras: s.msgsUser + s.msgsAssist,
      autor: 'CLAUDE CODE', hash: s.sessionId.replace(/-/g, '').slice(0, 12), caminho: s.arquivo,
      projetoBruto: projetoDe(s, s.pastaProjeto), cwd: s.cwd,
      texto: [s.titulo, ...s.prompts.map((p) => p.texto), Object.keys(s.ferramentas).join(' '), s.arquivos.map((f) => baseName(f)).join(' ')].join('\n').slice(0, 4000),
      extra: {
        sessionId: s.sessionId, cwd: s.cwd, branch: s.branch, versao: s.versao, modelo: s.modelo,
        msgsUser: s.msgsUser, msgsAssist: s.msgsAssist, ferramentas: s.ferramentas, totalFerramentas: total,
        arquivos: s.arquivos, duracaoMs: s.duracaoMs, ativa: s.ativa, prompts: s.prompts, mtimeMs: s.mtimeMs,
      },
      _eventos: s.eventos,
    });
    for (const f of s.arquivos) links.push({ de: chave, para: { caminho: f }, tipo: 'TOCA', peso: 0.6 });
    for (const e of s.eventos) {
      eventos.push({ t: e.t, fonte: 'claude', msg: `TOOL ${e.ferramenta}${e.arquivo ? ' ' + baseName(e.arquivo) : ''} · ${s.sessionId.slice(0, 8)}`, chave, hash: s.sessionId.replace(/-/g, '').slice(0, 12), arquivo: e.arquivo });
    }
  }
  return { nos, links, eventos, itens: sessoes.length };
}

module.exports = { ler, normPath };
