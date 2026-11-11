'use strict';
// Utilidades dos executores determinísticos de skills (server/skills/*.js).
const { slug, dayKey } = require('../util');

const data = (t) => dayKey(t);
const dataHora = (t) => { const d = new Date(t); return `${dayKey(t)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const curto = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const dur = (ms) => (ms >= 3600000 ? (ms / 3600000).toFixed(1) + ' h' : Math.max(1, Math.round(ms / 60000)) + ' min');
const base = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || '';
const ehAgente = (n) => !!(n.extra && n.extra.agente);
const ehDiario = (n) => n.fonte === 'diario';
const cita = (n) => `\`${n.idCurto}\``;

// projeto obrigatório → chave (slug) e nome; erro com a lista de projetos conhecidos
function projetoDe(G, nome, { opcional = false } = {}) {
  const I = G.interno;
  if (!nome) {
    if (opcional) return null;
    const e = new Error('informe o projeto'); e.status = 400; e.projetos = conhecidos(G); throw e;
  }
  const k = slug(nome);
  if (!I.nos.some((n) => n.projeto === k)) {
    const e = new Error(`projeto "${nome}" não encontrado`); e.status = 404; e.projetos = conhecidos(G); throw e;
  }
  return { chave: k, nome: I.nomeProj.get(k) || k };
}

function conhecidos(G) {
  return [...new Set(G.interno.nos.filter((n) => n.tipo !== 'dia').map((n) => G.interno.nomeProj.get(n.projeto) || n.projeto))].sort();
}

function nosDo(G, proj) {
  return G.interno.nos.filter((n) => n.tipo !== 'dia' && (!proj || n.projeto === proj.chave));
}

// item enxuto para "dados"
function item(n, extra = {}) {
  return { id: n.id, idCurto: n.idCurto, tipo: n.tipo, titulo: n.titulo, criado: Math.round(n.criado), modificado: Math.round(n.modificado), ...extra };
}

const RE_PENDENCIA = /\b(pendente|pendência|pendencias|pendências|todo|a fazer|falta|faltam|próximo passo|proximos passos|próximos passos|next step|bloqueado|revisar)\b/i;

module.exports = { data, dataHora, curto, dur, base, ehAgente, ehDiario, cita, projetoDe, conhecidos, nosDo, item, RE_PENDENCIA };
