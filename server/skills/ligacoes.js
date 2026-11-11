'use strict';
// Sugestões de ligação: notas órfãs e notas que citam o título de outra sem [[link]].
// Só sugere: nunca edita o cofre. Com gravar=true, a sugestão vira uma entrada no diário.
const { data, curto, ehDiario, cita, projetoDe, nosDo } = require('./comum');

const MAX_PALAVRAS_TITULO = 6;
const RE_PALAVRA = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const normal = (s) => String(s).toLowerCase().normalize('NFC');

async function executar(G, params = {}, ctx = {}) {
  const proj = projetoDe(G, params.projeto, { opcional: true });
  const limite = Math.max(1, Math.min(500, parseInt(params.limite, 10) || 40));
  const I = G.interno;
  const notas = nosDo(G, proj).filter((n) => n.tipo === 'nota' && !ehDiario(n));
  const idx = new Map(I.nos.map((n, i) => [n.id, i]));

  // títulos (e aliases) → nota; títulos repetidos em notas diferentes são ambíguos e ficam de fora
  const porTitulo = new Map();
  const ambiguos = new Set();
  const registrar = (t, n) => {
    const palavras = normal(t).match(RE_PALAVRA) || [];
    if (!palavras.length || palavras.length > MAX_PALAVRAS_TITULO) return;
    const k = palavras.join(' ');
    if (k.length < 4 || /^[\d\s-]+$/.test(k)) return; // curto demais ou só data/número
    if (porTitulo.has(k) && porTitulo.get(k) !== n) { ambiguos.add(k); return; }
    porTitulo.set(k, n);
  };
  for (const n of notas) { registrar(n.titulo, n); for (const a of (n.extra && n.extra.aliases) || []) registrar(a, n); }
  for (const k of ambiguos) porTitulo.delete(k);

  // pares já ligados (qualquer sinapse que não seja de dia)
  const ligados = new Set();
  for (const s of G.publico.sinapses) if (s.tipo !== 'DIA') { ligados.add(s.a + ':' + s.b); ligados.add(s.b + ':' + s.a); }

  const sugestoes = new Map(); // "de>para" -> { de, para, vezes, trecho }
  for (const n of notas) {
    const texto = n.texto || '';
    const toks = [];
    RE_PALAVRA.lastIndex = 0;
    let m;
    while ((m = RE_PALAVRA.exec(texto))) toks.push({ w: normal(m[0]), orig: m[0], i: m.index });
    // trechos já dentro de [[...]] não contam
    const dentroLink = [];
    const reL = /\[\[[^\]]*\]\]/g;
    while ((m = reL.exec(texto))) dentroLink.push([m.index, m.index + m[0].length]);
    const emLink = (pos) => dentroLink.some(([a, b]) => pos >= a && pos < b);
    const iN = idx.get(n.id);
    for (let i = 0; i < toks.length; i++) {
      let chave = '';
      for (let k = 0; k < MAX_PALAVRAS_TITULO && i + k < toks.length; k++) {
        chave = k ? chave + ' ' + toks[i + k].w : toks[i].w;
        const alvo = porTitulo.get(chave);
        if (!alvo || alvo === n) continue;
        if (k === 0 && !/^\p{Lu}/u.test(toks[i].orig) && !/[\d_-]/.test(chave)) continue; // palavra solta: só se vier com maiúscula
        if (emLink(toks[i].i)) continue;
        const iA = idx.get(alvo.id);
        if (ligados.has(iN + ':' + iA)) continue;
        const key = n.id + '>' + alvo.id;
        const s = sugestoes.get(key) || { de: n, para: alvo, vezes: 0, trecho: '', citado: toks.slice(i, i + k + 1).map((t) => t.orig).join(' ') };
        s.vezes++;
        if (!s.trecho) s.trecho = texto.slice(Math.max(0, toks[i].i - 40), toks[i].i + chave.length + 50).replace(/\s+/g, ' ');
        sugestoes.set(key, s);
      }
    }
  }
  const lista = [...sugestoes.values()].sort((a, b) => b.vezes - a.vezes || b.para.grau - a.para.grau);
  const orfaos = notas.filter((n) => n.orfao).sort((a, b) => b.modificado - a.modificado);
  // órfãos que são citados por alguém: a sugestão resolve a orfandade
  const citados = new Set(lista.map((s) => s.para.id).concat(lista.map((s) => s.de.id)));

  const nome = proj ? proj.nome : 'todos os projetos';
  const L = [`# Ligações sugeridas · ${nome.toUpperCase()}`, ''];
  L.push(`${notas.length} notas analisadas (primeiros 4000 caracteres de cada) · ${lista.length} citações sem link · ${orfaos.length} órfãs. Nada foi alterado no cofre.`);
  L.push('', `## Citam o título de outra nota sem [[link]] (${Math.min(limite, lista.length)} de ${lista.length})`);
  if (!lista.length) L.push('- nenhuma');
  for (const s of lista.slice(0, limite)) L.push(`- ${cita(s.de)} **${curto(s.de.titulo, 50)}** cita "${curto(s.citado, 50)}" ${s.vezes > 1 ? `${s.vezes}× ` : ''}→ sugerir [[${s.para.titulo}]] ${cita(s.para)}  · …${curto(s.trecho, 90)}…`);
  L.push('', `## Notas órfãs (${Math.min(limite, orfaos.length)} de ${orfaos.length})`);
  if (!orfaos.length) L.push('- nenhuma');
  for (const n of orfaos.slice(0, limite)) L.push(`- ${cita(n)} ${curto(n.titulo, 70)} · ${data(n.modificado)}${citados.has(n.id) ? ' · aparece nas sugestões acima' : ''}`);

  const markdown = L.join('\n') + '\n';
  const dados = {
    projeto: proj ? proj.nome : null, analisadas: notas.length, totalSugestoes: lista.length, totalOrfaos: orfaos.length,
    sugestoes: lista.slice(0, limite).map((s) => ({ de: { id: s.de.id, idCurto: s.de.idCurto, titulo: s.de.titulo }, para: { id: s.para.id, idCurto: s.para.idCurto, titulo: s.para.titulo }, vezes: s.vezes, citado: s.citado, trecho: s.trecho })),
    orfaos: orfaos.slice(0, limite).map((n) => ({ id: n.id, idCurto: n.idCurto, titulo: n.titulo, modificado: Math.round(n.modificado) })),
  };
  let registradoEm;
  if (params.gravar && ctx.registrar && !lista.length && !orfaos.length) dados.gravado = false; // nada a sugerir: não suja o diário
  else if (params.gravar && ctx.registrar) {
    if (!proj) { const e = new Error('para gravar no diário, informe o projeto'); e.status = 400; throw e; }
    const ligar = [...new Set(lista.slice(0, 15).flatMap((s) => [s.de.id, s.para.id]).concat(orfaos.slice(0, 5).map((n) => n.id)))].slice(0, 30);
    registradoEm = await ctx.registrar({ projeto: proj.nome, titulo: `Sugestões de ligação ${data(Date.now())}`, texto: L.slice(2).join('\n'), tags: ['ligacoes', 'sugestao'], autor: 'CÓRTEX (ligações)', ligar });
  }
  return { markdown, dados, registradoEm };
}

module.exports = { executar };
