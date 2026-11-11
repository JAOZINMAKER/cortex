'use strict';
// Visões (filtros salvos) em data/visoes.json + visão atual de todas as janelas.
const path = require('path');
const { readJSON, writeJSON, slug } = require('./util');
const config = require('./config');

const ARQ = () => path.join(config.DATA_DIR, 'visoes.json');
const ARQ_ATUAL = () => path.join(config.DATA_DIR, 'visao-atual.json');
const TIPOS_FONTE = new Set(['obsidian', 'git', 'claude', 'pasta']);
const TIPOS_NO = new Set(['nota', 'commit', 'branch', 'worktree', 'sessao', 'arquivo', 'doc', 'dia']);

let estado = null; // { visoes: Visao[], ocultas: string[] }
let atual = undefined;

function carregar() {
  if (!estado) {
    estado = readJSON(ARQ(), null) || { visoes: [], ocultas: [] };
    if (!Array.isArray(estado.visoes)) estado.visoes = [];
    if (!Array.isArray(estado.ocultas)) estado.ocultas = [];
  }
  return estado;
}
function salvar() { writeJSON(ARQ(), estado); }

function lista(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = arr.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? out : undefined;
}

const RELATIVO = /^\d+(?:\.\d+)?\s*[mhdsw]$/i;

// visão com desde/ate relativos resolvidos para epoch ms (usado no recorte)
function resolver(v) {
  if (!v) return v;
  const r = { ...v };
  for (const k of ['desde', 'ate']) if (r[k] !== undefined) r[k] = Math.round(tempo(r[k]) || 0) || undefined;
  return r;
}

// "7d", "12h", "30m", epoch ms ou data ISO → epoch ms
function tempo(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const rel = s.match(/^(\d+(?:\.\d+)?)\s*([mhdsw])$/i);
  if (rel) {
    const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[rel[2].toLowerCase()];
    return Date.now() - parseFloat(rel[1]) * mult;
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

// normaliza uma Visao vinda de JSON ou de query string
function normalizar(o) {
  if (!o || typeof o !== 'object') return null;
  const v = {};
  v.id = o.id ? slug(o.id) : undefined;
  v.nome = o.nome ? String(o.nome).slice(0, 80) : undefined;
  const projetos = lista(o.projetos); if (projetos) v.projetos = projetos;
  const fontes = lista(o.fontes); if (fontes) v.fontes = fontes.filter((f) => TIPOS_FONTE.has(f));
  const tipos = lista(o.tipos); if (tipos) v.tipos = tipos.filter((t) => TIPOS_NO.has(t));
  // "7d"/"12h" ficam relativos (uma visão salva "últimos 7 dias" continua valendo amanhã); o resto vira epoch ms
  for (const k of ['desde', 'ate']) {
    if (o[k] === undefined || o[k] === null || o[k] === '') continue;
    if (RELATIVO.test(String(o[k]).trim())) v[k] = String(o[k]).trim().toLowerCase();
    else { const t = tempo(o[k]); if (t) v[k] = Math.round(t); }
  }
  const tags = lista(o.tags); if (tags) v.tags = tags.map((t) => t.toUpperCase());
  if (o.grauMin !== undefined && o.grauMin !== '') v.grauMin = Math.max(0, parseInt(o.grauMin, 10) || 0);
  if (o.texto) v.texto = String(o.texto).slice(0, 200);
  if (o.vizinhos !== undefined && o.vizinhos !== '') v.vizinhos = Math.max(0, Math.min(2, parseInt(o.vizinhos, 10) || 0));
  for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
  return v;
}

function temFiltro(v) {
  return !!v && ['projetos', 'fontes', 'tipos', 'desde', 'ate', 'tags', 'grauMin', 'texto', 'vizinhos'].some((k) => v[k] !== undefined && !(k === 'vizinhos' && !v[k]) && !(k === 'grauMin' && !v[k]));
}

function todas() { return carregar().visoes; }
function obter(id) { return todas().find((v) => v.id === slug(id)) || null; }

function gravar(obj) {
  const v = normalizar(obj);
  if (!v) throw new Error('visão inválida');
  if (!v.id) v.id = slug(v.nome || 'visao-' + Date.now().toString(36));
  if (!v.nome) v.nome = v.id.toUpperCase();
  const e = carregar();
  const i = e.visoes.findIndex((x) => x.id === v.id);
  const antes = i >= 0 ? e.visoes[i] : null;
  if (antes && antes.padrao) v.padrao = true;
  if (i >= 0) e.visoes[i] = v; else e.visoes.push(v);
  e.ocultas = e.ocultas.filter((x) => x !== v.id);
  salvar();
  return v;
}

function remover(id) {
  const e = carregar();
  const i = e.visoes.findIndex((x) => x.id === slug(id));
  if (i < 0) return false;
  const [v] = e.visoes.splice(i, 1);
  if (v.padrao && !e.ocultas.includes(v.id)) e.ocultas.push(v.id); // não ressuscita no próximo boot
  salvar();
  return true;
}

// "TUDO" e uma por projeto; chamada a cada montagem do grafo
function garantirPadrao(projetos) {
  const e = carregar();
  let mudou = false;
  const quer = [{ id: 'tudo', nome: 'TUDO', padrao: true }];
  for (const p of projetos) quer.push({ id: 'so-' + slug(p), nome: 'SÓ ' + String(p).toUpperCase(), projetos: [p], padrao: true });
  for (const v of quer) {
    if (e.ocultas.includes(v.id) || e.visoes.some((x) => x.id === v.id)) continue;
    e.visoes.push(v);
    mudou = true;
  }
  if (mudou) salvar();
}

function getAtual() {
  if (atual === undefined) atual = readJSON(ARQ_ATUAL(), { visao: null }).visao || null;
  return atual;
}
function setAtual(v) {
  atual = v || null;
  writeJSON(ARQ_ATUAL(), { visao: atual, em: Date.now() });
  return atual;
}

module.exports = { resolver, normalizar, temFiltro, todas, obter, gravar, remover, garantirPadrao, getAtual, setAtual, tempo };
