'use strict';
// Resumo para outra IA ler antes de trabalhar: GET /api/resumo?projeto=&dias=[&formato=json]
// dados() monta a estrutura; gerar() a escreve em markdown curto (≤ ~4 KB).
const { slug, dayKey } = require('./util');

const LIMITE = 4000;
const N_COMMITS = 8, N_SESSOES = 6, N_AGENTES = 5, N_DIARIO = 6, N_CONECT = 8, N_MUDADOS = 8, N_ORFAOS = 6;
const data = (t) => dayKey(t); // data local
const dataHora = (t) => { const d = new Date(t); return `${dayKey(t)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const curto = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const dur = (ms) => (ms >= 3600000 ? (ms / 3600000).toFixed(1) + ' h' : Math.round(ms / 60000) + ' min');
const base = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || '';
const ehAgente = (n) => !!(n.extra && n.extra.agente);
const ehDiario = (n) => n.fonte === 'diario' || !!(n.extra && n.extra.diario);

function item(n, extra) {
  return { id: n.id, idCurto: n.idCurto, tipo: n.tipo, titulo: n.titulo, criado: Math.round(n.criado), modificado: Math.round(n.modificado), ...extra };
}

function dados(G, { projeto, dias = 7 } = {}) {
  const I = G.interno;
  const desde = dias > 0 ? Date.now() - dias * 864e5 : 0; // dias = 0 → todo o histórico
  const chave = projeto ? slug(projeto) : null;
  const nomeDe = (k) => I.nomeProj.get(k) || k;
  const conhecidos = [...new Set(I.nos.filter((n) => n.tipo !== 'dia').map((n) => nomeDe(n.projeto)))];
  if (chave && !I.nos.some((n) => n.projeto === chave)) {
    return { encontrado: false, projeto, projetosConhecidos: conhecidos, versao: G.publico.versao };
  }
  const nos = I.nos.filter((n) => n.tipo !== 'dia' && (!chave || n.projeto === chave));
  const c = { neuronios: nos.length, notas: 0, commits: 0, linhas: 0, sessoes: 0, agentes: 0, horasIA: 0, ferramentas: 0, diario: 0, mudaramNoPeriodo: 0 };
  let ms = 0;
  for (const n of nos) {
    if (n.tipo === 'nota') { if (ehDiario(n)) c.diario++; else c.notas++; }
    else if (n.tipo === 'commit') { c.commits++; c.linhas += n.palavras || 0; }
    else if (n.tipo === 'sessao') { if (ehAgente(n)) c.agentes++; else c.sessoes++; ms += n.extra.duracaoMs || 0; c.ferramentas += n.extra.totalFerramentas || 0; }
    if (n.modificado >= desde) c.mudaramNoPeriodo++;
  }
  c.horasIA = Math.round(ms / 360000) / 10;

  const recentes = (filtro) => nos.filter((n) => filtro(n) && n.modificado >= desde).sort((a, b) => b.modificado - a.modificado);
  const commits = recentes((n) => n.tipo === 'commit');
  const sessoes = recentes((n) => n.tipo === 'sessao' && !ehAgente(n));
  const agentes = recentes((n) => n.tipo === 'sessao' && ehAgente(n));
  const diario = nos.filter(ehDiario).sort((a, b) => b.criado - a.criado);
  const conectaveis = nos.filter((n) => (n.tipo === 'nota' || n.tipo === 'doc' || n.tipo === 'arquivo') && !ehDiario(n));
  const maisConectados = conectaveis.filter((n) => n.grau > 0 && !n.orfao).sort((a, b) => b.grau - a.grau);
  const mudados = recentes((n) => (n.tipo === 'nota' || n.tipo === 'doc') && !ehDiario(n));
  const orfaos = nos.filter((n) => n.orfao && (n.tipo === 'nota' || n.tipo === 'doc'));

  const sess = (n) => item(n, {
    pasta: n.subregiao && n.subregiao !== 'SESSOES' ? n.subregiao : null, duracaoMs: n.extra.duracaoMs || 0,
    ferramentas: n.extra.totalFerramentas || 0, arquivos: (n.extra.arquivos || []).slice(-6).map(base), autor: n.autor,
    ...(ehAgente(n) ? { agente: { tipo: n.extra.agente.tipo, pai: n.extra.agente.pai } } : {}),
  });
  const out = {
    encontrado: true,
    projeto: chave ? nomeDe(chave) : null, dias, desde: Math.round(desde), geradoEm: Date.now(), versao: G.publico.versao,
    contadores: c,
    commits: { total: commits.length, itens: commits.slice(0, N_COMMITS).map((n) => item(n, { hash: n.hash.slice(0, 7), mais: n.extra.mais, menos: n.extra.menos, autor: n.autor })) },
    sessoes: { total: sessoes.length, itens: sessoes.slice(0, N_SESSOES).map(sess) },
    agentes: { total: agentes.length, itens: agentes.slice(0, N_AGENTES).map(sess) },
    diario: { total: diario.length, itens: diario.slice(0, N_DIARIO).map((n) => item(n, { autor: n.autor })) },
    maisConectados: { total: maisConectados.length, itens: maisConectados.slice(0, N_CONECT).map((n) => item(n, { grau: n.grau })) },
    mudados: { total: mudados.length, itens: mudados.slice(0, N_MUDADOS).map((n) => item(n, {})) },
    orfaos: { total: orfaos.length, itens: orfaos.slice(0, N_ORFAOS).map((n) => item(n, {})) },
  };
  if (!chave) {
    const porProj = new Map();
    for (const n of nos) {
      const p = porProj.get(n.projeto) || { projeto: nomeDe(n.projeto), neuronios: 0, mudaramNoPeriodo: 0, ultimoPulso: 0 };
      p.neuronios++; if (n.modificado > p.ultimoPulso) p.ultimoPulso = Math.round(n.modificado); if (n.modificado >= desde) p.mudaramNoPeriodo++;
      porProj.set(n.projeto, p);
    }
    out.projetos = [...porProj.values()].sort((a, b) => b.ultimoPulso - a.ultimoPulso);
  }
  return out;
}

function gerar(G, opcoes = {}) {
  const d = dados(G, opcoes);
  if (!d.encontrado) return `# CÓRTEX · projeto "${d.projeto}" não encontrado\n\nProjetos conhecidos: ${d.projetosConhecidos.join(', ') || 'nenhum'}.\n`;
  const proj = d.projeto;
  const pj = proj ? ` --projeto ${/\s/.test(proj) ? `"${proj}"` : proj}` : '';
  const verMais = (tipos) => `\`cortex listar${pj} --tipos ${tipos}${d.dias ? ` --desde ${d.dias}d` : ''}\``;
  const periodo = d.dias ? `últimos ${d.dias} dias` : 'todo o histórico';
  const quantos = (sec, n) => (sec.total > n ? `${Math.min(n, sec.itens.length)} de ${sec.total}` : `${sec.total}`);
  const c = d.contadores;
  const L = [];
  L.push(`# CÓRTEX · ${proj ? proj.toUpperCase() : 'VISÃO GERAL'} · ${periodo}`);
  L.push(`gerado ${dataHora(d.geradoEm)} (hora local) · grafo v${d.versao} · ids entre crases são o idCurto (cite assim; \`cortex no <id>\` abre)`);
  L.push('');
  L.push(`**Totais:** ${c.neuronios} neurônios · ${c.notas} notas · ${c.commits} commits (${c.linhas} linhas) · ${c.sessoes} sessões + ${c.agentes} agentes · ${c.horasIA} h de IA · ${c.ferramentas} ferramentas · ${c.diario} registros no diário · ${c.mudaramNoPeriodo} mudaram no período`);
  L.push('');

  if (d.projetos) {
    L.push('## Projetos');
    for (const p of d.projetos.slice(0, 12)) L.push(`- ${p.projeto}: ${p.neuronios} neurônios, ${p.mudaramNoPeriodo} mudaram no período, último pulso ${data(p.ultimoPulso)}`);
    if (d.projetos.length > 12) L.push(`- … mais ${d.projetos.length - 12} (\`cortex projetos\`)`);
    L.push('');
  }

  L.push(`## Últimos commits (${quantos(d.commits, N_COMMITS)} no período)`);
  if (!d.commits.total) L.push('- nenhum');
  for (const n of d.commits.itens) L.push(`- \`${n.idCurto}\` ${n.hash} ${data(n.criado)} ${curto(n.titulo, 80)} (+${n.mais}/-${n.menos})`);
  if (d.commits.total > d.commits.itens.length) L.push(`- ver todos: ${verMais('commit')}`);
  L.push('');

  const linhaSessao = (n) => {
    const pasta = n.pasta ? ` [${n.pasta}]` : '';
    const arqs = n.arquivos.slice(-4).join(', ');
    return `- \`${n.idCurto}\` ${data(n.criado)}${pasta} · ${dur(n.duracaoMs)} · ${n.ferramentas} ferramentas · ${curto(n.titulo, 64)}${arqs ? ` · arquivos: ${arqs}` : ''}`;
  };
  L.push(`## Últimas sessões do Claude Code (${quantos(d.sessoes, N_SESSOES)} sessões + ${d.agentes.total} agentes no período)`);
  if (!d.sessoes.total && !d.agentes.total) L.push('- nenhuma');
  for (const n of d.sessoes.itens) L.push(linhaSessao(n));
  if (d.agentes.total) {
    L.push(`- agentes (${quantos(d.agentes, N_AGENTES)}):`);
    for (const n of d.agentes.itens) L.push('  ' + linhaSessao(n));
  }
  if (d.sessoes.total + d.agentes.total > d.sessoes.itens.length + d.agentes.itens.length) L.push(`- ver todas: ${verMais('sessao')}`);
  L.push('');

  L.push(`## Diário (${quantos(d.diario, N_DIARIO)})`);
  if (!d.diario.total) L.push('- nenhum registro (`cortex registrar ...` grava um)');
  for (const n of d.diario.itens) L.push(`- \`${n.idCurto}\` ${data(n.criado)} · ${curto(n.titulo, 80)} · ${n.autor}`);
  L.push('');

  L.push(`## Neurônios mais conectados (${quantos(d.maisConectados, N_CONECT)})`);
  if (!d.maisConectados.total) L.push('- nenhum');
  for (const n of d.maisConectados.itens) L.push(`- \`${n.idCurto}\` ${curto(n.titulo, 60)} (${n.tipo}, grau ${n.grau})`);
  L.push('');

  L.push(`## Notas e docs mudados no período (${quantos(d.mudados, N_MUDADOS)})`);
  if (!d.mudados.total) L.push('- nenhum');
  for (const n of d.mudados.itens) L.push(`- \`${n.idCurto}\` ${data(n.modificado)} ${curto(n.titulo, 70)}`);
  if (d.mudados.total > d.mudados.itens.length) L.push(`- ver todos: ${verMais('nota,doc')}`);
  L.push('');

  L.push(`## Órfãos sem ligação (${quantos(d.orfaos, N_ORFAOS)})`);
  L.push(d.orfaos.total ? d.orfaos.itens.map((n) => `\`${n.idCurto}\` ${curto(n.titulo, 40)}`).join(' · ') : '- nenhum');
  L.push('');

  let txt = L.join('\n');
  if (Buffer.byteLength(txt) > LIMITE) {
    while (Buffer.byteLength(txt) > LIMITE - 60) txt = txt.slice(0, txt.lastIndexOf('\n'));
    txt += '\n\n…(resumo cortado em ~4 KB; `cortex resumo --json` traz tudo)\n';
  }
  return txt;
}

module.exports = { gerar, dados };
