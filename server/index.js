'use strict';
/*
 * CÓRTEX — servidor local (HTTP + WebSocket em 127.0.0.1).
 * Segue CONTRATO.md. Notas de implementação (não são desvios do formato):
 *  - Nós "arquivo" (arquivos tocados no git) ficam no CEREBELO; o resto dos neurônios do projeto fica no córtex.
 *  - No.cluster = -1 para nós sem nenhuma ligação (fora de qualquer comunidade).
 *  - Fontes "pasta" aceitam o campo opcional "ignorar": [subpastas relativas].
 *  - Subagentes do Claude Code (<sessão>/subagents/agent-*.jsonl) também viram nós tipo "sessao",
 *    com autor "AGENTE <TIPO>", ligados à sessão-mãe por SEQ; não contam em contadores.sessoes.
 *  - `node server/index.js --abrir` abre o navegador depois de subir (usado pelo abrir-cortex.bat).
 *  - A mensagem WS `grafo` só é enviada quando a estrutura muda (nós ou sinapses); mudanças só de
 *    metadados chegam como `evento` e já estão em /api/graph na próxima busca.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const config = require('./config');
const telemetry = require('./telemetry');
const classify = require('./classify');
const graph = require('./graph');
const watch = require('./watch');
const { sha1, normPath, baseName, existe, ehTexto, dayKey } = require('./util');
const fontes = {
  obsidian: require('./sources/obsidian'),
  git: require('./sources/git'),
  claude: require('./sources/claude'),
  pasta: require('./sources/folder'),
};

const ROOT = config.ROOT;
const cfg = config.carregar();
const PORTA = parseInt(process.env.PORT, 10) || cfg.porta || 4747;

// ---------------------------------------------------------------- estado
const parciais = new Map(); // fonteId -> { fonte, r, status, itens, erro, maxT }
let G = null; // { publico, interno }
let versao = 0;
let assinatura = '';
let cacheJson = null; // { versao, buf, gz }
let filaReconstrucao = 0;
let pronto = false;

telemetry.definirFila(() => filaReconstrucao + classify.tamanhoFila());

function log(...a) { console.log('[CÓRTEX]', ...a); }

function statusFontes() {
  return config.get().fontes.map((f) => {
    const p = parciais.get(f.id);
    const o = { id: f.id, tipo: f.tipo, caminho: f.caminho, projeto: f.projeto || null, status: p ? p.status : 'LENDO', itens: p ? p.itens : 0 };
    if (p && p.erro) o.erro = p.erro;
    if (f.ativo === false) o.status = 'AUSENTE';
    return o;
  });
}

function grafoVazio() {
  return { versao: 0, geradoEm: Date.now(), regioes: [], nos: [], sinapses: [], dias: [],
    contadores: { notas: 0, commits: 0, linhas: 0, sessoes: 0, horasIA: 0, neuronios: 0, sinapses: 0, arquivos: 0, regioes: 0, ferramentas: 0 },
    fontes: statusFontes() };
}

async function lerFonte(fonte) {
  const ant = parciais.get(fonte.id);
  const reg = { fonte, r: ant ? ant.r : null, status: 'LENDO', itens: ant ? ant.itens : 0, maxT: ant ? ant.maxT : 0 };
  parciais.set(fonte.id, reg);
  if (!fonte.ativo || !existe(fonte.caminho)) {
    reg.status = 'AUSENTE'; reg.r = null; reg.itens = 0;
    telemetry.emitir({ nivel: 'ALERTA', fonte: fonte.tipo, msg: `FONTE AUSENTE ${fonte.tipo.toUpperCase()} ${fonte.caminho}` });
    return reg;
  }
  const t0 = Date.now();
  telemetry.emitir({ nivel: 'INFO', fonte: fonte.tipo, msg: `LENDO ${fonte.tipo.toUpperCase()} ${fonte.caminho}` });
  try {
    const r = await fontes[fonte.tipo].ler(fonte);
    reg.r = r; reg.status = 'OK'; reg.itens = r.itens; delete reg.erro;
    telemetry.emitir({ nivel: 'INFO', fonte: fonte.tipo, msg: `${fonte.tipo.toUpperCase()} OK · ${r.nos.length} NÓS · ${r.links.length} LIGAÇÕES · ${Date.now() - t0} MS` });
  } catch (e) {
    reg.status = 'ERRO'; reg.erro = String(e.message || e).slice(0, 300); reg.r = null;
    telemetry.emitir({ nivel: 'ALERTA', fonte: fonte.tipo, msg: `ERRO ${fonte.tipo.toUpperCase()} ${reg.erro}` });
  }
  return reg;
}

function assinaturaDe(pub) {
  const h = require('crypto').createHash('sha1');
  for (const n of pub.nos) h.update(n.id);
  h.update(':' + pub.sinapses.length);
  for (const s of pub.sinapses) h.update(s.a + ',' + s.b + s.tipo);
  return h.digest('hex');
}

function montarGrafo(motivo) {
  const lista = config.get().fontes.map((f) => parciais.get(f.id)).filter(Boolean).map((p) => ({ fonte: p.fonte, r: p.r }));
  const anterior = G;
  const novo = graph.montar(lista, statusFontes());
  const ass = assinaturaDe(novo.publico);
  const estruturaMudou = ass !== assinatura;
  versao++;
  novo.publico.versao = versao;
  G = novo;
  assinatura = ass;
  cacheJson = null;
  const c = novo.publico.contadores;
  log(`grafo v${versao} (${motivo}) · ${c.neuronios} neurônios · ${c.sinapses} sinapses · ${novo.interno.msBuild} ms`);
  telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `GRAFO V${versao} · ${c.neuronios} NEURÔNIOS · ${c.sinapses} SINAPSES · ${novo.interno.msBuild} MS` });
  if (anterior) diffEventos(anterior, novo);
  if (estruturaMudou) broadcast({ tipo: 'grafo', versao });
  return estruturaMudou;
}

// eventos de neurônios novos/alterados entre duas versões (notas, docs, arquivos)
function diffEventos(a, b) {
  const velhos = new Map(a.interno.nos.map((n) => [n.id, n]));
  let n = 0;
  for (const no of b.interno.nos) {
    if (no.tipo === 'dia' || no.tipo === 'commit' || no.tipo === 'sessao') continue;
    const v = velhos.get(no.id);
    if (!v) { if (n++ < 60) telemetry.emitir({ nivel: 'PULSO', fonte: no.fonte, msg: `NASCEU ${no.tipo.toUpperCase()} ${no.idCurto} ${no.titulo}`.slice(0, 160), id: no.id, hash: no.hash }); }
    else if (v.hash !== no.hash || v.modificado !== no.modificado) { if (n++ < 60) telemetry.emitir({ nivel: 'PULSO', fonte: no.fonte, msg: `MUDOU ${no.tipo.toUpperCase()} ${no.idCurto} ${no.titulo}`.slice(0, 160), id: no.id, hash: no.hash }); }
  }
  const novos = new Set(b.interno.nos.map((x) => x.id));
  let m = 0;
  for (const [id, v] of velhos) if (!novos.has(id) && v.tipo !== 'dia' && m++ < 30) telemetry.emitir({ nivel: 'ALERTA', fonte: v.fonte, msg: `REMOVIDO ${v.tipo.toUpperCase()} ${v.idCurto} ${v.titulo}`.slice(0, 160) });
}

// eventos históricos novos de uma fonte (commits novos, tool_use novos)
function eventosNovos(reg) {
  if (!reg.r || !G) return;
  const lim = reg.maxT || 0;
  let max = lim;
  const novos = [];
  for (const e of reg.r.eventos) { if (e.t > lim) novos.push(e); if (e.t > max) max = e.t; }
  reg.maxT = max;
  if (!lim) return;
  novos.sort((a, b) => a.t - b.t);
  for (const e of novos.slice(-60)) {
    const i = e.chave ? G.interno.porId.get(graph.idDe(e.chave)) : undefined;
    telemetry.emitir({ nivel: 'PULSO', fonte: e.fonte, msg: e.msg, id: i !== undefined ? G.interno.nos[i].id : undefined, hash: e.hash });
    if (e.arquivo) telemetry.tocouArquivo(e.t);
  }
}

async function construirTudo(motivo) {
  filaReconstrucao++;
  try {
    const t0 = Date.now();
    await Promise.all(config.get().fontes.map((f) => lerFonte(f)));
    montarGrafo(motivo);
    for (const p of parciais.values()) {
      if (!p.r) continue;
      let max = 0;
      for (const e of p.r.eventos) if (e.t > max) max = e.t;
      p.maxT = max;
    }
    log(`construção completa em ${Date.now() - t0} ms`);
    return Date.now() - t0;
  } finally { filaReconstrucao--; }
}

function emitirHistorico() {
  const hist = G.interno.eventosHist;
  const agora = Date.now();
  for (const e of hist) if (e.arquivo && agora - e.t < 2 * 3600 * 1000) telemetry.tocouArquivo(e.t);
  for (const e of hist.slice(-300)) telemetry.emitir({ t: e.t, nivel: 'HIST', fonte: e.fonte, msg: e.msg, id: e.id, hash: e.hash });
}

function assinaturaParcial(r) {
  const h = require('crypto').createHash('sha1');
  for (const n of r.nos) h.update(n.chave + '|');
  for (const l of r.links) h.update(l.de + '>' + (typeof l.para === 'string' ? l.para : l.para.caminho) + l.tipo + '|');
  return h.digest('hex');
}

function atualizarRapido(r) {
  const CAMPOS = ['titulo', 'modificado', 'palavras', 'hash', 'texto', 'extra', '_eventos'];
  for (const n of r.nos) {
    const i = G.interno.porId.get(graph.idDe(n.chave));
    if (i === undefined) return false;
    const velho = G.interno.nos[i];
    if (velho.tipo === 'nota' || velho.criado !== n.criado) return false; // datas de nota dependem do git
    for (const c of CAMPOS) if (n[c] !== undefined) velho[c] = n[c];
    const pub = G.publico.nos[i];
    pub.titulo = velho.titulo; pub.modificado = Math.round(velho.modificado); pub.palavras = velho.palavras; pub.hash = velho.hash;
    const reg = G.publico.regioes.find((x) => x.id === velho.regiao);
    if (reg && velho.modificado > reg.ultimoPulso) reg.ultimoPulso = velho.modificado;
  }
  const c = G.publico.contadores;
  let ms = 0, fer = 0;
  for (const n of G.interno.nos) if (n.tipo === 'sessao') { ms += n.extra.duracaoMs || 0; fer += n.extra.totalFerramentas || 0; }
  c.horasIA = Math.round(ms / 360000) / 10; c.ferramentas = fer;
  versao++;
  G.publico.versao = versao;
  G.publico.geradoEm = Date.now();
  cacheJson = null;
  return true;
}

// mudanças vindas do watch
const emAndamento = new Map();
async function aoMudar(fonte, mudancas) {
  if (emAndamento.get(fonte.id)) { emAndamento.set(fonte.id, 'denovo'); return; }
  emAndamento.set(fonte.id, true);
  filaReconstrucao++;
  try {
    for (const m of mudancas.slice(0, 20)) {
      if (fonte.tipo !== 'claude' && fonte.tipo !== 'git') telemetry.tocouArquivo(Date.now());
      telemetry.emitir({ nivel: 'INFO', fonte: fonte.tipo, msg: `FS ${m.tipo.toUpperCase()} ${fonte.tipo === 'git' ? '.git/' + path.basename(m.caminho) : baseName(m.caminho)}` });
    }
    if (mudancas.length > 20) telemetry.emitir({ nivel: 'INFO', fonte: fonte.tipo, msg: `FS +${mudancas.length - 20} MUDANÇAS` });
    const antes = parciais.get(fonte.id) && parciais.get(fonte.id).r;
    const sigAntes = antes ? assinaturaParcial(antes) : null;
    const reg = await lerFonte(fonte);
    // caminho rápido: mesma estrutura (ex.: sessão do Claude que só ganhou mensagens) → atualiza metadados sem remontar
    if (!(G && reg.r && sigAntes && assinaturaParcial(reg.r) === sigAntes && atualizarRapido(reg.r))) montarGrafo('mudança em ' + fonte.tipo);
    eventosNovos(reg);
  } catch (e) {
    telemetry.emitir({ nivel: 'ALERTA', fonte: fonte.tipo, msg: 'ERRO NA RECONSTRUÇÃO ' + e.message });
  } finally {
    filaReconstrucao--;
    const denovo = emAndamento.get(fonte.id) === 'denovo';
    emAndamento.delete(fonte.id);
    if (denovo) aoMudar(fonte, []);
  }
}

function vigiarTudo() {
  for (const f of config.get().fontes) watch.vigiar(f, aoMudar);
}

// ---------------------------------------------------------------- máquina
function sessoesAtivas() {
  if (!G) return [];
  const agora = Date.now();
  const out = [];
  for (const n of G.interno.nos) {
    if (n.tipo !== 'sessao') continue;
    const mt = n.extra.mtimeMs || n.modificado;
    if (agora - Math.max(mt, n.modificado) > 5 * 60 * 1000) continue;
    out.push({ id: n.id, idCurto: n.idCurto, titulo: n.titulo, regiao: n.regiao, projeto: n.projeto, inicio: n.criado, ultimoEvento: n.modificado,
      ferramentas: n.extra.totalFerramentas || 0, arquivos: (n.extra.arquivos || []).length, modelo: n.extra.modelo, mensagens: n.palavras,
      agente: n.extra.agente ? { id: n.extra.agente.id, tipo: n.extra.agente.tipo, pai: n.extra.agente.pai } : null });
  }
  return out.sort((a, b) => b.ultimoEvento - a.ultimoEvento);
}

function maquina(comTelemetria) {
  const o = { ativos: sessoesAtivas(), arquivosPorMinuto: telemetry.arquivosPorMinuto(), fila: telemetry.status().fila };
  if (comTelemetria) o.telemetria = telemetry.ultimos(200);
  return o;
}

// ---------------------------------------------------------------- neurônio
function publicoDe(i) { return G.publico.nos[i]; }

async function detalheNo(id) {
  const i = G.interno.porId.get(id);
  if (i === undefined) return null;
  const n = G.interno.nos[i];
  const entrada = [], saida = [];
  const forca = new Map();
  for (const s of G.publico.sinapses) {
    if (s.a !== i && s.b !== i) continue;
    const outro = s.a === i ? s.b : s.a;
    const o = G.interno.nos[outro];
    const item = { id: o.id, titulo: o.titulo, tipo: s.tipo, peso: s.peso };
    if (s.a === i) { if (saida.length < 300) saida.push(item); } else if (entrada.length < 300) entrada.push(item);
    if (s.tipo !== 'DIA') forca.set(outro, (forca.get(outro) || 0) + s.peso);
  }
  const vizinhos = [...forca.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([j, f]) => ({ id: G.interno.nos[j].id, titulo: G.interno.nos[j].titulo, forca: Math.round(f * 100) / 100 }));

  const historico = [];
  const conteudo = { formato: 'texto', corpo: '' };
  const np = n.caminho ? normPath(n.caminho) : null;
  const histArq = np ? G.interno.historicoArquivos.get(np) : null;
  if (n.tipo === 'nota') {
    const { corpo } = fontes.obsidian.lerCorpo(n.caminho);
    conteudo.formato = 'markdown';
    conteudo.corpo = corpo;
    conteudo.extra = { tagsTexto: n.extra.tagsTexto, rel: n.extra.rel };
  } else if (n.tipo === 'commit') {
    conteudo.formato = 'commit';
    conteudo.corpo = (await fontes.git.mensagemCompleta(n.caminho, n.extra.sha)) || n.titulo;
    conteudo.extra = { sha: n.extra.sha, pais: n.extra.pais, mais: n.extra.mais, menos: n.extra.menos, refs: n.extra.refs, autor: n.extra.autorNome, arquivos: n.extra.arquivos, nArquivos: n.extra.nArquivos };
    historico.push({ t: n.criado, evento: 'AUTORIA ' + n.extra.autorNome, hash: n.hash });
    if (n.modificado !== n.criado) historico.push({ t: n.modificado, evento: 'COMMIT GRAVADO', hash: n.hash });
  } else if (n.tipo === 'sessao') {
    conteudo.formato = 'sessao';
    const e = n.extra;
    conteudo.corpo = (e.prompts || []).map((p) => '› ' + p.texto).join('\n\n');
    conteudo.extra = { sessionId: e.sessionId, cwd: e.cwd, branch: e.branch, modelo: e.modelo, versao: e.versao, msgsUser: e.msgsUser, msgsAssist: e.msgsAssist,
      ferramentas: e.ferramentas, totalFerramentas: e.totalFerramentas, arquivos: e.arquivos, duracaoMs: e.duracaoMs, ativa: e.ativa, prompts: e.prompts, agente: e.agente };
    for (const ev of (n._eventos || []).slice(-200)) historico.push({ t: ev.t, evento: 'TOOL ' + ev.ferramenta + (ev.arquivo ? ' ' + baseName(ev.arquivo) : '') });
  } else if (n.tipo === 'doc' || n.tipo === 'arquivo') {
    if (n.caminho && ehTexto(n.caminho) && existe(n.caminho)) {
      try {
        const st = fs.statSync(n.caminho);
        const fd = fs.openSync(n.caminho, 'r');
        const buf = Buffer.alloc(Math.min(st.size, 100 * 1024));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        conteudo.corpo = buf.toString('utf8');
        conteudo.formato = /\.md$/i.test(n.caminho) ? 'markdown' : 'texto';
      } catch { /* sem leitura */ }
    }
    conteudo.extra = n.extra;
  } else if (n.tipo === 'dia') {
    const doDia = [];
    for (const s of G.publico.sinapses) if (s.tipo === 'DIA' && (s.a === i || s.b === i)) doDia.push(G.interno.nos[s.a === i ? s.b : s.a]);
    doDia.sort((a, b) => a.criado - b.criado);
    conteudo.corpo = doDia.slice(0, 400).map((x) => `${new Date(x.criado).toISOString().slice(11, 19)}  ${x.tipo.toUpperCase().padEnd(8)} ${x.titulo}`).join('\n');
    conteudo.extra = { total: doDia.length };
  } else {
    conteudo.corpo = n.texto || '';
    conteudo.extra = n.extra;
  }
  if (n.tipo !== 'commit' && n.tipo !== 'sessao') {
    historico.push({ t: n.criado, evento: 'CRIADO' });
    if (n.modificado && n.modificado !== n.criado) historico.push({ t: n.modificado, evento: 'ÚLTIMA MUDANÇA', hash: n.hash });
  }
  if (histArq) for (const h of histArq) historico.push({ t: h.t, evento: `COMMIT +${h.a}/-${h.d} ${h.s}`.slice(0, 140), hash: h.sha.slice(0, 12) });
  historico.sort((a, b) => b.t - a.t);

  const maq = classify.interpretacao(n.id) || { tags: n.tags, por: 'regras', em: 0 };
  return {
    no: publicoDe(i), entrada, saida, vizinhos, historico: historico.slice(0, 300), conteudo,
    maquina: { tags: maq.tags || [], regiao: n.regiao, cluster: n.cluster, por: maq.por || 'regras', em: maq.em || 0, ...(maq.nota ? { nota: maq.nota } : {}) },
    correcao: classify.correcao(n.id),
  };
}

function busca(q) {
  if (!G || !q) return [];
  const termo = q.toLowerCase().trim();
  if (!termo) return [];
  const res = [];
  for (const n of G.interno.nos) {
    const t = (n.titulo || '').toLowerCase();
    let score = 0, trecho = '';
    if (t === termo) score = 100;
    else if (t.startsWith(termo)) score = 80;
    else if (t.includes(termo)) score = 60;
    else if (n.idCurto === termo || (n.hash && n.hash.startsWith(termo))) score = 90;
    else {
      const tx = (n.texto || '');
      const k = tx.toLowerCase().indexOf(termo);
      if (k >= 0) { score = 30; trecho = tx.slice(Math.max(0, k - 50), k + 90).replace(/\s+/g, ' '); }
      else if ((n.tags || []).some((g) => g.toLowerCase() === termo)) score = 25;
    }
    if (!score) continue;
    if (n.tipo === 'dia') score -= 10;
    res.push({ score: score + Math.min(9, n.grau / 20), id: n.id, titulo: n.titulo, tipo: n.tipo, fonte: n.fonte, regiao: n.regiao, trecho: trecho || (n.texto || '').slice(0, 120).replace(/\s+/g, ' ') });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, 50).map(({ score, ...r }) => r);
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8' };

function servirArquivo(res, base, rel) {
  const alvo = path.resolve(base, '.' + path.sep + rel);
  if (!alvo.startsWith(path.resolve(base))) { res.writeHead(403); return res.end('proibido'); }
  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('não encontrado'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(alvo).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(alvo).pipe(res);
  });
}

function json(res, codigo, obj, req) {
  const buf = Buffer.from(JSON.stringify(obj));
  const gz = req && /gzip/.test(req.headers['accept-encoding'] || '') && buf.length > 2048;
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
  res.end(gz ? zlib.gzipSync(buf, { level: 4 }) : buf);
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
  });
}

function respostaGrafo(req, res) {
  if (!G) return json(res, 200, grafoVazio(), req);
  if (!cacheJson || cacheJson.versao !== versao) {
    G.publico.fontes = statusFontes();
    const buf = Buffer.from(JSON.stringify(G.publico));
    cacheJson = { versao, buf, gz: zlib.gzipSync(buf, { level: 4 }) };
  }
  const gz = /gzip/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
  res.end(gz ? cacheJson.gz : cacheJson.buf);
}

const VENDOR = {
  three: path.join(ROOT, 'node_modules', 'three'),
  fonts: path.join(ROOT, 'node_modules', '@fontsource-variable', 'martian-mono', 'files'),
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = decodeURIComponent(url.pathname);
  try {
    // ---- API
    if (p === '/api/graph' && req.method === 'GET') return respostaGrafo(req, res);
    if (p.startsWith('/api/no/')) {
      const resto = p.slice('/api/no/'.length).split('/');
      const id = resto[0];
      if (!G) return json(res, 503, { erro: 'carregando' });
      if (resto[1] === 'correcao' && req.method === 'POST') {
        if (!G.interno.porId.has(id)) return json(res, 404, { erro: 'neurônio não encontrado' });
        const corpo = await lerCorpo(req);
        if (!corpo) return json(res, 400, { erro: 'JSON inválido' });
        const c = classify.salvarCorrecao(id, corpo);
        telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `CORREÇÃO ${id.slice(0, 6)} ${JSON.stringify(corpo).slice(0, 100)}`, id });
        setImmediate(() => montarGrafo('correção'));
        return json(res, 200, { ok: true, correcao: c });
      }
      if (req.method === 'GET') {
        const d = await detalheNo(id);
        return d ? json(res, 200, d, req) : json(res, 404, { erro: 'neurônio não encontrado' });
      }
    }
    if (p === '/api/busca') return json(res, 200, { resultados: busca(url.searchParams.get('q') || '') }, req);
    if (p === '/api/fontes' && req.method === 'GET') return json(res, 200, { fontes: statusFontes(), claude: { ativo: !!config.get().claude.ativo, temChave: !!config.chaveClaude(), modelo: config.get().claude.modelo } });
    if (p === '/api/fontes' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      if (!corpo) return json(res, 400, { erro: 'JSON inválido' });
      let f;
      try { f = config.adicionarFonte(corpo); } catch (e) { return json(res, 400, { erro: e.message }); }
      telemetry.emitir({ nivel: 'INFO', fonte: f.tipo, msg: `FONTE CONECTADA ${f.tipo.toUpperCase()} ${f.caminho}` });
      (async () => { filaReconstrucao++; try { const reg = await lerFonte(f); montarGrafo('fonte conectada'); eventosNovos(reg); watch.vigiar(f, aoMudar); } finally { filaReconstrucao--; } })();
      return json(res, 200, { ok: true, fonte: f });
    }
    if (p.startsWith('/api/fontes/') && req.method === 'DELETE') {
      const id = p.slice('/api/fontes/'.length);
      const f = config.removerFonte(id);
      if (!f) return json(res, 404, { erro: 'fonte não encontrada' });
      watch.parar(id);
      parciais.delete(id);
      telemetry.emitir({ nivel: 'ALERTA', fonte: f.tipo, msg: `FONTE DESCONECTADA ${f.tipo.toUpperCase()} ${f.caminho}` });
      setImmediate(() => montarGrafo('fonte removida'));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/reconstruir' && req.method === 'POST') {
      const ms = await construirTudo('reconstrução manual');
      return json(res, 200, { ok: true, versao, ms });
    }
    if (p === '/api/maquina') return json(res, 200, maquina(true), req);
    if (p === '/api/status') return json(res, 200, { ...telemetry.status(), pronto, versao });
    if (p.startsWith('/api/')) return json(res, 404, { erro: 'rota desconhecida' });

    // ---- vendor
    if (p.startsWith('/vendor/three/')) return servirArquivo(res, VENDOR.three, p.slice('/vendor/three/'.length));
    if (p === '/vendor/marked.esm.js') return servirArquivo(res, path.join(ROOT, 'node_modules', 'marked', 'lib'), 'marked.esm.js');
    if (p.startsWith('/vendor/fonts/')) return servirArquivo(res, VENDOR.fonts, p.slice('/vendor/fonts/'.length));
    // ---- estáticos
    if (p === '/direcoes-visuais.html') return servirArquivo(res, ROOT, 'direcoes-visuais.html');
    if (p === '/' || p === '') return servirArquivo(res, path.join(ROOT, 'web'), 'index.html');
    return servirArquivo(res, path.join(ROOT, 'web'), p.replace(/^\/+/, ''));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { erro: String(e.message || e) });
  }
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ server: servidor, path: '/ws' });
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) { try { c.send(s); } catch { /* cliente caiu */ } }
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ tipo: 'ola', versao }));
});
telemetry.ouvir((e) => broadcast({ tipo: 'evento', ...e }));
setInterval(() => broadcast({ tipo: 'status', ...telemetry.status() }), 1000).unref();
setInterval(() => broadcast({ tipo: 'maquina', ...maquina(false) }), 2000).unref();
classify.onAtualizar((r) => {
  if (r.ok) telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `CLAUDE CLASSIFICOU ${r.id.slice(0, 6)} → ${r.tags.join(' ')}`, id: r.id });
  else telemetry.emitir({ nivel: 'ALERTA', fonte: 'sistema', msg: `CLAUDE FALHOU ${r.id.slice(0, 6)} (${r.erro}) · REGRAS LOCAIS MANTIDAS` });
});

// ---------------------------------------------------------------- boot
function abrirNavegador(url) {
  const { spawn } = require('child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* sem navegador */ }
}

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`a porta ${PORTA} já está em uso — o CÓRTEX provavelmente já está aberto: http://127.0.0.1:${PORTA}`);
    if (process.argv.includes('--abrir')) abrirNavegador(`http://127.0.0.1:${PORTA}`);
    process.exit(0);
  }
  throw e;
});

servidor.listen(PORTA, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${PORTA}`;
  log(`no ar em ${url}`);
  log(`config: ${config.CONFIG_PATH}`);
  log(`organização com Claude: ${classify.claudeLigado() ? 'LIGADA' : 'desligada (regras locais)'}`);
  if (process.argv.includes('--abrir')) abrirNavegador(url);
  telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `CÓRTEX ONLINE · ${config.get().fontes.length} FONTES · PORTA ${PORTA}` });
  try {
    const ms = await construirTudo('boot');
    emitirHistorico();
    pronto = true;
    telemetry.emitir({ nivel: 'INFO', fonte: 'sistema', msg: `BOOT COMPLETO EM ${ms} MS` });
    vigiarTudo();
    log('vigiando fontes');
  } catch (e) {
    console.error('[CÓRTEX] falha no boot:', e);
  }
});

function sair() { watch.pararTodos(); process.exit(0); }
process.on('SIGINT', sair);
process.on('SIGTERM', sair);
