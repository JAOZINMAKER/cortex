'use strict';
// Executores determinísticos das skills (POST /api/skills/:nome/executar). Aceitam "onde-parei" ou "cortex-onde-parei".
const EXECUTORES = {
  'onde-parei': require('./onde-parei'),
  'revisao-semanal': require('./revisao-semanal'),
  ligacoes: require('./ligacoes'),
  contexto: require('./contexto'),
};

function executor(nome) {
  const k = String(nome || '').replace(/^cortex-/, '');
  return EXECUTORES[k] ? { nome: k, ...EXECUTORES[k] } : null;
}

module.exports = { executor, nomes: Object.keys(EXECUTORES) };
