'use strict';
// Resumo em markdown (≤ ~4 KB) para outra IA ler antes de trabalhar: GET /api/resumo?projeto=&dias=
const { slug, dayKey } = require('./util');

const LIMITE = 4000;
const data = (t) => dayKey(t); // data local

const dataHora = (t) => { const d = new Date(t); return `${dayKey(t)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const curto = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const dur = (ms) => (ms >= 3600000 ? (ms / 3600000).toFixed(1) + ' h' : Math.round(ms / 60000) + ' min');
const base = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || '';

function gerar(G, { projeto, dias = 7 } = {}) {
  const I = G.interno;
  const desde = Date.now() - dias * 864e5;
  const chave = projeto ? slug(projeto) : null;
  const nomeDe = (k) => I.nomeProj.get(k) || k;
  if (chave && !I.nos.some((n) => n.projeto === chave)) {
    const conhecidos = [...new Set(I.nos.filter((n) => n.tipo !== 'dia').map((n) => nomeDe(n.projeto)))].join(', ');
    return `# CÓRTEX · projeto "${projeto}" não encontrado\n\nProjetos conhecidos: ${conhecidos || 'nenhum'}.\n`;
  }
  const nos = I.nos.filter((n) => n.tipo !== 'dia' && (!chave || n.projeto === chave));
  const L = [];
  L.push(`# CÓRTEX · ${chave ? nomeDe(chave).toUpperCase() : 'VISÃO GERAL'} · últimos ${dias} dias`);
  L.push(`gerado ${dataHora(Date.now())} (hora local) · grafo v${G.publico.versao}`);
  L.push('');

  const c = { notas: 0, commits: 0, linhas: 0, sessoes: 0, ms: 0, ferramentas: 0, recentes: 0 };
  for (const n of nos) {
    if (n.tipo === 'nota') c.notas++;
    else if (n.tipo === 'commit') { c.commits++; c.linhas += n.palavras || 0; }
    else if (n.tipo === 'sessao') { if (!n.extra.agente) c.sessoes++; c.ms += n.extra.duracaoMs || 0; c.ferramentas += n.extra.totalFerramentas || 0; }
    if (n.modificado >= desde) c.recentes++;
  }
  L.push(`**Totais:** ${nos.length} neurônios · ${c.notas} notas · ${c.commits} commits (${c.linhas} linhas) · ${c.sessoes} sessões · ${(c.ms / 36e5).toFixed(1)} h de IA · ${c.ferramentas} ferramentas · ${c.recentes} mudaram no período`);
  L.push('');

  if (!chave) {
    const porProj = new Map();
    for (const n of nos) {
      const p = porProj.get(n.projeto) || { n: 0, ult: 0, rec: 0 };
      p.n++; if (n.modificado > p.ult) p.ult = n.modificado; if (n.modificado >= desde) p.rec++;
      porProj.set(n.projeto, p);
    }
    L.push('## Projetos');
    for (const [k, p] of [...porProj.entries()].sort((a, b) => b[1].ult - a[1].ult).slice(0, 12)) {
      L.push(`- ${nomeDe(k)}: ${p.n} neurônios, ${p.rec} mudaram no período, último pulso ${data(p.ult)}`);
    }
    L.push('');
  }

  const recentes = (tipo, filtro = () => true) => nos.filter((n) => n.tipo === tipo && filtro(n) && n.modificado >= desde).sort((a, b) => b.modificado - a.modificado);
  const commits = recentes('commit');
  L.push(`## Últimos commits (${commits.length} no período)`);
  if (!commits.length) L.push('- nenhum');
  for (const n of commits.slice(0, 8)) L.push(`- \`${n.hash.slice(0, 7)}\` ${data(n.criado)} ${curto(n.titulo, 90)} (+${n.extra.mais}/-${n.extra.menos})`);
  L.push('');

  const sessoes = recentes('sessao', (n) => !n.extra.agente);
  L.push(`## Últimas sessões do Claude Code (${sessoes.length} no período)`);
  if (!sessoes.length) L.push('- nenhuma');
  for (const n of sessoes.slice(0, 6)) {
    const arqs = (n.extra.arquivos || []).slice(-4).map(base).join(', ');
    const pasta = n.subregiao && n.subregiao !== 'SESSOES' ? ` [${n.subregiao}]` : '';
    L.push(`- ${data(n.criado)}${pasta} · ${dur(n.extra.duracaoMs || 0)} · ${n.extra.totalFerramentas || 0} ferramentas · ${curto(n.titulo, 70)}${arqs ? ` · arquivos: ${arqs}` : ''}`);
  }
  L.push('');

  const diario = nos.filter((n) => n.tipo === 'nota' && n.extra && n.extra.diario).sort((a, b) => b.criado - a.criado);
  if (diario.length) {
    L.push('## Diário');
    for (const n of diario.slice(0, 6)) L.push(`- ${data(n.criado)} · ${curto(n.titulo, 80)} · ${n.autor} · id \`${n.id}\``);
    L.push('');
  }

  const notas = nos.filter((n) => n.tipo === 'nota' && !(n.extra && n.extra.diario));
  if (notas.length) {
    L.push('## Notas mais conectadas');
    for (const n of notas.slice().sort((a, b) => b.grau - a.grau).slice(0, 8)) L.push(`- ${curto(n.titulo, 60)} (grau ${n.grau}) · id \`${n.id}\``);
    L.push('');
    const mudadas = notas.filter((n) => n.modificado >= desde).sort((a, b) => b.modificado - a.modificado);
    L.push(`## Notas mudadas no período (${mudadas.length})`);
    if (!mudadas.length) L.push('- nenhuma');
    for (const n of mudadas.slice(0, 8)) L.push(`- ${data(n.modificado)} ${curto(n.titulo, 70)}`);
    L.push('');
  }

  const orfaos = nos.filter((n) => n.orfao && n.tipo === 'nota');
  if (orfaos.length) {
    L.push(`## Notas órfãs (${orfaos.length})`);
    L.push(orfaos.slice(0, 6).map((n) => curto(n.titulo, 40)).join(' · '));
    L.push('');
  }

  let txt = L.join('\n');
  if (Buffer.byteLength(txt) > LIMITE) {
    while (Buffer.byteLength(txt) > LIMITE - 40) txt = txt.slice(0, txt.lastIndexOf('\n'));
    txt += '\n\n…(resumo cortado em ~4 KB)\n';
  }
  return txt;
}

module.exports = { gerar };
