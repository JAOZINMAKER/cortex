'use strict';
// "Onde parei?": última sessão do projeto, arquivos tocados, último commit e pendências do diário.
const { data, dataHora, curto, dur, base, ehAgente, ehDiario, cita, projetoDe, nosDo, item, RE_PENDENCIA } = require('./comum');

function executar(G, params = {}) {
  const proj = projetoDe(G, params.projeto);
  const nos = nosDo(G, proj);
  const sessoes = nos.filter((n) => n.tipo === 'sessao' && !ehAgente(n)).sort((a, b) => b.modificado - a.modificado);
  const commits = nos.filter((n) => n.tipo === 'commit').sort((a, b) => b.criado - a.criado);
  const diario = nos.filter(ehDiario).sort((a, b) => b.criado - a.criado);
  const ult = sessoes[0] || null;
  const agentes = ult ? nos.filter((n) => ehAgente(n) && n.extra.agente.pai === ult.extra.sessionId).sort((a, b) => b.modificado - a.modificado) : [];
  const referencia = ult ? ult.criado : (commits[0] ? commits[0].criado : 0);
  const pendencias = diario.filter((n) => RE_PENDENCIA.test(n.texto || '') || (n.tagsAutor || []).some((t) => /pend|todo|fazer/i.test(t))).slice(0, 6);
  const mudadasDesde = referencia ? nos.filter((n) => (n.tipo === 'nota' || n.tipo === 'doc') && !ehDiario(n) && n.modificado >= referencia).sort((a, b) => b.modificado - a.modificado) : [];

  const L = [`# Onde parei · ${proj.nome.toUpperCase()}`, ''];
  if (ult) {
    const e = ult.extra;
    const pasta = ult.subregiao && ult.subregiao !== 'SESSOES' ? ` em **${ult.subregiao}**` : '';
    L.push(`## Última sessão ${cita(ult)}`);
    L.push(`${dataHora(ult.criado)} → ${dataHora(ult.modificado)}${pasta} · ${dur(e.duracaoMs || 0)} ativa · ${e.totalFerramentas || 0} ferramentas · ${e.msgsUser || 0} mensagens suas`);
    L.push(`**Assunto:** ${curto(ult.titulo, 120)}`);
    const pedidos = (e.prompts || []).filter((p) => p.texto && !/^[<\[]/.test(p.texto)).slice(-3);
    if (pedidos.length) { L.push('', '**Últimos pedidos:**'); for (const p of pedidos) L.push(`- ${curto(p.texto, 160)}`); }
    const arqs = (e.arquivos || []).slice(-12).reverse();
    L.push('', `**Arquivos tocados (${(e.arquivos || []).length}):** ${arqs.length ? arqs.map(base).join(', ') : 'nenhum'}`);
    const top = Object.entries(e.ferramentas || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ×${v}`).join(' · ');
    if (top) L.push(`**Ferramentas:** ${top}`);
    if (agentes.length) { L.push('', `**Agentes dessa sessão (${agentes.length}):**`); for (const a of agentes.slice(0, 6)) L.push(`- ${cita(a)} ${curto(a.titulo, 80)} · ${dur(a.extra.duracaoMs || 0)} · ${a.extra.totalFerramentas || 0} ferramentas`); }
  } else {
    L.push('## Última sessão', '- nenhuma sessão do Claude Code neste projeto');
  }
  L.push('', '## Últimos commits');
  if (!commits.length) L.push('- nenhum');
  for (const c of commits.slice(0, 3)) L.push(`- ${cita(c)} ${c.hash.slice(0, 7)} ${data(c.criado)} ${curto(c.titulo, 90)} (+${c.extra.mais}/-${c.extra.menos})`);
  if (ult && commits[0] && commits[0].criado < ult.criado) L.push(`- ⚠ nenhum commit depois da última sessão (${data(ult.criado)}): o trabalho dela pode não estar commitado`);
  L.push('', '## Pendências no diário');
  if (!pendencias.length) L.push(diario.length ? '- nenhuma entrada com "pendente/falta/TODO/próximo passo"' : '- o diário deste projeto está vazio');
  for (const n of pendencias) {
    const linha = (n.texto || '').split(/\r?\n/).find((l) => RE_PENDENCIA.test(l)) || '';
    L.push(`- ${cita(n)} ${data(n.criado)} **${curto(n.titulo, 70)}**${linha ? ' — ' + curto(linha.replace(/^[#\-\s*]+/, ''), 120) : ''}`);
  }
  L.push('', `## Notas mudadas desde então (${mudadasDesde.length})`);
  if (!mudadasDesde.length) L.push('- nenhuma');
  for (const n of mudadasDesde.slice(0, 8)) L.push(`- ${cita(n)} ${dataHora(n.modificado)} ${curto(n.titulo, 70)}`);

  return {
    markdown: L.join('\n') + '\n',
    dados: {
      projeto: proj.nome,
      ultimaSessao: ult ? item(ult, { pasta: ult.subregiao, duracaoMs: ult.extra.duracaoMs || 0, ferramentas: ult.extra.ferramentas || {}, arquivos: ult.extra.arquivos || [],
        prompts: (ult.extra.prompts || []).slice(-3).map((p) => p.texto) }) : null,
      agentes: agentes.map((a) => item(a, { duracaoMs: a.extra.duracaoMs || 0, ferramentas: a.extra.totalFerramentas || 0 })),
      commits: commits.slice(0, 3).map((c) => item(c, { hash: c.hash.slice(0, 7), mais: c.extra.mais, menos: c.extra.menos })),
      commitDepoisDaSessao: !!(ult && commits[0] && commits[0].criado >= ult.criado),
      pendencias: pendencias.map((n) => item(n, { autor: n.autor })),
      mudadasDesde: mudadasDesde.slice(0, 20).map((n) => item(n)),
    },
  };
}

module.exports = { executar };
