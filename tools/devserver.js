// Servidor de DESENVOLVIMENTO da interface: proxy para o servidor real (UPSTREAM).
// Endpoints que o servidor real ainda não tem (responde 404) são simulados aqui:
// V5 → /api/sync (+ /agora, /exportar, /importar, /maquinas/:id).
// V4 → /api/config, /api/config/chave, /api/config/testar, /api/temas, /api/skills, /api/cache/limpar.
// Uso: UPSTREAM=http://127.0.0.1:4793 PORT=4790 node tools/devserver.js
const http = require('http'), fs = require('fs'), path = require('path'), { WebSocketServer, WebSocket } = require('ws');
const ROOT = path.join(__dirname, '..'), PORT = +process.env.PORT || 4790, UP = process.env.UPSTREAM || 'http://127.0.0.1:4793';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
const lerCorpo = req => new Promise(r => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => r(Buffer.concat(b))); });
function arquivo(res, p) { fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(b); }); }
// ------------------------------------------------------------------ estado simulado (V4)
const ESTADO = process.env.DEV_ESTADO || path.join(require('os').tmpdir(), 'cortex-dev-v4.json');
let st = { config: null, temas: [], skillsInst: {} }; try { st = { ...st, ...JSON.parse(fs.readFileSync(ESTADO, 'utf8')) }; } catch {}
const salvar = () => fs.writeFileSync(ESTADO, JSON.stringify(st, null, 1));
const CFG = { geral: { idioma: 'pt', iniciarComWindows: false, fecharParaBandeja: true, atalhoGlobal: 'Ctrl+Alt+C', porta: 4747 }, organizacao: { regrasLocais: true, claude: false, modelo: 'claude-haiku-5-5', limitePorHora: 60, chave: null }, cerebro: { profundidadePorIdade: 1, espacamentoLobos: 1, velocidadeReplay: 100 }, desempenho: { limiteNeuronios: 20000, fpsMax: 60, qualidadeSinapses: 'alta' }, notificacoes: { diario: true, commit: false }, apelidos: { 'gp-*': 'glass-pets' }, ignorar: ['node_modules', '.obsidian'] };
const cfg = () => st.config || (st.config = JSON.parse(JSON.stringify(CFG)));
const SKILLS = [
  { nome: 'cortex', titulo: 'Córtex', descricao: 'Base: usa o CÓRTEX pelo comando cortex (status, resumo, buscar, mostrar, registrar).', executavel: false, parametros: [] },
  { nome: 'cortex-contexto', titulo: 'Contexto do projeto', descricao: 'Antes de começar a trabalhar num projeto: resumo, últimas sessões, diário e notas centrais.', executavel: true, parametros: [{ nome: 'projeto', tipo: 'projeto' }, { nome: 'dias', tipo: 'numero', padrao: 7 }] },
  { nome: 'cortex-registrar', titulo: 'Registrar no diário', descricao: 'Ao terminar uma tarefa relevante, registra no diário com ligações para notas, commits e sessões.', executavel: false, parametros: [] },
  { nome: 'cortex-onde-parei', titulo: 'Onde parei?', descricao: 'Última sessão do projeto, arquivos tocados, último commit e entradas pendentes do diário.', executavel: true, parametros: [{ nome: 'projeto', tipo: 'projeto' }] },
  { nome: 'cortex-revisao-semanal', titulo: 'Revisão semanal', descricao: 'Revisão da semana de um projeto, gravada no diário.', executavel: true, parametros: [{ nome: 'projeto', tipo: 'projeto' }, { nome: 'gravar', tipo: 'booleano', padrao: false }] },
  { nome: 'cortex-ligacoes', titulo: 'Sugerir ligações', descricao: 'Acha órfãos e notas que se citam sem link e sugere ligações. Nunca edita o cofre.', executavel: true, parametros: [{ nome: 'projeto', tipo: 'projeto' }, { nome: 'limite', tipo: 'numero', padrao: 20 }] },
];
async function simular(req, res, p, corpo) {
  const J = () => { try { return JSON.parse(corpo.toString() || '{}'); } catch { return {}; } };
  if (p === '/api/config' && req.method === 'GET') { const c = cfg(); return json(res, { ...c, organizacao: { ...c.organizacao, chave: c.organizacao.chave }, sobre: { versao: 'dev', dados: path.join(ROOT, 'data'), config: process.env.CORTEX_CONFIG || '', app: ROOT } }); }
  if (p === '/api/config' && req.method === 'POST') { const b = J(); const c = cfg(); for (const k in b) c[k] = typeof b[k] === 'object' && !Array.isArray(b[k]) ? { ...(c[k] || {}), ...b[k] } : b[k]; salvar(); return json(res, { ok: true, reconstruir: !!(b.apelidos || b.ignorar || b.cerebro), avisos: b.cerebro ? ['FORMA DO CÉREBRO MUDOU · RECONSTRUA PARA APLICAR'] : [] }); }
  if (p === '/api/config/chave') { const k = String(J().chave || ''); cfg().organizacao.chave = k ? k.slice(0, 6) + '…' + k.slice(-4) : null; salvar(); return json(res, { ok: true, chave: cfg().organizacao.chave }); }
  if (p === '/api/config/testar') return json(res, { ok: true, mensagem: cfg().organizacao.claude ? 'SIMULADO: CLASSIFICAÇÃO DE TESTE OK' : 'CLAUDE DESLIGADO · REGRAS LOCAIS OK (SIMULADO)' });
  if (p === '/api/cache/limpar') return json(res, { ok: true });
  if (p.startsWith('/api/sync')) {
    const os = require('os'); const sy = st.sync || (st.sync = { ativo: false, pasta: '', maquina: { id: 'a1b2c3d4-dev', nome: os.hostname().toUpperCase() }, compartilhar: { notas: 'conteudo', git: true, sessoes: true, pastas: true, diario: true }, intervaloMin: 2, ultimaPublicacao: null });
    const vista = () => ({ ...sy, sugestoes: [{ rotulo: 'ONEDRIVE', caminho: 'C:\\Users\\jaozin\\OneDrive' }, { rotulo: 'GOOGLE DRIVE', caminho: 'G:\\Meu Drive' }], maquinas: sy.ativo ? [{ id: sy.maquina.id, nome: sy.maquina.nome, eu: true, geradoEm: sy.ultimaPublicacao, neuronios: 0, projetos: [], status: 'OK' }] : [] });
    const b = J();
    if (p === '/api/sync' && req.method === 'GET') return json(res, vista());
    if (p === '/api/sync' && req.method === 'POST') { if (b.nome) sy.maquina.nome = b.nome; for (const k of ['ativo', 'pasta', 'intervaloMin']) if (k in b) sy[k] = b[k]; if (b.compartilhar) sy.compartilhar = { ...sy.compartilhar, ...b.compartilhar }; if (sy.ativo && !sy.ultimaPublicacao) sy.ultimaPublicacao = Date.now(); salvar(); return json(res, vista()); }
    if (p === '/api/sync/agora') { sy.ultimaPublicacao = Date.now(); salvar(); return json(res, vista()); }
    if (p === '/api/sync/exportar') return json(res, { ok: true, caminho: b.caminho, bytes: 123456 });
    if (p === '/api/sync/importar') return json(res, { erro: 'simulado: arquivo não encontrado' }, 400);
    if (p.startsWith('/api/sync/maquinas/')) return json(res, { ok: true });
  }
  if (p === '/api/temas' && req.method === 'GET') return json(res, { temas: st.temas });
  if (p === '/api/temas' && req.method === 'POST') { const t = J(); st.temas = st.temas.filter(x => x.id !== t.id).concat(t); salvar(); return json(res, t); }
  if (p.startsWith('/api/temas/') && req.method === 'DELETE') { const id = decodeURIComponent(p.split('/')[3]); st.temas = st.temas.filter(x => x.id !== id); salvar(); return json(res, { ok: true }); }
  if (p === '/api/skills') return json(res, SKILLS.map(s => { const v = st.skillsInst[s.nome]; return { ...s, instalada: !!v, versaoInstalada: v || null, versaoApp: '4.0.0', caminho: 'C:\\Users\\jaozin\\.claude\\skills\\' + s.nome }; }));
  const m = p.match(/^\/api\/skills\/([^/]+)\/(instalar|remover|executar|skill\.md)$/);
  if (m) { const nome = decodeURIComponent(m[1]); const s = SKILLS.find(x => x.nome === nome); if (!s) return json(res, { erro: 'skill não encontrada' }, 404);
    if (m[2] === 'instalar') { st.skillsInst[nome] = '4.0.0'; salvar(); return json(res, { ok: true }); }
    if (m[2] === 'remover') { delete st.skillsInst[nome]; salvar(); return json(res, { ok: true }); }
    if (m[2] === 'skill.md') { const f = [path.join(ROOT, 'skills', nome, 'SKILL.md'), path.join(ROOT, 'skill', nome, 'SKILL.md')].find(x => fs.existsSync(x)); res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); return res.end(f ? fs.readFileSync(f, 'utf8') : `---\nname: ${nome}\ndescription: ${s.descricao}\n---\n\n# ${s.titulo}\n\n(SKILL.md simulado pelo devserver)`); }
    const b = J(); const r = await fetch(UP + '/api/resumo?projeto=' + encodeURIComponent(b.projeto || '') + '&dias=' + (b.dias || 7)); const t = await r.text();
    return json(res, { markdown: `## ${s.titulo} · ${b.projeto}\n\n_(simulado pelo devserver a partir de /api/resumo)_\n\n` + t, dados: {}, registradoEm: b.gravar ? { caminho: 'diario/' + b.projeto + '/revisao.md' } : undefined }); }
  return null;
}
const V4 = p => /^\/api\/(config|temas|skills|cache|sync)(\/|$)/.test(p);
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  try {
    if (p.startsWith('/api/')) {
      const corpo = ['GET', 'HEAD'].includes(req.method) ? null : await lerCorpo(req);
      const r = await fetch(UP + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: corpo });
      if (r.status === 404 && V4(p)) { const feito = await simular(req, res, p, corpo || Buffer.alloc(0)); if (feito !== null) return; }
      const b = Buffer.from(await r.arrayBuffer()); res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }); return res.end(b);
    }
    if (p.startsWith('/vendor/three/')) return arquivo(res, path.join(ROOT, 'node_modules/three', p.slice(14)));
    if (p === '/vendor/marked.esm.js') return arquivo(res, path.join(ROOT, 'node_modules/marked/lib/marked.esm.js'));
    if (p.startsWith('/vendor/fonts/')) return arquivo(res, path.join(ROOT, 'node_modules/@fontsource-variable/martian-mono/files', p.slice(14)));
    arquivo(res, path.join(ROOT, 'web', p === '/' ? 'index.html' : p));
  } catch (e) { json(res, { erro: e.message }, 502); }
});
const wss = new WebSocketServer({ server: srv, path: '/ws' });
wss.on('connection', ws => { const u = new WebSocket(UP.replace('http', 'ws') + '/ws'); u.on('message', m => ws.readyState === 1 && ws.send(String(m))); u.on('error', () => {}); ws.on('close', () => u.close()); });
srv.listen(PORT, '127.0.0.1', () => console.log('devserver http://127.0.0.1:' + PORT + ' → ' + UP));
