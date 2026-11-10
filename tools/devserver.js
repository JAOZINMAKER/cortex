// Servidor de DESENVOLVIMENTO da interface (só para testar web/ sem o servidor real).
// Usa tools/.fixture.json (gerado por tools/fixture.js a partir de arquivos reais).
const http = require('http'), fs = require('fs'), path = require('path'), { WebSocketServer } = require('ws');
const ROOT = path.join(__dirname, '..'), PORT = +process.env.PORT || 4790;
const { grafo, conteudo } = JSON.parse(fs.readFileSync(path.join(__dirname, '.fixture.json'), 'utf8'));
const byId = new Map(grafo.nos.map((n, i) => [n.id, i]));
const adj = grafo.nos.map(() => []); grafo.sinapses.forEach((s, k) => { adj[s.a].push([s.b, k, 'out']); adj[s.b].push([s.a, k, 'in']); });
const graphJson = JSON.stringify(grafo);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
function file(res, p) { fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  if (p === '/api/graph') return json(res, graphJson);
  if (p.startsWith('/api/no/')) {
    const i = byId.get(p.split('/')[3]); if (i == null) { res.writeHead(404); return res.end(); }
    if (req.method === 'POST') return json(res, { ok: true });
    const n = grafo.nos[i]; const T = x => ({ id: grafo.nos[x[0]].id, titulo: grafo.nos[x[0]].titulo, tipo: grafo.sinapses[x[1]].tipo, peso: grafo.sinapses[x[1]].peso });
    const viz = adj[i].map(x => ({ id: grafo.nos[x[0]].id, titulo: grafo.nos[x[0]].titulo, forca: grafo.sinapses[x[1]].peso })).sort((a, b) => b.forca - a.forca).slice(0, 12);
    const fm = n.tipo === 'nota' ? 'markdown' : n.tipo === 'commit' ? 'commit' : n.tipo === 'sessao' ? 'sessao' : 'texto';
    return json(res, { no: n, entrada: adj[i].filter(x => x[2] === 'in').slice(0, 60).map(T), saida: adj[i].filter(x => x[2] === 'out').slice(0, 60).map(T), vizinhos: viz,
      historico: [{ t: n.criado, evento: 'CRIADO', hash: n.hash }, { t: n.modificado, evento: 'MODIFICADO', hash: n.hash }],
      conteudo: { formato: fm, corpo: conteudo[n.id] || '', extra: fm === 'commit' ? { arquivos: adj[i].filter(x => grafo.sinapses[x[1]].tipo === 'TOCA').map(x => ({ caminho: grafo.nos[x[0]].titulo, mais: 12, menos: 3 })) } : fm === 'sessao' ? { ferramentas: { Bash: 12, Read: 30, Edit: 9 }, arquivos: ['web/index.html'] } : null },
      maquina: { tags: n.tags, regiao: n.regiao, cluster: n.cluster, por: 'regras', em: Date.now() }, correcao: null });
  }
  if (p === '/api/busca') { const q = (u.searchParams.get('q') || '').toLowerCase(); const r = []; for (const n of grafo.nos) { if (r.length >= 50) break; if (n.titulo.toLowerCase().includes(q)) r.push({ id: n.id, titulo: n.titulo, tipo: n.tipo, fonte: n.fonte, regiao: n.regiao, trecho: (conteudo[n.id] || '').slice(0, 120) }); } return json(res, { resultados: r }); }
  if (p === '/api/fontes') return json(res, grafo.fontes);
  if (p.startsWith('/api/fontes') || p === '/api/reconstruir') return json(res, { ok: true });
  if (p === '/api/maquina') return json(res, maquina(true));
  if (p.startsWith('/vendor/three/')) return file(res, path.join(ROOT, 'node_modules/three', p.slice(14)));
  if (p === '/vendor/marked.esm.js') return file(res, path.join(ROOT, 'node_modules/marked/lib/marked.esm.js'));
  if (p.startsWith('/vendor/fonts/')) return file(res, path.join(ROOT, 'node_modules/@fontsource-variable/martian-mono/files', p.slice(14)));
  file(res, path.join(ROOT, 'web', p === '/' ? 'index.html' : p));
});
const commits = grafo.nos.filter(n => n.tipo === 'commit').slice(0, 300);
function maquina(t) { const s = grafo.nos.filter(n => n.tipo === 'sessao'); return { ativos: s.slice(0, 3).map(n => ({ id: n.id, titulo: n.titulo, projeto: n.subregiao, inicio: n.criado, ultimo: n.modificado, ferramentas: 42, arquivos: 7 })), arquivosPorMinuto: Array.from({ length: 60 }, (_, i) => Math.round(Math.abs(Math.sin(i * .37)) * 9)), fila: 3, telemetria: t ? commits.slice(0, 200).map(c => ({ t: c.criado, nivel: 'HIST', fonte: 'git', msg: c.titulo, id: c.id, hash: c.hash })) : undefined }; }
const wss = new WebSocketServer({ server: srv, path: '/ws' });
wss.on('connection', ws => { ws.send(JSON.stringify({ tipo: 'ola', versao: grafo.versao }));
  commits.slice(0, 60).reverse().forEach(c => ws.send(JSON.stringify({ tipo: 'evento', t: c.criado, nivel: 'HIST', fonte: 'git', msg: 'COMMIT ' + c.titulo, id: c.id, hash: c.hash }))); });
let k = 0; const notas = grafo.nos.filter(n => n.tipo === 'nota');
setInterval(() => { const n = notas[(k++ * 7919) % notas.length]; const m = JSON.stringify({ tipo: 'evento', t: Date.now(), nivel: k % 9 ? 'PULSO' : 'ALERTA', fonte: n.fonte, msg: 'INDEXADO ' + n.titulo, id: n.id, hash: n.hash }); wss.clients.forEach(c => c.send(m)); }, 700);
setInterval(() => { const mu = process.memoryUsage(); const m = JSON.stringify({ tipo: 'status', cpu: 3.2 + Math.random(), memMB: Math.round(mu.rss / 1048576), fila: 2, uptime: process.uptime(), eventosSeg: 1.4 }); wss.clients.forEach(c => c.send(m)); }, 1000);
setInterval(() => { const m = JSON.stringify({ tipo: 'maquina', ...maquina(false) }); wss.clients.forEach(c => c.send(m)); }, 2000);
srv.listen(PORT, '127.0.0.1', () => console.log('devserver http://127.0.0.1:' + PORT));
