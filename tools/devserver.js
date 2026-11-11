// Servidor de DESENVOLVIMENTO da interface. Faz proxy para o servidor real (UPSTREAM) e
// simula os endpoints da V3 (visões, ajustes, projetos, visão atual) enquanto eles não existem lá.
// Quando o servidor real já responde um endpoint V3, o proxy usa a resposta dele.
// Uso: UPSTREAM=http://127.0.0.1:4791 PORT=4790 node tools/devserver.js
const http = require('http'), fs = require('fs'), path = require('path'), { WebSocketServer, WebSocket } = require('ws');
const layout = require('../server/layout.js');
const ROOT = path.join(__dirname, '..'), PORT = +process.env.PORT || 4790, UP = process.env.UPSTREAM || 'http://127.0.0.1:4791';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
const corpo = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
function arquivo(res, p) { fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(b); }); }
function proxy(req, res) {
  const u = new URL(req.url, UP); const r2 = http.request(u, { method: req.method, headers: { ...req.headers, host: u.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  r2.on('error', () => { res.writeHead(502); res.end('upstream'); }); req.pipe(r2);
}
async function up(p, opt) { const r = await fetch(UP + p, opt); return r; }
// ------------------------------------------------------------------ estado simulado
const ESTADO = path.join(__dirname, '.dev-v3.json');
let st = { visoes: [], atual: 'tudo', ajustes: null }; try { st = JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch {}
const salvar = () => fs.writeFileSync(ESTADO, JSON.stringify(st, null, 1));
let cache = null;
async function cheio() { const r = await up('/api/graph'); const g = await r.json(); if (!cache || cache.versao !== g.versao) cache = g; return cache; }
const projDe = n => n.regiao.replace(/^r_/, '');
function visoesPadrao(g) { const ps = [...new Set(g.nos.filter(n => n.tipo !== 'dia').map(projDe))].sort(); return [{ id: 'tudo', nome: 'TUDO' }, ...ps.map(p => ({ id: 'so-' + p, nome: 'SÓ ' + p.toUpperCase(), projetos: [p] }))]; }
function visaoDaQuery(q) {
  if (q.get('visao')) return st.visoes.find(v => v.id === q.get('visao')) || null;
  const v = {}; const lst = k => q.get(k) ? q.get(k).split(',').filter(Boolean) : undefined;
  v.projetos = lst('projetos'); v.fontes = lst('fontes'); v.tipos = lst('tipos'); v.tags = lst('tags');
  if (q.get('desde')) v.desde = +q.get('desde'); if (q.get('ate')) v.ate = +q.get('ate'); if (q.get('grauMin')) v.grauMin = +q.get('grauMin'); if (q.get('texto')) v.texto = q.get('texto'); if (q.get('vizinhos')) v.vizinhos = +q.get('vizinhos');
  for (const k in v) if (v[k] == null) delete v[k]; return Object.keys(v).length ? { id: 'ad-hoc', nome: 'PERSONALIZADA', ...v } : null;
}
function filtrar(g, v) {
  if (!v || v.id === 'tudo') return { ...g, visao: v || null, total: { neuronios: g.nos.length, sinapses: g.sinapses.length } };
  const tx = (v.texto || '').toLowerCase(); const ok = n => {
    if (n.tipo === 'dia') return false;
    if (v.projetos && v.projetos.length && !v.projetos.includes(projDe(n))) return false;
    if (v.fontes && v.fontes.length && !v.fontes.includes(n.fonte)) return false;
    if (v.tipos && v.tipos.length && !v.tipos.includes(n.tipo)) return false;
    if (v.desde && (n.modificado || n.criado) < v.desde) return false; if (v.ate && n.criado > v.ate) return false;
    if (v.tags && v.tags.length && !(n.tags || []).some(t => v.tags.map(x => x.toUpperCase()).includes(String(t).toUpperCase()))) return false;
    if (v.grauMin && n.grau < v.grauMin) return false;
    if (tx && !(n.titulo.toLowerCase().includes(tx) || (n.caminho || '').toLowerCase().includes(tx))) return false; return true; };
  const dentro = new Set(); g.nos.forEach((n, i) => ok(n) && dentro.add(i));
  const fora = new Set(); let borda = new Set(dentro);
  for (let k = 0; k < (v.vizinhos || 0); k++) { const nova = new Set(); for (const x of g.sinapses) for (const [a, b] of [[x.a, x.b], [x.b, x.a]]) if (borda.has(a) && !dentro.has(b) && !fora.has(b) && g.nos[b].tipo !== 'dia') { fora.add(b); nova.add(b); } borda = nova; }
  // dias da espinha que tocam o recorte
  const sel = [...dentro, ...fora]; const diasUsados = new Set(sel.map(i => new Date(g.nos[i].criado).toISOString().slice(0, 10)));
  g.nos.forEach((n, i) => { if (n.tipo === 'dia' && diasUsados.has(n.titulo)) sel.push(i); });
  const mapa = new Map(sel.map((i, k) => [i, k]));
  const um = v.projetos && v.projetos.length === 1;
  const nos = sel.map(i => { const n = { ...g.nos[i], tags: g.nos[i].tags }; if (fora.has(i)) n.fora = true; if (um && n.tipo !== 'dia' && !n.fora) { n.regiao = 'r_' + (n.subregiao || 'raiz').toLowerCase().replace(/[^a-z0-9-]+/g, '-'); n.subregiao = n.tipo; } return n; });
  const sinapses = g.sinapses.filter(s => mapa.has(s.a) && mapa.has(s.b)).map(s => ({ ...s, a: mapa.get(s.a), b: mapa.get(s.b) }));
  const ids = [...new Set(nos.map(n => n.regiao))];
  const info = layout.calcular(nos, ids);
  const deg = new Array(nos.length).fill(0); for (const s of sinapses) { deg[s.a]++; deg[s.b]++; } nos.forEach((n, i) => { n.grau = deg[i]; n.orfao = !deg[i]; });
  const agora = Date.now(), ini7 = agora - 7 * 864e5;
  const regioes = ids.map((id, k) => { const inf = info.get(id) || { centro: [0, 0, 0], hemisferio: 'D' }; const ns = nos.filter(n => n.regiao === id);
    const a7 = [0, 0, 0, 0, 0, 0, 0]; for (const n of ns) { const t = n.modificado || n.criado; if (t >= ini7) a7[Math.min(6, Math.floor((t - ini7) / 864e5))]++; }
    const orig = g.regioes.find(r => r.id === id);
    return { id, nome: orig ? orig.nome : id.slice(2).toUpperCase(), serial: id === 'r_tronco' ? 'RG-0000' : 'VS-' + String(k + 1).padStart(4, '0'), hemisferio: id === 'r_tronco' ? 'TRONCO' : inf.hemisferio, centro: inf.centro, neuronios: ns.length, sinapses: 0, ultimoPulso: Math.max(0, ...ns.map(n => n.modificado || 0)), atividade7d: a7, subregioes: [] }; });
  for (const s of sinapses) { const r = regioes.find(x => x.id === nos[s.a].regiao); if (r) r.sinapses++; }
  const c = g.contadores; const cnt = { ...c, notas: nos.filter(n => n.tipo === 'nota').length, commits: nos.filter(n => n.tipo === 'commit').length, sessoes: nos.filter(n => n.tipo === 'sessao').length, neuronios: nos.length, sinapses: sinapses.length, regioes: regioes.length };
  return { ...g, regioes, nos, sinapses, dias: g.dias.filter(d => diasUsados.has(d)), contadores: cnt, visao: v, total: { neuronios: g.nos.length, sinapses: g.sinapses.length } };
}
function projetos(g) { const m = new Map(); for (const n of g.nos) { if (n.tipo === 'dia') continue; const p = projDe(n); if (!m.has(p)) m.set(p, { nome: p, neuronios: 0, notas: 0, commits: 0, sessoes: 0, ultimoPulso: 0, subregioes: new Set() }); const o = m.get(p); o.neuronios++; if (n.tipo === 'nota') o.notas++; if (n.tipo === 'commit') o.commits++; if (n.tipo === 'sessao') o.sessoes++; o.ultimoPulso = Math.max(o.ultimoPulso, n.modificado || 0); o.subregioes.add(n.subregiao); } return [...m.values()].map(o => ({ ...o, subregioes: [...o.subregioes] })).sort((a, b) => b.neuronios - a.neuronios); }
const AJ_PADRAO = { tema: 'grafite', brilho: 1, tamanhoPonto: 1, orcamentoRotulos: 180, densidadeRotulos: 'normal', mostrarSinapses: true, mostrarTecido: true, mostrarGrade: true, rotacaoAuto: true, paineis: { log: true, status: true, contadores: true, minimapa: true, linhaTempo: true }, coresFonte: {}, som: false, visaoInicial: 'tudo' };
// ------------------------------------------------------------------ http
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  try {
    if (p.startsWith('/api/')) {
      // usa o servidor real quando ele já tem o endpoint V3
      const v3 = p === '/api/visoes' || p.startsWith('/api/visoes/') || p.startsWith('/api/visao/') || p === '/api/projetos' || p === '/api/ajustes';
      if (v3 && process.env.SO_PROXY) return proxy(req, res);
      if (p === '/api/graph') { const g = await cheio(); if (![...u.searchParams.keys()].length) return json(res, { ...g, visao: null, total: { neuronios: g.nos.length, sinapses: g.sinapses.length } }); return json(res, filtrar(g, visaoDaQuery(u.searchParams))); }
      if (p === '/api/projetos') return json(res, { projetos: projetos(await cheio()) });
      if (p === '/api/visoes' && req.method === 'GET') { if (!st.visoes.length) { st.visoes = visoesPadrao(await cheio()); salvar(); } return json(res, { visoes: st.visoes }); }
      if (p === '/api/visoes' && req.method === 'POST') { const v = await corpo(req); if (!v.id) v.id = 'v-' + Date.now().toString(36); st.visoes = st.visoes.filter(x => x.id !== v.id).concat(v); salvar(); return json(res, v); }
      if (p.startsWith('/api/visoes/') && req.method === 'DELETE') { const id = p.split('/')[3]; st.visoes = st.visoes.filter(x => x.id !== id); salvar(); return json(res, { ok: true }); }
      if (p === '/api/visao/atual' && req.method === 'GET') return json(res, { visao: st.visoes.find(v => v.id === st.atual) || { id: 'tudo', nome: 'TUDO' } });
      if (p === '/api/visao/atual' && req.method === 'POST') { const b = await corpo(req); const v = b.id && Object.keys(b).length === 1 ? st.visoes.find(x => x.id === b.id) : b; st.atual = v?.id || 'tudo'; salvar(); const m = JSON.stringify({ tipo: 'visao', visao: v }); wss.clients.forEach(c => c.send(m)); return json(res, { ok: true, visao: v }); }
      if (p === '/api/ajustes' && req.method === 'GET') return json(res, { ...AJ_PADRAO, ...(st.ajustes || {}) });
      if (p === '/api/ajustes' && req.method === 'POST') { st.ajustes = { ...AJ_PADRAO, ...(st.ajustes || {}), ...(await corpo(req)) }; salvar(); return json(res, st.ajustes); }
      return proxy(req, res);
    }
    if (p.startsWith('/vendor/three/')) return arquivo(res, path.join(ROOT, 'node_modules/three', p.slice(14)));
    if (p === '/vendor/marked.esm.js') return arquivo(res, path.join(ROOT, 'node_modules/marked/lib/marked.esm.js'));
    if (p.startsWith('/vendor/fonts/')) return arquivo(res, path.join(ROOT, 'node_modules/@fontsource-variable/martian-mono/files', p.slice(14)));
    arquivo(res, path.join(ROOT, 'web', p === '/' ? 'index.html' : p));
  } catch (e) { json(res, { erro: e.message }, 500); }
});
// WS: repassa as mensagens do servidor real e acrescenta `visao`
const wss = new WebSocketServer({ server: srv, path: '/ws' });
wss.on('connection', ws => { const u = new WebSocket(UP.replace('http', 'ws') + '/ws'); u.on('message', m => ws.readyState === 1 && ws.send(String(m))); u.on('error', () => {}); ws.on('close', () => u.close()); });
srv.listen(PORT, '127.0.0.1', () => console.log('devserver V3 http://127.0.0.1:' + PORT + ' → ' + UP));
