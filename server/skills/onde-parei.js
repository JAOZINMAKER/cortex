'use strict';
// "Onde parei?": última sessão do projeto, arquivos tocados, último commit e pendências do diário.
// Com `pasta` (o cwd de quem chama): se for um worktree/clone do projeto, primeiro o que aconteceu ali
// (commits da branch dele, sessões com aquele cwd, arquivos), depois o resto do projeto.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const projetoMod = require('../projeto');
const { normPath } = require('../util');
const { data, dataHora, curto, dur, base, ehAgente, ehDiario, cita, projetoDe, nosDo, item, RE_PENDENCIA } = require('./comum');

function git(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { return null; }
}

// contexto do worktree/clone onde a pessoa está
function contextoPasta(pasta) {
  if (!pasta || !fs.existsSync(pasta)) return null;
  const topo = git(pasta, ['rev-parse', '--show-toplevel']);
  if (!topo) return { pasta, nome: path.basename(pasta), topo: null, branch: null, shas: [] };
  const branch = git(topo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const shas = (git(topo, ['log', '-40', '--format=%H']) || '').split('\n').filter(Boolean);
  return { pasta, nome: path.basename(topo), topo, branch: branch === 'HEAD' ? null : branch, shas };
}

const dentro = (p, raiz) => { if (!p || !raiz) return false; const a = normPath(p), b = normPath(raiz); return a === b || a.startsWith(b + '/'); };

function executar(G, params = {}) {
  // projeto: o informado ou o descoberto pela pasta (apelidos, git, fontes)
  let nomeProj = params.projeto;
  if (!nomeProj && params.pasta) nomeProj = projetoMod.descobrir(params.pasta, config.get()).projeto;
  const proj = projetoDe(G, nomeProj);
  const ctx = contextoPasta(params.pasta);
  const nos = nosDo(G, proj);
  const porSha = new Map(nos.filter((n) => n.tipo === 'commit').map((n) => [n.extra.sha, n]));

  // rótulo "worktree · branch" de cada item
  const rotSessao = (s) => [s.subregiao && s.subregiao !== 'SESSOES' ? s.subregiao : null, s.extra.branch || null].filter(Boolean).join(' · ');
  const rotCommit = (c) => {
    if (ctx && ctx.shas.includes(c.extra.sha)) return [ctx.nome, ctx.branch].filter(Boolean).join(' · ');
    return c.extra.fonteRef || '';
  };
  const rotArquivo = (abs, s) => [base(abs), s ? rotSessao(s) : null].filter(Boolean).join(' · ');

  const sessoesTodas = nos.filter((n) => n.tipo === 'sessao' && !ehAgente(n)).sort((a, b) => b.modificado - a.modificado);
  const commitsTodos = nos.filter((n) => n.tipo === 'commit').sort((a, b) => b.criado - a.criado);
  const doLugar = (s) => ctx && (dentro(s.extra.cwd, ctx.topo || ctx.pasta) || s.subregiao === ctx.nome);
  const sessoesAqui = ctx ? sessoesTodas.filter(doLugar) : [];
  const commitsAqui = ctx ? ctx.shas.map((sh) => porSha.get(sh)).filter(Boolean) : [];
  const ult = sessoesAqui[0] || sessoesTodas[0] || null;
  const ultCommit = commitsAqui[0] || commitsTodos[0] || null;
  const diario = nos.filter(ehDiario).sort((a, b) => b.criado - a.criado);
  const agentes = ult ? nos.filter((n) => ehAgente(n) && n.extra.agente.pai === ult.extra.sessionId).sort((a, b) => b.modificado - a.modificado) : [];
  const referencia = ult ? ult.criado : (ultCommit ? ultCommit.criado : 0);
  const pendencias = diario.filter((n) => RE_PENDENCIA.test(n.texto || '') || (n.tagsAutor || []).some((t) => /pend|todo|fazer/i.test(t))).slice(0, 6);
  const mudadasDesde = referencia ? nos.filter((n) => (n.tipo === 'nota' || n.tipo === 'doc') && !ehDiario(n) && n.modificado >= referencia).sort((a, b) => b.modificado - a.modificado) : [];

  const L = [`# Onde parei · ${proj.nome.toUpperCase()}${ctx ? ` · em ${[ctx.nome, ctx.branch].filter(Boolean).join(' · ')}` : ''}`, ''];
  if (ctx && !sessoesAqui.length && !commitsAqui.length) L.push(`_Nada registrado especificamente em ${ctx.nome}; mostrando o projeto todo._`, '');

  const blocoSessao = (s, titulo) => {
    const e = s.extra;
    const rot = rotSessao(s);
    L.push(`## ${titulo} ${cita(s)}${rot ? ` · ${rot}` : ''}`);
    L.push(`${dataHora(s.criado)} → ${dataHora(s.modificado)} · ${dur(e.duracaoMs || 0)} ativa · ${e.totalFerramentas || 0} ferramentas · ${e.msgsUser || 0} mensagens suas`);
    L.push(`**Assunto:** ${curto(s.titulo, 120)}`);
    const pedidos = (e.prompts || []).filter((p) => p.texto && !/^[<\[]/.test(p.texto)).slice(-3);
    if (pedidos.length) { L.push('', '**Últimos pedidos:**'); for (const p of pedidos) L.push(`- ${curto(p.texto, 160)}`); }
    const arqs = (e.arquivos || []).slice(-12).reverse();
    L.push('', `**Arquivos tocados (${(e.arquivos || []).length}):** ${arqs.length ? arqs.map((a) => rotArquivo(a, s)).join(', ') : 'nenhum'}`);
    const top = Object.entries(e.ferramentas || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ×${v}`).join(' · ');
    if (top) L.push(`**Ferramentas:** ${top}`);
  };

  if (ult) {
    blocoSessao(ult, ctx && sessoesAqui[0] === ult ? `Última sessão em ${ctx.nome}` : 'Última sessão');
    if (agentes.length) { L.push('', `**Agentes dessa sessão (${agentes.length}):**`); for (const a of agentes.slice(0, 6)) L.push(`- ${cita(a)} ${curto(a.titulo, 80)} · ${dur(a.extra.duracaoMs || 0)} · ${a.extra.totalFerramentas || 0} ferramentas`); }
    // a última do projeto todo, se for outra
    if (ctx && sessoesTodas[0] && sessoesTodas[0] !== ult) {
      const o = sessoesTodas[0];
      L.push('', `**No resto do projeto, a última sessão foi** ${cita(o)} ${dataHora(o.criado)}${rotSessao(o) ? ' · ' + rotSessao(o) : ''} · ${curto(o.titulo, 80)}`);
    }
  } else {
    L.push('## Última sessão', '- nenhuma sessão do Claude Code neste projeto');
  }

  L.push('', ctx && commitsAqui.length ? `## Últimos commits em ${[ctx.nome, ctx.branch].filter(Boolean).join(' · ')}` : '## Últimos commits');
  const listaC = (ctx && commitsAqui.length ? commitsAqui : commitsTodos).slice(0, 3);
  if (!listaC.length) L.push('- nenhum');
  for (const c of listaC) { const r = rotCommit(c); L.push(`- ${cita(c)} ${c.hash.slice(0, 7)} ${data(c.criado)} ${curto(c.titulo, 80)} (+${c.extra.mais}/-${c.extra.menos})${r ? ` · ${r}` : ''}`); }
  if (ctx && commitsAqui.length && commitsTodos[0] && !commitsAqui.includes(commitsTodos[0])) {
    const c = commitsTodos[0];
    L.push(`- no resto do projeto: ${cita(c)} ${c.hash.slice(0, 7)} ${data(c.criado)} ${curto(c.titulo, 70)}${rotCommit(c) ? ` · ${rotCommit(c)}` : ''}`);
  }
  if (ult && ultCommit && ultCommit.criado < ult.criado) L.push(`- ⚠ nenhum commit${ctx && commitsAqui.length ? ' nesta branch' : ''} depois da última sessão (${data(ult.criado)}): o trabalho dela pode não estar commitado`);

  L.push('', '## Pendências no diário');
  if (!pendencias.length) L.push(diario.length ? '- nenhuma entrada com "pendente/falta/TODO/próximo passo"' : '- o diário deste projeto está vazio');
  for (const n of pendencias) {
    const linha = (n.texto || '').split(/\r?\n/).find((l) => RE_PENDENCIA.test(l)) || '';
    L.push(`- ${cita(n)} ${data(n.criado)} **${curto(n.titulo, 70)}**${linha ? ' — ' + curto(linha.replace(/^[#\-\s*]+/, ''), 120) : ''}`);
  }
  L.push('', `## Notas mudadas desde então (${mudadasDesde.length})`);
  if (!mudadasDesde.length) L.push('- nenhuma');
  for (const n of mudadasDesde.slice(0, 8)) L.push(`- ${cita(n)} ${dataHora(n.modificado)} ${curto(n.titulo, 70)}`);

  const sess = (s) => item(s, { worktree: s.subregiao, branch: s.extra.branch || null, cwd: s.extra.cwd || null, duracaoMs: s.extra.duracaoMs || 0,
    ferramentas: s.extra.ferramentas || {}, arquivos: (s.extra.arquivos || []).map((a) => ({ caminho: a, rotulo: rotArquivo(a, s) })), prompts: (s.extra.prompts || []).slice(-3).map((p) => p.texto) });
  return {
    markdown: L.join('\n') + '\n',
    dados: {
      projeto: proj.nome,
      pasta: ctx ? { caminho: ctx.pasta, worktree: ctx.nome, branch: ctx.branch, sessoesAqui: sessoesAqui.length, commitsAqui: commitsAqui.length } : null,
      ultimaSessao: ult ? sess(ult) : null,
      ultimaSessaoDoProjeto: ctx && sessoesTodas[0] && sessoesTodas[0] !== ult ? sess(sessoesTodas[0]) : null,
      agentes: agentes.map((a) => item(a, { duracaoMs: a.extra.duracaoMs || 0, ferramentas: a.extra.totalFerramentas || 0 })),
      commits: listaC.map((c) => item(c, { hash: c.hash.slice(0, 7), mais: c.extra.mais, menos: c.extra.menos, rotulo: rotCommit(c) })),
      commitDepoisDaSessao: !!(ult && ultCommit && ultCommit.criado >= ult.criado),
      pendencias: pendencias.map((n) => item(n, { autor: n.autor })),
      mudadasDesde: mudadasDesde.slice(0, 20).map((n) => item(n)),
    },
  };
}

module.exports = { executar };
