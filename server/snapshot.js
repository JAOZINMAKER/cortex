'use strict';
// Resumo do grafo sem subir o servidor: `npm run snapshot` (respeita CORTEX_CONFIG).
const config = require('./config');
const graph = require('./graph');
const { existe } = require('./util');
const leitores = {
  obsidian: require('./sources/obsidian'), git: require('./sources/git'),
  claude: require('./sources/claude'), pasta: require('./sources/folder'),
};

(async () => {
  const cfg = config.carregar();
  const t0 = Date.now();
  const parciais = [];
  const status = [];
  for (const f of cfg.fontes) {
    const t = Date.now();
    if (!f.ativo || !existe(f.caminho)) { status.push({ ...f, status: 'AUSENTE', itens: 0 }); console.log(`AUSENTE  ${f.tipo.padEnd(8)} ${f.caminho}`); continue; }
    try {
      const r = await leitores[f.tipo].ler(f);
      parciais.push({ fonte: f, r });
      status.push({ id: f.id, tipo: f.tipo, caminho: f.caminho, projeto: f.projeto, status: 'OK', itens: r.itens });
      console.log(`OK       ${f.tipo.padEnd(8)} ${String(r.nos.length).padStart(6)} nós  ${String(r.links.length).padStart(6)} ligações  ${Date.now() - t} ms  ${f.caminho}`);
    } catch (e) {
      status.push({ id: f.id, tipo: f.tipo, caminho: f.caminho, status: 'ERRO', itens: 0, erro: e.message });
      console.log(`ERRO     ${f.tipo.padEnd(8)} ${e.message}`);
    }
  }
  const tL = Date.now() - t0;
  const g = graph.montar(parciais, status);
  const c = g.publico.contadores;
  console.log('\nCONTADORES', JSON.stringify(c));
  console.log('\nREGIÕES');
  for (const r of g.publico.regioes) console.log(`  ${r.serial} ${r.nome.padEnd(24)} ${r.hemisferio.padEnd(6)} ${String(r.neuronios).padStart(6)} neur ${String(r.sinapses).padStart(6)} sin  7d=[${r.atividade7d.join(',')}]  subs=${r.subregioes.length}`);
  const tipos = {};
  for (const n of g.publico.nos) tipos[n.tipo] = (tipos[n.tipo] || 0) + 1;
  const stipos = {};
  for (const s of g.publico.sinapses) stipos[s.tipo] = (stipos[s.tipo] || 0) + 1;
  console.log('\nNÓS POR TIPO', JSON.stringify(tipos));
  console.log('SINAPSES POR TIPO', JSON.stringify(stipos));
  console.log(`ÓRFÃOS ${g.publico.nos.filter((n) => n.orfao).length} · CLUSTERS ${new Set(g.publico.nos.map((n) => n.cluster)).size} · DIAS ${g.publico.dias.length}`);
  console.log(`\nleitura ${tL} ms · montagem ${g.interno.msBuild} ms · total ${Date.now() - t0} ms · JSON ${(JSON.stringify(g.publico).length / 1048576).toFixed(1)} MB`);
  process.exit(0);
})();
