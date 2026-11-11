'use strict';
// Ajustes de interface persistidos em data/ajustes.json (CONTRATO V3).
const path = require('path');
const { readJSON, writeJSON } = require('./util');
const config = require('./config');

const ARQ = () => path.join(config.DATA_DIR, 'ajustes.json');
const PADRAO = {
  tema: 'grafite', brilho: 1, tamanhoPonto: 1, orcamentoRotulos: 180, densidadeRotulos: 'normal',
  mostrarSinapses: true, mostrarTecido: true, mostrarGrade: true, rotacaoAuto: false,
  paineis: { log: true, status: true, contadores: true, minimapa: true, linhaTempo: true },
  coresFonte: {}, som: false, visaoInicial: 'tudo',
};

let atual = null;
const num = (v, min, max, pad) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : pad; };
const cor = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : undefined);

function validar(base, o) {
  const a = JSON.parse(JSON.stringify(base));
  if (!o || typeof o !== 'object') return a;
  if (typeof o.tema === 'string' && o.tema.trim()) a.tema = o.tema.trim().toLowerCase().slice(0, 40);
  if (o.brilho !== undefined) a.brilho = num(o.brilho, 0.3, 2, a.brilho);
  if (o.tamanhoPonto !== undefined) a.tamanhoPonto = num(o.tamanhoPonto, 0.2, 4, a.tamanhoPonto);
  if (o.orcamentoRotulos !== undefined) a.orcamentoRotulos = Math.round(num(o.orcamentoRotulos, 0, 400, a.orcamentoRotulos));
  if (['minima', 'normal', 'maxima'].includes(o.densidadeRotulos)) a.densidadeRotulos = o.densidadeRotulos;
  for (const k of ['mostrarSinapses', 'mostrarTecido', 'mostrarGrade', 'rotacaoAuto', 'som']) if (typeof o[k] === 'boolean') a[k] = o[k];
  if (o.paineis && typeof o.paineis === 'object') for (const k of Object.keys(PADRAO.paineis)) if (typeof o.paineis[k] === 'boolean') a.paineis[k] = o.paineis[k];
  if (o.coresFonte === null) a.coresFonte = {};
  else if (o.coresFonte && typeof o.coresFonte === 'object') {
    for (const k of ['obsidian', 'git', 'claude', 'pasta']) {
      if (o.coresFonte[k] === null) delete a.coresFonte[k];
      else if (cor(o.coresFonte[k])) a.coresFonte[k] = cor(o.coresFonte[k]);
    }
  }
  if (typeof o.visaoInicial === 'string' && o.visaoInicial.trim()) a.visaoInicial = o.visaoInicial.trim().slice(0, 80);
  return a;
}

function get() {
  if (!atual) atual = validar(PADRAO, readJSON(ARQ(), {}));
  return atual;
}

// POST faz merge parcial; { padrao: true } volta aos padrões
function set(o) {
  atual = o && o.padrao === true ? validar(PADRAO, {}) : validar(get(), o);
  writeJSON(ARQ(), atual);
  return atual;
}

module.exports = { get, set, PADRAO };
