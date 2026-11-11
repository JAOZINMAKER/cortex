'use strict';
// Revisão semanal de um projeto (determinística). Com gravar=true, vira uma entrada no diário.
const resumo = require('../resumo');
const { data, curto, dur, base, ehAgente, cita, projetoDe, nosDo } = require("./comum");

async function executar(G, params = {}, ctx = {}) {
  const proj = projetoDe(G, params.projeto);
  const dias = Math.max(1, Math.min(90, parseInt(params.dias, 10) || 7));
  const d = resumo.dados(G, { projeto: proj.nome, dias });
  const desde = d.desde;
  const nos = nosDo(G, proj);
  const noPeriodo = nos.filter((n) => n.modificado >= desde);
  const commits = noPeriodo.filter((n) => n.tipo === 'commit').sort((a, b) => a.criado - b.criado);
  const sessoes = noPeriodo.filter((n) => n.tipo === 'sessao').sort((a, b) => a.criado - b.criado);

  // horas de IA por dia e onde houve mais atividade
  const porDia = new Map();
  for (const s of sessoes) porDia.set(data(s.criado), (porDia.get(data(s.criado)) || 0) + (s.extra.duracaoMs || 0));
  const porSub = new Map();
  for (const n of noPeriodo) if (n.tipo !== 'sessao' && n.tipo !== 'commit') porSub.set(n.subregiao, (porSub.get(n.subregiao) || 0) + 1);
  const autores = new Map();
  for (const c of commits) autores.set(c.autor, (autores.get(c.autor) || 0) + 1);
  const arqs = new Map();
  for (const s of sessoes) for (const a of s.extra.arquivos || []) arqs.set(base(a), (arqs.get(base(a)) || 0) + 1);

  const c = d.contadores;
  const ini = data(desde), fim = data(Date.now());
  const L = [`# Revisão semanal · ${proj.nome.toUpperCase()} · ${ini} a ${fim}`, ''];
  L.push(`**Números:** ${commits.length} commits (+${commits.reduce((a, x) => a + x.extra.mais, 0)}/-${commits.reduce((a, x) => a + x.extra.menos, 0)}) · ${sessoes.filter((s) => !ehAgente(s)).length} sessões + ${sessoes.filter(ehAgente).length} agentes · ${dur(sessoes.reduce((a, s) => a + (s.extra.duracaoMs || 0), 0))} de IA · ${c.mudaramNoPeriodo} neurônios mudaram · ${d.diario.itens.filter((x) => x.criado >= desde).length} registros no diário`);
  if (porDia.size) L.push(`**IA por dia:** ${[...porDia.entries()].sort().map(([k, v]) => `${k.slice(5)} ${dur(v)}`).join(' · ')}`);
  if (autores.size) L.push(`**Autores dos commits:** ${[...autores.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(' · ')}`);
  L.push('', `## Commits (${commits.length})`);
  if (!commits.length) L.push('- nenhum');
  for (const x of commits.slice(-20)) L.push(`- ${cita(x)} ${x.hash.slice(0, 7)} ${data(x.criado)} ${curto(x.titulo, 90)}`);
  if (commits.length > 20) L.push(`- … e mais ${commits.length - 20} (\`cortex listar --projeto ${proj.nome} --tipos commit --desde ${dias}d\`)`);
  L.push('', `## Sessões e agentes (${sessoes.length})`);
  if (!sessoes.length) L.push('- nenhuma');
  for (const s of sessoes.slice(-12)) L.push(`- ${cita(s)} ${data(s.criado)}${ehAgente(s) ? ' [agente]' : ''} · ${dur(s.extra.duracaoMs || 0)} · ${curto(s.titulo, 80)}`);
  if (arqs.size) L.push(`- arquivos mais mexidos pelas sessões: ${[...arqs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
  L.push('', `## Onde houve mais atividade`);
  if (!porSub.size) L.push('- só commits e sessões');
  for (const [k, v] of [...porSub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) L.push(`- ${k}: ${v} mudanças`);
  L.push('', `## Notas e docs mudados (${d.mudados.total})`);
  if (!d.mudados.total) L.push('- nenhum');
  for (const n of d.mudados.itens) L.push(`- \`${n.idCurto}\` ${curto(n.titulo, 80)}`);
  L.push('', '## Para a próxima semana');
  const sug = [];
  const ultSess = sessoes.filter((s) => !ehAgente(s)).pop();
  const ultCommit = commits[commits.length - 1];
  if (ultSess && (!ultCommit || ultCommit.criado < ultSess.criado)) sug.push(`a última sessão (${data(ultSess.criado)}) não tem commit depois dela: conferir se o trabalho foi salvo`);
  if (d.orfaos.total) sug.push(`${d.orfaos.total} notas órfãs: rodar a skill de ligações (\`cortex executar ligacoes --projeto ${proj.nome}\`)`);
  if (!d.diario.itens.some((x) => x.criado >= desde)) sug.push('nada registrado no diário no período: registrar decisões importantes com `cortex registrar`');
  if (!commits.length && sessoes.length) sug.push('teve sessão mas nenhum commit');
  if (!sug.length) sug.push('nada pendente detectado');
  for (const s of sug) L.push(`- ${s}`);

  const markdown = L.join('\n') + '\n';
  const dados = {
    projeto: proj.nome, dias, desde, ate: Date.now(), contadores: c,
    commits: commits.map((x) => ({ id: x.id, idCurto: x.idCurto, hash: x.hash.slice(0, 7), titulo: x.titulo, criado: Math.round(x.criado) })),
    sessoes: sessoes.map((s) => ({ id: s.id, idCurto: s.idCurto, titulo: s.titulo, agente: ehAgente(s), duracaoMs: s.extra.duracaoMs || 0, criado: Math.round(s.criado) })),
    iaPorDia: Object.fromEntries([...porDia.entries()].sort()), atividadePorSubregiao: Object.fromEntries([...porSub.entries()].sort((a, b) => b[1] - a[1])),
    sugestoes: sug,
  };
  let registradoEm;
  if (params.gravar && ctx.registrar) {
    const ligar = [...commits.slice(-6), ...sessoes.filter((s) => !ehAgente(s)).slice(-4)].map((x) => x.id);
    registradoEm = await ctx.registrar({ projeto: proj.nome, titulo: `Revisão semanal ${ini} a ${fim}`, texto: L.slice(2).join('\n'), tags: ['revisao-semanal'], autor: 'CÓRTEX (revisão semanal)', ligar });
  }
  return { markdown, dados, registradoEm };
}

module.exports = { executar };
