#!/usr/bin/env node
'use strict';
// CÓRTEX — linha de comando para humanos e outras sessões do Claude.
// Só módulos nativos do Node. Fala com o servidor local em 127.0.0.1:<porta>.
// Se o servidor não estiver de pé, liga ele em segundo plano e espera.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const os = require('os');
const ROOT = __dirname;
const HOME = os.homedir();

// app de desktop instalado? (gravado pelo instalar.js --exe em ~/.cortex/app.json)
function lerApp() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, '.cortex', 'app.json'), 'utf8')); } catch { return null; }
}
const APP = lerApp();

// Mesma regra do servidor V4: pasta de dados = CORTEX_DADOS > CORTEX_DATA > dados do app (%APPDATA%\CORTEX no
// Windows, ~/.config/CORTEX no Linux, ~/Library/Application Support/CORTEX no mac, se existir) > ao lado do CLI.
// config = CORTEX_CONFIG > <dados>/cortex.config.json
function pastaDadosApp() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'CORTEX');
  if (process.platform === 'darwin') return path.join(HOME, 'Library', 'Application Support', 'CORTEX');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'CORTEX');
}
function acharDados() {
  const env = process.env.CORTEX_DADOS || process.env.CORTEX_DATA;
  if (env) return path.resolve(env);
  if (APP && APP.dadosDir && fs.existsSync(APP.dadosDir)) return APP.dadosDir;
  const doApp = pastaDadosApp();
  if (fs.existsSync(path.join(doApp, 'cortex.config.json'))) return doApp;
  return ROOT;
}
const DADOS_DIR = acharDados();
const CONFIG_PATH = process.env.CORTEX_CONFIG ? path.resolve(process.env.CORTEX_CONFIG) : path.join(DADOS_DIR, 'cortex.config.json');
const DATA_DIR = path.join(DADOS_DIR, 'data');

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
const PORTA = Number(process.env.PORT) || Number(lerConfig().porta) || 4747;
const BASE = `http://127.0.0.1:${PORTA}`;

// ---------- argumentos ----------
function parse(argv) {
  const pos = [], op = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { op[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2), prox = argv[i + 1];
      if (prox !== undefined && !prox.startsWith('--')) { op[k] = prox; i++; } else op[k] = true;
    } else pos.push(a);
  }
  return { pos, op };
}
const lista = (v) => (v === undefined || v === true ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean));

// "7d", "24h", "2w", "30m", "2026-11-01" → epoch ms
function tempo(v) {
  if (v === undefined || v === true) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|d|s|w|sem)$/i.exec(String(v).trim());
  if (m) {
    const n = parseFloat(m[1]);
    const u = { m: 6e4, min: 6e4, h: 36e5, d: 864e5, s: 6048e5, w: 6048e5, sem: 6048e5 }[m[2].toLowerCase()];
    return Date.now() - n * u;
  }
  const t = Date.parse(v);
  if (!isNaN(t)) return t;
  falhar(`data inválida: "${v}" (use 7d, 24h, 2w ou AAAA-MM-DD)`);
}

// ---------- saída ----------
let MODO_JSON = false;
// saída cortada por "| head" não é erro
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
function out(s = '') { process.stdout.write(s + '\n'); }
function falhar(msg, cod = 1) {
  if (MODO_JSON) process.stdout.write(JSON.stringify({ erro: msg }) + '\n');
  else process.stderr.write(`[córtex] ${msg}\n`);
  process.exit(cod);
}
const data = (t) => {
  if (!t) return '—';
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const rel = (t) => {
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'agora';
  if (s < 5400) return `há ${Math.round(s / 60)} min`;
  if (s < 129600) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
};
const corta = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- HTTP ----------
function req(metodo, rota, corpo, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const r = http.request(BASE + rota, {
      method: metodo,
      headers: dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {},
      timeout,
    }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null;
        if ((res.headers['content-type'] || '').includes('json') || /^\s*[[{]/.test(texto)) {
          try { json = JSON.parse(texto); } catch { /* texto puro */ }
        }
        resolve({ status: res.statusCode, json, texto });
      });
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    r.on('error', reject);
    if (dados) r.write(dados);
    r.end();
  });
}

async function vivo() {
  try { const r = await req('GET', '/api/status', undefined, 2500); return r.status === 200 ? (r.json || {}) : null; }
  catch { return null; }
}

// Liga o CÓRTEX: o app de desktop escondido na bandeja, se instalado; senão o servidor com node.
// (Testes com PORT/CORTEX_CONFIG sempre usam o servidor direto, para não abrir o app do usuário.)
function ligarServidor() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.openSync(path.join(DATA_DIR, 'servidor.log'), 'a');
  const teste = process.env.PORT || process.env.CORTEX_CONFIG || process.env.CORTEX_DADOS || process.env.CORTEX_DATA;
  if (!teste && APP && APP.exe && fs.existsSync(APP.exe)) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // o cortex.cmd liga isso para rodar o CLI; o app precisa subir como app
    const p = spawn(APP.exe, ['--escondido'], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env });
    p.on('error', () => {});
    p.unref();
    return 'app';
  }
  // em modo ELECTRON_RUN_AS_NODE o próprio exe funciona como node
  const p = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env,
  });
  p.unref();
  return 'node';
}

// garante servidor de pé; com `pronto`, espera também o grafo terminar de montar (máx. 60 s),
// avisando no stderr ("montando o cérebro… N s"), para quem chama não precisar repetir o comando.
const ESPERA_PRONTO = 60000;
async function garantir({ pronto = true, limite = 30000 } = {}) {
  let st = await vivo();
  if (!st) {
    const como = ligarServidor();
    process.stderr.write(`[córtex] servidor fora do ar em ${BASE}; ${como === 'app' ? 'abrindo o app CÓRTEX escondido na bandeja' : 'ligando em segundo plano'}…\n`);
  }
  const t0 = Date.now();
  const fimSubir = t0 + limite;
  const fimPronto = t0 + limite + ESPERA_PRONTO;
  let ultimoAviso = 0;
  while (true) {
    st = await vivo();
    // servidor antigo sem o campo `pronto` conta como pronto
    if (st && (!pronto || st.pronto !== false)) return st;
    if (!st && Date.now() > fimSubir) falhar(`o servidor não subiu em ${Math.round(limite / 1000)} s. Veja ${path.join(DATA_DIR, 'servidor.log')} ou rode "node server/index.js" em ${ROOT}.`);
    if (Date.now() > fimPronto) falhar(`o grafo ainda não ficou pronto depois de ${Math.round((Date.now() - t0) / 1000)} s${st && st.fase ? ' (fase: ' + st.fase + ')' : ''}. Rode o mesmo comando de novo daqui a pouco.`);
    const s = Math.round((Date.now() - t0) / 1000);
    if (st && s - ultimoAviso >= 3) {
      ultimoAviso = s;
      process.stderr.write(`[córtex] montando o cérebro… ${s} s${st.fase ? ' · ' + st.fase : ''}\n`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// id principal para humanos e para citar: o idCurto de 6 caracteres (o Ctrl+K do app acha)
const curto = (x) => (x && (x.idCurto || (x.id ? String(x.id).slice(0, 6) : ''))) || '';

async function api(metodo, rota, corpo) {
  let r;
  try { r = await req(metodo, rota, corpo, 60000); }
  catch (e) { falhar(`não consegui falar com o servidor (${e.code || e.message}).`); }
  if (r.status === 404 && r.json && r.json.erro === 'rota desconhecida') {
    falhar(`o servidor não conhece ${rota.split('?')[0]}. Atualize o CÓRTEX (versão do servidor antiga).`);
  }
  if (r.status >= 400) {
    const j = r.json || {};
    const ps = Array.isArray(j.projetos) && j.projetos.length ? `. Projetos: ${j.projetos.map((p) => (typeof p === 'string' ? p : p.nome)).join(', ')}` : '';
    falhar((j.erro || j.mensagem || `erro HTTP ${r.status} em ${rota}`) + ps);
  }
  return r;
}

// devolve true se tentou abrir; false quando não há navegador neste ambiente (aí só imprimimos a URL)
function abrirNavegador(url) {
  const plat = process.platform;
  try {
    if (plat === 'win32') { spawn('cmd', ['/c', 'start', '""', url], { detached: true, windowsHide: true, stdio: 'ignore' }).unref(); return true; }
    if (plat === 'darwin') { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); return true; }
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
    const temXdg = (process.env.PATH || '').split(':').some((d) => d && fs.existsSync(path.join(d, 'xdg-open')));
    if (!temXdg) return false;
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return true;
  } catch { return false; }
}
function avisarAbertura(url, abriu) {
  if (abriu) out(`abrindo ${url}`);
  else out(`não há navegador neste ambiente. Abra no navegador: ${url}`);
}

// ---------- visões ----------
function visaoDeOpcoes(alvo, op) {
  const v = {};
  if (alvo && !/^(tudo|todos|all)$/i.test(alvo)) v.projetos = lista(alvo);
  if (op.projetos) v.projetos = lista(op.projetos);
  if (op.fontes) v.fontes = lista(op.fontes);
  if (op.tipos) v.tipos = lista(op.tipos);
  if (op.tags) v.tags = lista(op.tags);
  if (op.desde) v.desde = tempo(op.desde);
  if (op.ate) v.ate = tempo(op.ate);
  if (op.grau) v.grauMin = Number(op.grau);
  if (op.texto) v.texto = String(op.texto);
  if (op.vizinhos !== undefined) v.vizinhos = Math.max(0, Math.min(2, Number(op.vizinhos === true ? 1 : op.vizinhos)));
  const partes = [];
  if (v.projetos) partes.push(v.projetos.join('+').toUpperCase());
  if (v.fontes) partes.push(v.fontes.join('+').toUpperCase());
  if (v.tipos) partes.push(v.tipos.join('+').toUpperCase());
  if (op.desde) partes.push('DESDE ' + op.desde);
  if (v.tags) partes.push('#' + v.tags.join(' #'));
  if (v.texto) partes.push(`"${v.texto}"`);
  v.nome = partes.length ? partes.join(' · ') : 'TUDO';
  v.id = 'cli_' + v.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return v;
}

async function resolverVisao(alvo, op) {
  const temFiltro = ['fontes', 'tipos', 'tags', 'desde', 'ate', 'grau', 'texto', 'vizinhos', 'projetos'].some((k) => op[k] !== undefined);
  if (alvo && !temFiltro) {
    const r = await api('GET', '/api/visoes');
    const vs = (r.json && r.json.visoes) || [];
    const n = alvo.toLowerCase();
    const achou = vs.find((v) => String(v.id).toLowerCase() === n || String(v.nome).toLowerCase() === n);
    if (achou) return { id: achou.id, nome: achou.nome, salva: true };
    if (/^(tudo|todos|all)$/i.test(alvo)) {
      const t = vs.find((v) => /^tudo$/i.test(v.nome));
      if (t) return { id: t.id, nome: t.nome, salva: true };
    }
  }
  return visaoDeOpcoes(alvo, op);
}

// ---------- comandos ----------
const C = {};

C.status = async (pos, op) => {
  const st = await garantir({ pronto: !!op.esperar });
  let projetos = null;
  try { const r = await req('GET', '/api/projetos'); if (r.status === 200 && r.json) projetos = r.json.projetos; } catch { /* opcional */ }
  if (MODO_JSON) return out(JSON.stringify({ rodando: true, url: BASE, ...st, projetos }));
  out(`CÓRTEX rodando em ${BASE}`);
  out(`grafo v${st.versao ?? '?'} · ${st.pronto === false ? 'MONTANDO' + (st.fase ? ' (' + st.fase + ')' : '') + '… (use --esperar, ou rode qualquer comando de leitura: ele espera sozinho)' : 'pronto'} · cpu ${st.cpu ?? '?'}% · mem ${st.memMB ?? '?'} MB · fila ${st.fila ?? 0}`);
  if (projetos) {
    const n = projetos.reduce((s, p) => s + (p.neuronios || 0), 0);
    out(`${projetos.length} projetos · ${n} neurônios`);
  }
};

C.projetos = async (pos, op) => {
  await garantir();
  const r = await api('GET', '/api/projetos');
  const ps = (r.json && r.json.projetos) || [];
  if (MODO_JSON) return out(JSON.stringify(ps));
  if (!ps.length) return out('nenhum projeto ainda. Conecte fontes com "cortex conectar".');
  ps.sort((a, b) => (b.ultimoPulso || 0) - (a.ultimoPulso || 0));
  out('PROJETO                      NEURÔNIOS  NOTAS  COMMITS  SESSÕES  ÚLTIMO PULSO');
  for (const p of ps) {
    out(`${corta(p.nome, 28).padEnd(28)} ${String(p.neuronios ?? 0).padStart(9)} ${String(p.notas ?? 0).padStart(6)} ${String(p.commits ?? 0).padStart(8)} ${String(p.sessoes ?? 0).padStart(8)}  ${rel(p.ultimoPulso)}`);
    if (p.subregioes && p.subregioes.length > 1 && op.sub) out(`   sub: ${p.subregioes.join(', ')}`);
  }
};

C.resumo = async (pos, op) => {
  await garantir();
  const q = new URLSearchParams();
  const proj = pos[0] || op.projeto;
  if (proj) q.set('projeto', proj);
  if (op.tudo) q.set('dias', '0'); // todo o histórico
  else if (op.dias) q.set('dias', String(op.dias));
  if (MODO_JSON) q.set('formato', 'json');
  const r = await api('GET', '/api/resumo?' + q.toString());
  if (MODO_JSON) return out(r.json ? JSON.stringify(r.json) : JSON.stringify({ texto: r.texto }));
  out(r.json ? (r.json.texto || r.json.markdown || JSON.stringify(r.json, null, 2)) : r.texto);
};

C.buscar = async (pos, op) => {
  const termo = pos.join(' ').trim();
  if (!termo) falhar('uso: cortex buscar "<texto>" [--projeto X] [--json]');
  if (termo.length < 2) falhar('a busca precisa de pelo menos 2 caracteres.');
  await garantir();
  const q = new URLSearchParams({ q: termo });
  if (op.projeto) q.set('projeto', String(op.projeto));
  const r = await api('GET', '/api/busca?' + q.toString());
  let rs = (r.json && r.json.resultados) || [];
  if (op.projeto) {
    const alvo = String(op.projeto).toLowerCase();
    rs = rs.filter((x) => !x.regiao || String(x.regiao).toLowerCase().replace(/^r_/, '') === alvo || String(x.projeto || '').toLowerCase() === alvo);
  }
  const lim = Number(op.limite) || 20;
  rs = rs.slice(0, lim);
  if (MODO_JSON) return out(JSON.stringify(rs));
  if (!rs.length) return out(`nada encontrado para "${termo}".`);
  for (const x of rs) {
    out(`${curto(x)}  ${String(x.tipo || '').toUpperCase().padEnd(8)} ${corta(x.titulo, 70)}`);
    const meta = [x.fonte, String(x.regiao || '').replace(/^r_/, '')].filter(Boolean).join(' · ');
    if (meta || x.trecho) out(`        ${meta}${x.trecho ? '  — ' + corta(x.trecho, 90) : ''}`);
  }
};

async function acharNo(alvo) {
  const r = await req('GET', '/api/no/' + encodeURIComponent(alvo));
  if (r.status === 200 && r.json && r.json.no) return r.json;
  const b = await api('GET', '/api/busca?q=' + encodeURIComponent(alvo));
  const rs = (b.json && b.json.resultados) || [];
  if (!rs.length) falhar(`neurônio "${alvo}" não encontrado.`);
  const exato = rs.find((x) => String(x.titulo).toLowerCase() === alvo.toLowerCase()) || rs[0];
  const r2 = await api('GET', '/api/no/' + encodeURIComponent(exato.id));
  return r2.json;
}

C.no = async (pos, op) => {
  const alvo = pos.join(' ').trim();
  if (!alvo) falhar('uso: cortex no <id|título> [--json]');
  await garantir();
  const d = await acharNo(alvo);
  if (MODO_JSON) return out(JSON.stringify(d));
  const n = d.no;
  out(`${curto(n)} · ${String(n.tipo).toUpperCase()} · ${String(n.fonte).toUpperCase()} · ${n.titulo}   (id ${n.id})`);
  out(`região ${String(n.regiao).replace(/^r_/, '')}/${n.subregiao || '—'} · autor ${n.autor || '—'} · grau ${n.grau} · ${n.palavras} palavras`);
  out(`criado ${data(n.criado)} · modificado ${data(n.modificado)} · hash ${n.hash || '—'}`);
  if (n.caminho) out(`caminho ${n.caminho}`);
  if (n.worktree) out(`worktree ${n.worktree}`);
  const tagsAutor = n.tagsAutor || (d.conteudo && d.conteudo.tagsAutor) || [];
  if (tagsAutor.length) out(`tags do autor: ${tagsAutor.join(', ')}`);
  const tags = (d.correcao && d.correcao.tags) || (d.maquina && d.maquina.tags) || n.tags || [];
  if (tags.length) out(`tags da máquina: ${tags.join(', ')}${d.correcao && d.correcao.tags ? ' (corrigidas pelo usuário)' : ''}`);
  const vz = (d.vizinhos || []).slice(0, 8);
  if (vz.length) { out('vizinhos:'); for (const v of vz) out(`  ${curto(v)}  ${corta(v.titulo, 60)}  (${typeof v.forca === 'number' ? v.forca.toFixed(2) : v.forca})`); }
  const c = d.conteudo || {};
  if (c.corpo) {
    // quebras de linha de verdade; texto gravado com "\n" literal (sem quebra real) também vira quebra
    let corpo = String(c.corpo).replace(/\r\n/g, '\n');
    if (!corpo.includes('\n') && corpo.includes('\\n')) corpo = corpo.replace(/\\n/g, '\n');
    out('--- conteúdo ---');
    out(op.completo || corpo.length <= 1500 ? corpo : corpo.slice(0, 1500).replace(/\n[^\n]*$/, '') + '\n…');
  }
  if (!op.completo && c.corpo && c.corpo.length > 1500) out('(cortado; use --completo ou --json)');
};

C.mostrar = async (pos, op) => {
  const alvo = pos.join(' ').trim();
  if (!alvo && !['fontes', 'tipos', 'tags', 'desde', 'texto', 'projetos'].some((k) => op[k] !== undefined)) {
    falhar('uso: cortex mostrar <projeto|visão|tudo> [--fontes git,claude] [--tipos nota,commit] [--desde 7d] [--tags a,b] [--texto x] [--vizinhos 1]');
  }
  await garantir();
  const { v, id, janelas } = await aplicarVisao(alvo, op);
  const url = urlVisao(id);
  let abriu = null;
  if (op.abrir) abriu = abrirNavegador(url);
  if (MODO_JSON) return out(JSON.stringify({ ok: true, visao: { ...v, id }, janelas, url, abriu }));
  if (op.abrir) { out(`visão: ${v.nome}`); avisarAbertura(url, abriu); return; }
  if (janelas === 0) out(`nenhuma janela aberta; use --abrir para abrir uma (o mesmo comando + --abrir). A visão "${v.nome}" ficou salva como atual: ${url}`);
  else out(`visão aplicada em ${janelas == null ? 'todas as' : janelas} janela${janelas === 1 ? '' : 's'} aberta${janelas === 1 ? '' : 's'}: ${v.nome}`);
};

// aplica a visão no servidor (vale para toda janela aberta e para as que abrirem depois)
async function aplicarVisao(alvo, op) {
  const v = await resolverVisao(alvo, op);
  const r = await api('POST', '/api/visao/atual', v.salva ? { id: v.id } : v);
  const id = (r.json && r.json.visao && r.json.visao.id) || v.id;
  const janelas = r.json && typeof r.json.janelas === 'number' ? r.json.janelas : null;
  return { v, id, janelas };
}
const urlVisao = (id) => BASE + '/' + (id ? '?visao=' + encodeURIComponent(id) : '');

C.abrir = async (pos, op) => {
  const alvo = pos.join(' ').trim();
  const filtrou = alvo || ['fontes', 'tipos', 'tags', 'desde', 'ate', 'texto', 'grau', 'vizinhos'].some((k) => op[k] !== undefined);
  let url = BASE + '/', nome = null;
  if (filtrou) {
    await garantir();
    const { v, id } = await aplicarVisao(alvo, op);
    url = urlVisao(id); nome = v.nome;
  } else await garantir({ pronto: false });
  const abriu = abrirNavegador(url);
  if (MODO_JSON) return out(JSON.stringify({ url, abriu }));
  if (nome) out(`visão: ${nome}`);
  avisarAbertura(url, abriu);
};

C.listar = async (pos, op) => {
  await garantir();
  const q = new URLSearchParams();
  const proj = op.projeto && op.projeto !== true ? String(op.projeto) : pos[0];
  if (proj) q.set('projeto', proj);
  const desde = tempo(op.desde);
  if (desde) q.set('desde', String(Math.round(desde)));
  const ate = tempo(op.ate);
  if (ate) q.set('ate', String(Math.round(ate)));
  if (op.tipos) q.set('tipos', lista(op.tipos).join(','));
  if (op.fontes) q.set('fontes', lista(op.fontes).join(','));
  const lim = Number(op.limite) || 30;
  q.set('limite', String(lim));
  const r = await api('GET', '/api/listar?' + q.toString());
  const j = r.json || {};
  const itens = Array.isArray(j) ? j : (j.itens || j.nos || j.resultados || []);
  if (MODO_JSON) return out(JSON.stringify(j));
  if (!itens.length) return out('nada no recorte pedido.');
  for (const x of itens.slice(0, lim)) {
    const t = x.modificado || x.criado || x.t;
    const proj_ = x.projeto || String(x.regiao || '').replace(/^r_/, '');
    out(`${curto(x)}  ${data(t)}  ${String(x.tipo || '').toUpperCase().padEnd(8)} ${corta(x.titulo, 64)}${proj_ ? '  · ' + proj_ : ''}${x.worktree ? ' · wt ' + x.worktree : ''}${x.autor ? ' · ' + x.autor : ''}`);
    const ta = x.tagsAutor || [], tm = x.tags || [];
    if (ta.length || tm.length) out(`        ${ta.length ? 'autor: #' + ta.join(' #') : ''}${ta.length && tm.length ? '   ' : ''}${tm.length ? 'máquina: ' + tm.join(', ') : ''}`);
  }
  const total = j.total ?? itens.length;
  if (total > lim) out(`(${total} no total; use --limite N)`);
};

function lerStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

C.registrar = async (pos, op) => {
  const projeto = op.projeto, titulo = op.titulo;
  let texto = op.texto;
  if (op.arquivo) { try { texto = fs.readFileSync(String(op.arquivo), 'utf8'); } catch (e) { falhar(`não li ${op.arquivo}: ${e.message}`); } }
  if (texto === '-') texto = lerStdin(); // só lê a entrada padrão quando pedido: evita travar esperando um pipe
  else if (typeof texto === 'string' && !op.arquivo && !texto.includes('\n')) texto = texto.replace(/\\n/g, '\n'); // "\n" digitado no shell vira quebra
  if (!projeto || projeto === true || !titulo || titulo === true || !texto || texto === true) {
    falhar('uso: cortex registrar --projeto X --titulo "..." --texto "..." [--tags a,b] [--ligar id1,id2] [--autor "CLAUDE CODE"]\n         (texto longo: --arquivo nota.md, ou --texto - lendo da entrada padrão)');
  }
  await garantir();
  const corpo = { projeto: String(projeto), titulo: String(titulo), texto: String(texto), autor: op.autor && op.autor !== true ? String(op.autor) : 'CLAUDE CODE' };
  if (op.tags) corpo.tags = lista(op.tags);
  if (op.ligar) corpo.ligar = lista(op.ligar);
  const r = await api('POST', '/api/registrar', corpo);
  if (MODO_JSON) return out(JSON.stringify(r.json));
  const j = r.json || {};
  out(`registrado: ${j.id ? curto(j) + ' · ' : ''}${j.caminho || ''}`);
  out('o neurônio aparece no cérebro em poucos segundos (fonte DIÁRIO).');
};

C.conectar = async (pos, op) => {
  const [tipo, ...resto] = pos;
  const caminho = resto.join(' ').trim();
  const tipos = ['obsidian', 'git', 'claude', 'pasta'];
  if (!tipos.includes(tipo) || !caminho) falhar('uso: cortex conectar <obsidian|git|claude|pasta> "<caminho>" [--projeto X]');
  const abs = path.resolve(caminho);
  if (!fs.existsSync(abs)) falhar(`o caminho não existe: ${abs}`);
  await garantir({ pronto: false });
  const corpo = { tipo, caminho: abs };
  if (op.projeto && op.projeto !== true) corpo.projeto = String(op.projeto);
  const r = await api('POST', '/api/fontes', corpo);
  if (MODO_JSON) return out(JSON.stringify(r.json));
  const f = (r.json && (r.json.fonte || r.json)) || {};
  out(`fonte conectada: ${tipo} ${abs}${f.projeto || corpo.projeto ? ' → projeto ' + (f.projeto || corpo.projeto) : ''}. O cérebro redesenha em segundos.`);
};

C.fontes = async () => {
  await garantir({ pronto: false });
  const r = await api('GET', '/api/fontes');
  const fs_ = (r.json && r.json.fontes) || [];
  if (MODO_JSON) return out(JSON.stringify(r.json));
  for (const f of fs_) out(`${f.id}  ${String(f.tipo).padEnd(8)} ${String(f.status).padEnd(8)} ${String(f.itens ?? 0).padStart(6)}  ${f.projeto || '—'}  ${f.caminho}`);
};

C.reconstruir = async () => {
  await garantir({ pronto: false });
  const r = await api('POST', '/api/reconstruir', {});
  if (MODO_JSON) return out(JSON.stringify(r.json || { ok: true }));
  out('reconstrução pedida. O cérebro redesenha quando terminar.');
};

// ----- skills do Claude Code (funcionam sem o servidor) -----
C.skills = async () => {
  const inst = require('./instalar.js');
  // sempre local: o que importa é o ~/.claude desta máquina (mesma lógica do /api/skills)
  const lista_ = inst.statusSkills();
  if (MODO_JSON) return out(JSON.stringify(lista_));
  out('SKILL                       NO CLAUDE CODE     EXECUTÁVEL  O QUE FAZ');
  for (const s of lista_) {
    const estado = { instalada: 'instalada', desatualizada: 'DESATUALIZADA', 'nao-instalada': 'não instalada' }[s.status] || (s.instalada ? 'instalada' : 'não instalada');
    out(`${String(s.nome).padEnd(27)} ${estado.padEnd(18)} ${(s.executavel ? 'sim' : '—').padEnd(11)} ${corta(s.titulo || s.descricao || '', 60)}`);
  }
  out('\ninstalar/atualizar: cortex skill instalar [nome|todas] · remover: cortex skill remover <nome> · rodar: cortex executar <skill> --projeto X');
};

C.skill = async (pos, op) => {
  const inst = require('./instalar.js');
  const acao = pos[0], nome = pos[1];
  if (acao === 'instalar') {
    if (!nome || nome === 'todas') {
      const res = inst.instalar({ silencioso: false });
      if (MODO_JSON) out(JSON.stringify(res));
      return;
    }
    let feito;
    try { feito = inst.instalarSkills(nome); } catch (e) { falhar(e.message); }
    if (MODO_JSON) return out(JSON.stringify({ ok: true, feito }));
    out(feito.length ? feito.map((f) => 'instalada: ' + f).join('\n') : `skill ${nome} já estava em dia.`);
    return;
  }
  if (acao === 'remover') {
    if (!nome) falhar('uso: cortex skill remover <nome>');
    let ok;
    try { ok = inst.removerSkill(nome); } catch (e) { falhar(e.message); }
    if (MODO_JSON) return out(JSON.stringify({ ok: !!ok }));
    out(ok ? `skill ${nome} removida do Claude Code.` : `skill ${nome} não estava instalada.`);
    return;
  }
  falhar('uso: cortex skill instalar [nome|todas] · cortex skill remover <nome> · cortex skills');
};

// roda uma skill executável no servidor (determinística, sem IA)
C.executar = async (pos, op) => {
  const nome = pos[0];
  if (!nome) falhar('uso: cortex executar <skill> --projeto X [--gravar] [--dias N]   (veja "cortex skills")');
  await garantir();
  const corpo = {};
  const proj = op.projeto && op.projeto !== true ? String(op.projeto) : pos[1];
  if (proj) corpo.projeto = proj;
  if (op.gravar) corpo.gravar = true;
  if (op.dias !== undefined && op.dias !== true) corpo.dias = Number(op.dias);
  for (const [k, v] of Object.entries(op)) if (!['projeto', 'gravar', 'dias', 'json'].includes(k)) corpo[k] = v;
  const r = await api('POST', '/api/skills/' + encodeURIComponent(nome) + '/executar', corpo);
  const j = r.json || {};
  if (MODO_JSON) return out(JSON.stringify(j));
  out(j.markdown || r.texto || JSON.stringify(j, null, 2));
  if (j.registradoEm) {
    const reg = typeof j.registradoEm === 'object' ? j.registradoEm : { id: j.registradoEm };
    out(`\ngravado no diário: ${curto(reg) || reg.id || ''}${reg.caminho ? ' · ' + reg.caminho : ''}`);
  }
};

// verifica sem ligar nada: código de saída 0 = rodando, 1 = fora do ar (usado pelo abrir-cortex.bat)
C.ping = async () => {
  const st = await vivo();
  if (MODO_JSON) out(JSON.stringify({ rodando: !!st, url: BASE }));
  else out(st ? `rodando em ${BASE}` : `fora do ar (${BASE})`);
  process.exit(st ? 0 : 1);
};

C.parar = async () => {
  // sem endpoint de desligar: informa como parar
  out('feche a janela do servidor (ou finalize o processo node server/index.js).');
};

const AJUDA = `CÓRTEX — segundo cérebro local (${BASE})

  cortex status [--esperar]           rodando? versão do grafo, projetos (--esperar: até ficar pronto)
  cortex abrir [projeto]              abre o navegador (já filtrado no projeto)
  cortex projetos                     lista os projetos e a atividade
  cortex resumo [projeto] [--dias N | --tudo]  resumo em markdown para ler como contexto
  cortex listar [--projeto X] [--desde 7d] [--tipos commit,sessao] [--fontes git] [--limite N]
  cortex buscar "<texto>" [--projeto X] (2+ caracteres)
  cortex no <id|título> [--completo]  id = idCurto (6), id longo (16) ou hash git
  cortex mostrar <projeto|visão|tudo> [--fontes git,claude] [--tipos nota,commit]
                 [--desde 7d] [--tags a,b] [--texto x] [--vizinhos 1] [--abrir]
  cortex registrar --projeto X --titulo "..." --texto "..." [--tags a,b] [--ligar id1,id2]
  cortex conectar <obsidian|git|claude|pasta> "<caminho>" [--projeto X]
  cortex fontes                       fontes conectadas e status
  cortex reconstruir
  cortex skills                       skills do Claude Code e se estão instaladas
  cortex skill instalar [nome|todas]  instala/atualiza skills (todas = também comando, PATH e CLAUDE.md)
  cortex skill remover <nome>
  cortex executar <skill> --projeto X [--gravar] [--dias N]
                                      roda no servidor, sem IA: cortex-contexto, cortex-onde-parei,
                                      cortex-revisao-semanal, cortex-ligacoes

  --json em qualquer comando devolve JSON para máquinas.`;

(async () => {
  const { pos, op } = parse(process.argv.slice(2));
  MODO_JSON = !!op.json;
  const cmd = (pos.shift() || 'ajuda').toLowerCase();
  const alias = { run: 'executar', rodar: 'executar', list: 'listar', ls: 'listar', help: 'ajuda', '-h': 'ajuda', '--help': 'ajuda', open: 'abrir', search: 'buscar', node: 'no', 'nó': 'no', show: 'mostrar', log: 'registrar', connect: 'conectar', rebuild: 'reconstruir', projects: 'projetos', summary: 'resumo' };
  const nome = alias[cmd] || cmd;
  if (nome === 'ajuda') return out(AJUDA);
  if (!C[nome]) falhar(`comando desconhecido: ${cmd}\n\n${AJUDA}`);
  await C[nome](pos, op);
})().catch((e) => falhar(e && e.message ? e.message : String(e)));
