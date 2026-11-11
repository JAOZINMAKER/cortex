'use strict';
// Contexto para começar a trabalhar num projeto: resumo recente, últimas sessões, diário e notas centrais.
const resumo = require('../resumo');
const { data, curto, dur, base, ehAgente, ehDiario, cita, projetoDe, nosDo } = require('./comum');

function executar(G, params = {}) {
  const proj = projetoDe(G, params.projeto);
  const dias = Math.max(1, Math.min(365, parseInt(params.dias, 10) || 14));
  const d = resumo.dados(G, { projeto: proj.nome, dias });
  const nos = nosDo(G, proj);
  const sessoes = nos.filter((n) => n.tipo === 'sessao' && !ehAgente(n)).sort((a, b) => b.modificado - a.modificado).slice(0, 4);
  const diario = nos.filter(ehDiario).sort((a, b) => b.criado - a.criado).slice(0, 5);
  const centrais = nos.filter((n) => (n.tipo === 'nota' || n.tipo === 'doc') && !ehDiario(n) && n.grau > 0).sort((a, b) => b.grau - a.grau).slice(0, 10);
  const quentes = new Map();
  for (const s of nos.filter((n) => n.tipo === 'sessao' && n.modificado >= d.desde)) for (const a of s.extra.arquivos || []) quentes.set(a, (quentes.get(a) || 0) + 1);
  const subs = new Map();
  for (const n of nos) subs.set(n.subregiao, (subs.get(n.subregiao) || 0) + 1);
  const c = d.contadores;

  const L = [`# Contexto · ${proj.nome.toUpperCase()} · últimos ${dias} dias`, ''];
  L.push(`${c.neuronios} neurônios · ${c.notas} notas · ${c.commits} commits · ${c.sessoes} sessões + ${c.agentes} agentes · ${c.horasIA} h de IA · ${c.diario} registros no diário.`);
  L.push(`**Partes do projeto:** ${[...subs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} (${v})`).join(' · ')}`);
  L.push('', '## O que aconteceu por último');
  for (const x of d.commits.itens.slice(0, 5)) L.push(`- commit \`${x.idCurto}\` ${x.hash} ${data(x.criado)} ${curto(x.titulo, 80)}`);
  for (const s of sessoes) {
    const ped = (s.extra.prompts || []).filter((p) => p.texto && !/^[<\[]/.test(p.texto)).slice(-1)[0];
    L.push(`- sessão ${cita(s)} ${data(s.criado)} · ${dur(s.extra.duracaoMs || 0)} · ${curto(s.titulo, 70)}${ped ? ` — último pedido: "${curto(ped.texto, 90)}"` : ''}`);
  }
  if (!d.commits.itens.length && !sessoes.length) L.push('- nada no período');
  L.push('', '## Diário (decisões e registros)');
  if (!diario.length) L.push('- vazio');
  for (const n of diario) {
    const linha = (n.texto || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
    L.push(`- ${cita(n)} ${data(n.criado)} **${curto(n.titulo, 70)}**${linha ? ' — ' + curto(linha, 110) : ''}`);
  }
  L.push('', '## Notas centrais (mais ligadas)');
  if (!centrais.length) L.push('- nenhuma');
  for (const n of centrais) L.push(`- ${cita(n)} ${curto(n.titulo, 60)} (grau ${n.grau})`);
  L.push('', '## Arquivos em foco nas sessões recentes');
  if (!quentes.size) L.push('- nenhum');
  for (const [a, v] of [...quentes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)) L.push(`- ${base(a)} ×${v} — ${a}`);
  L.push('', `Para abrir qualquer item: \`cortex no <id>\`. Para registrar o que fizer: \`cortex registrar --projeto ${proj.nome} ...\`.`);

  return {
    markdown: L.join('\n') + '\n',
    dados: {
      projeto: proj.nome, dias, contadores: c, commits: d.commits.itens.slice(0, 5),
      sessoes: sessoes.map((s) => ({ id: s.id, idCurto: s.idCurto, titulo: s.titulo, criado: Math.round(s.criado), duracaoMs: s.extra.duracaoMs || 0, ultimoPedido: ((s.extra.prompts || []).slice(-1)[0] || {}).texto || null })),
      diario: diario.map((n) => ({ id: n.id, idCurto: n.idCurto, titulo: n.titulo, criado: Math.round(n.criado), autor: n.autor })),
      centrais: centrais.map((n) => ({ id: n.id, idCurto: n.idCurto, titulo: n.titulo, grau: n.grau })),
      arquivosEmFoco: [...quentes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20).map(([caminho, vezes]) => ({ caminho, vezes })),
      partes: Object.fromEntries([...subs.entries()].sort((a, b) => b[1] - a[1])),
    },
  };
}

module.exports = { executar };
