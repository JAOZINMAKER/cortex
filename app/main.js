'use strict';
/*
 * CÓRTEX — casca de desktop (Electron).
 * - Roda o servidor DENTRO deste processo (server/index.js exporta iniciar(); se não exportar, o require já o liga).
 * - Dados do usuário em %APPDATA%\CORTEX (config, data/, diario/, .env), fora da pasta do app.
 * - Instância única, janela sem moldura, bandeja, fechar para a bandeja, iniciar com o sistema, atalho global.
 * - Se já existir um CÓRTEX respondendo na porta, apenas conecta nele.
 * Argumentos: --escondido (sobe só na bandeja; usado pelo CLI e pelo "iniciar com o Windows").
 * Variáveis: CORTEX_CONFIG, CORTEX_DATA, PORT (testes), CORTEX_DEV=1 (DevTools).
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, globalShortcut, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const APP_DIR = path.resolve(__dirname, '..');
const ICONES = path.join(__dirname, 'icones');
const ESCONDIDO = process.argv.includes('--escondido');
const DEV = !!process.env.CORTEX_DEV;

// fundo por tema (evita flash branco antes da página carregar)
const FUNDOS = { grafite: '#0c0c0b', ambar: '#0a0806', mono: '#0a0a0a', violeta: '#0b0a10' };

// ---------------------------------------------------------------- caminhos
const DADOS = process.env.CORTEX_DADOS_APP
  ? path.resolve(process.env.CORTEX_DADOS_APP)
  : path.join(app.getPath('appData'), 'CORTEX');
const CONFIG_PATH = process.env.CORTEX_CONFIG ? path.resolve(process.env.CORTEX_CONFIG) : path.join(DADOS, 'cortex.config.json');
const DATA_DIR = process.env.CORTEX_DATA ? path.resolve(process.env.CORTEX_DATA) : path.join(DADOS, 'data');
const ESTADO_JANELA = path.join(DADOS, 'janela.json');

function lerJson(p, padrao) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return padrao; } }
function gravarJson(p, v) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); } catch { /* best-effort */ } }

// Migração de instalações antigas (dados ao lado do app) é feita pelo servidor em iniciar().

// ---------------------------------------------------------------- http local
let PORTA = Number(process.env.PORT) || Number(lerJson(CONFIG_PATH, {}).porta) || 4747;
const URL_BASE = () => `http://127.0.0.1:${PORTA}`;

function req(metodo, rota, corpo, tempo = 2500) {
  return new Promise((resolve) => {
    const dados = corpo ? Buffer.from(JSON.stringify(corpo)) : null;
    const r = http.request({ host: '127.0.0.1', port: PORTA, path: rota, method: metodo, timeout: tempo,
      headers: dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {} }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* não-JSON */ } resolve({ ok: res.statusCode < 400, codigo: res.statusCode, json: j }); });
    });
    r.on('error', () => resolve({ ok: false, codigo: 0, json: null }));
    r.on('timeout', () => { r.destroy(); resolve({ ok: false, codigo: 0, json: null }); });
    if (dados) r.write(dados);
    r.end();
  });
}
const ehCortex = async () => { const r = await req('GET', '/api/status', null, 1500); return r.ok && r.json && ('fase' in r.json || 'versao' in r.json); };
async function esperarHttp(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await ehCortex()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

// ---------------------------------------------------------------- servidor
let servidorInterno = null; // { parar? }
let modo = 'interno';

async function ligarServidor() {
  if (await ehCortex()) { modo = 'externo'; return; }
  fs.mkdirSync(DADOS, { recursive: true });
  // compatível com servidores antigos, que só liam variáveis de ambiente
  process.env.CORTEX_CONFIG = CONFIG_PATH;
  process.env.CORTEX_DATA = DATA_DIR;
  process.env.CORTEX_DADOS = DADOS;
  process.env.PORT = String(PORTA);
  const srv = require(path.join(APP_DIR, 'server', 'index.js'));
  if (srv && typeof srv.iniciar === 'function') {
    try {
      const r = await srv.iniciar({ porta: PORTA, dadosDir: DADOS, configPath: CONFIG_PATH, appDir: APP_DIR });
      if (r && r.porta) PORTA = r.porta;
      servidorInterno = r || {};
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') {
        if (await esperarHttp(5000)) { modo = 'externo'; return; } // outro CÓRTEX subiu ao mesmo tempo
        throw new Error(`A porta ${PORTA} está ocupada por outro programa.\nTroque "porta" em ${CONFIG_PATH} e abra de novo.`);
      }
      throw e;
    }
  } else {
    servidorInterno = {}; // servidor antigo: o require já liga e escuta em PORT
  }
  if (!(await esperarHttp(30000))) throw new Error(`o servidor não respondeu em ${URL_BASE()}`);
}

// ---------------------------------------------------------------- config da casca (seção "geral" de /api/config)
let geral = { fecharParaBandeja: true, iniciarComSistema: false, atalho: 'Ctrl+Alt+C' };
let atalhoRegistrado = null;

function normalizarGeral(g) {
  if (!g || typeof g !== 'object') return geral;
  const pick = (...ks) => { for (const k of ks) if (g[k] !== undefined) return g[k]; return undefined; };
  const fechar = pick('fecharParaBandeja', 'fecharBandeja', 'minimizarParaBandeja');
  const iniciar = pick('iniciarComWindows', 'iniciarComSistema', 'iniciarComOSistema', 'autoIniciar');
  const atalho = pick('atalhoGlobal', 'atalho');
  return {
    fecharParaBandeja: fechar === undefined ? geral.fecharParaBandeja : !!fechar,
    iniciarComSistema: iniciar === undefined ? geral.iniciarComSistema : !!iniciar,
    atalho: typeof atalho === 'string' ? atalho : geral.atalho,
  };
}

function aplicarGeral(novo) {
  const antes = geral;
  geral = novo;
  if (process.platform !== 'linux' && app.isPackaged && antes.iniciarComSistema !== novo.iniciarComSistema) {
    try { app.setLoginItemSettings({ openAtLogin: novo.iniciarComSistema, args: ['--escondido'] }); } catch { /* sem permissão */ }
  }
  if (novo.atalho !== atalhoRegistrado) registrarAtalho(novo.atalho);
}

function acelerador(txt) {
  return String(txt || '').split('+').map((p) => p.trim()).filter(Boolean)
    .map((p) => ({ ctrl: 'Control', control: 'Control', cmd: 'Command', alt: 'Alt', shift: 'Shift', win: 'Super', super: 'Super' }[p.toLowerCase()] || (p.length === 1 ? p.toUpperCase() : p)))
    .join('+');
}
function registrarAtalho(txt) {
  try { if (atalhoRegistrado) globalShortcut.unregister(acelerador(atalhoRegistrado)); } catch { /* ok */ }
  atalhoRegistrado = null;
  if (!txt) return;
  try { if (globalShortcut.register(acelerador(txt), alternarJanela)) atalhoRegistrado = txt; } catch { /* atalho inválido ou em uso */ }
}

async function sincronizarConfig() {
  const r = await req('GET', '/api/config');
  if (r.ok && r.json) aplicarGeral(normalizarGeral(r.json.geral || r.json));
  const a = await req('GET', '/api/ajustes');
  if (a.ok && a.json && janela && !janela.isDestroyed()) {
    const tema = (a.json.ajustes || a.json).tema;
    if (FUNDOS[tema]) janela.setBackgroundColor(FUNDOS[tema]);
  }
}

// ---------------------------------------------------------------- janela
let janela = null;
let tray = null;
let saindo = false;

function splash(msg) {
  const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0c0c0b;color:#ece8df;font:600 12px/1.4 ui-monospace,Consolas,monospace;letter-spacing:.08em;-webkit-app-region:drag}
  .c{position:absolute;inset:0;display:grid;place-items:center}.b{border:1px solid #33312c;padding:28px 36px;min-width:360px}
  h1{font-size:44px;margin:0 0 10px;letter-spacing:.02em}h1 i{display:inline-block;width:.45em;height:.8em;background:#ff6a2b;margin-left:6px;animation:p 1s steps(1) infinite}
  @keyframes p{50%{opacity:0}}p{margin:0;color:#8f8a80}</style><div class="c"><div class="b"><h1>CÓRTEX<i></i></h1><p>${msg}</p></div></div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function criarJanela() {
  const est = lerJson(ESTADO_JANELA, null);
  const tema = (lerJson(path.join(DATA_DIR, 'ajustes.json'), {}) || {}).tema;
  janela = new BrowserWindow({
    width: est && est.bounds ? est.bounds.width : 1600,
    height: est && est.bounds ? est.bounds.height : 1000,
    x: est && est.bounds ? est.bounds.x : undefined,
    y: est && est.bounds ? est.bounds.y : undefined,
    minWidth: 960, minHeight: 600,
    frame: false, show: false, backgroundColor: FUNDOS[tema] || FUNDOS.grafite,
    title: 'CÓRTEX', icon: path.join(ICONES, process.platform === 'win32' ? 'icone.ico' : 'icone.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: DEV, backgroundThrottling: false,
      additionalArguments: [`--cortex-versao=${app.getVersion()}`] },
  });
  janela.once('ready-to-show', () => {
    if (ESCONDIDO) return;
    if (!est || est.maximizado) janela.maximize();
    janela.show();
  });
  const salvar = () => {
    if (!janela || janela.isDestroyed() || janela.isMinimized()) return;
    gravarJson(ESTADO_JANELA, { maximizado: janela.isMaximized(), bounds: janela.isMaximized() ? (lerJson(ESTADO_JANELA, {}) || {}).bounds || janela.getNormalBounds() : janela.getBounds() });
  };
  let t = null;
  const salvarDepois = () => { clearTimeout(t); t = setTimeout(salvar, 400); };
  janela.on('resize', salvarDepois);
  janela.on('move', salvarDepois);
  const avisar = () => { if (janela && !janela.isDestroyed()) janela.webContents.send('janela:estado', { maximizada: janela.isMaximized(), focada: janela.isFocused() }); };
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen']) janela.on(ev, () => { salvarDepois(); avisar(); });

  janela.on('close', (e) => {
    salvar();
    if (!saindo && geral.fecharParaBandeja && tray) { e.preventDefault(); janela.hide(); }
  });

  // links externos → navegador do sistema; nada de navegar para fora do CÓRTEX dentro da janela
  const ehLocal = (u) => u.startsWith(URL_BASE()) || u.startsWith('data:');
  janela.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url) && !ehLocal(url)) shell.openExternal(url); return { action: 'deny' }; });
  janela.webContents.on('will-navigate', (e, url) => { if (!ehLocal(url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  janela.webContents.on('before-input-event', (e, inp) => {
    if (inp.type !== 'keyDown') return;
    if ((inp.control || inp.meta) && inp.key.toLowerCase() === 'r') { janela.webContents.reload(); e.preventDefault(); }
    if (DEV && inp.key === 'F12') { janela.webContents.toggleDevTools(); e.preventDefault(); }
  });
  janela.webContents.on('did-finish-load', () => { setTimeout(injetarBarraReserva, 2000); avisar(); });
  janela.loadURL(splash('LIGANDO A MÁQUINA…')).catch(() => {}); // abortado ao trocar para a interface: normal
}

// Se a interface ainda não desenha a própria barra de título (marcador [data-cortex-titulo]),
// injeta uma barra mínima arrastável com minimizar/maximizar/fechar — uma janela sem moldura nunca fica presa.
function injetarBarraReserva() {
  if (!janela || !janela.webContents.getURL().startsWith('http')) return;
  janela.webContents.executeJavaScript(`(() => {
    if (document.querySelector('[data-cortex-titulo]') || document.getElementById('cortex-barra-reserva')) return;
    // a interface já tem uma barra arrastável no topo? (-webkit-app-region: drag em algo na faixa de 12px)
    const arrasta = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const r = getComputedStyle(e).webkitAppRegion || getComputedStyle(e).getPropertyValue('-webkit-app-region'); if (r === 'drag') return true; if (r === 'no-drag') return false; } return false; };
    if ([0.25, 0.5, 0.75].some((f) => document.elementsFromPoint(innerWidth * f, 6).some(arrasta))) return;
    const b = document.createElement('div'); b.id = 'cortex-barra-reserva'; b.setAttribute('data-cortex-titulo', 'reserva');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;height:6px;z-index:2147483646;-webkit-app-region:drag';
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;display:flex;-webkit-app-region:no-drag;font:600 11px ui-monospace,Consolas,monospace';
    const btn = (t, f, perigo) => { const e = document.createElement('button'); e.textContent = t; e.onclick = f;
      e.style.cssText = 'all:unset;cursor:default;width:34px;height:22px;display:grid;place-items:center;color:var(--texto,#ece8df);background:var(--painel,#141413);border-left:1px solid var(--linha,#33312c);border-bottom:1px solid var(--linha,#33312c)';
      e.onmouseenter = () => e.style.background = perigo ? 'var(--acento,#ff6a2b)' : 'var(--linha,#33312c)'; e.onmouseleave = () => e.style.background = 'var(--painel,#141413)'; return e; };
    const j = window.cortexApp && window.cortexApp.janela; if (!j) return;
    c.append(btn('—', j.min), btn('□', j.max), btn('✕', j.fechar, true));
    document.body.append(b, c);
  })()`).catch(() => {});
}

function mostrarJanela() {
  if (!janela || janela.isDestroyed()) criarJanela();
  if (janela.isMinimized()) janela.restore();
  if (!janela.isVisible()) { const est = lerJson(ESTADO_JANELA, null); if (!est || est.maximizado) janela.maximize(); janela.show(); }
  janela.focus();
}
function alternarJanela() {
  if (janela && janela.isVisible() && janela.isFocused()) janela.hide(); else mostrarJanela();
}

// ---------------------------------------------------------------- bandeja
let projetosBandeja = [];
let vigilanciaSuportada = false;
let vigilanciaPausada = false;

async function atualizarProjetosBandeja() {
  const r = await req('GET', '/api/projetos');
  if (r.ok && r.json && Array.isArray(r.json.projetos)) projetosBandeja = r.json.projetos.map((p) => p.nome).filter(Boolean).slice(0, 30);
  const v = await req('GET', '/api/vigilancia');
  vigilanciaSuportada = v.ok && v.json != null;
  if (vigilanciaSuportada) vigilanciaPausada = !!(v.json.pausada);
  montarMenuBandeja();
}

async function mostrarProjeto(nome) {
  await req('POST', '/api/visao/atual', { nome: `SÓ ${String(nome).toUpperCase()}`, projetos: [nome] });
  mostrarJanela();
  if (janela) janela.webContents.send('bandeja', { acao: 'projeto', projeto: nome });
}

function montarMenuBandeja() {
  if (!tray) return;
  const itens = [
    { label: 'Abrir CÓRTEX', click: mostrarJanela },
    { label: 'Mostrar projeto', submenu: projetosBandeja.length ? [
      { label: 'Tudo', click: async () => { await req('POST', '/api/visao/atual', { id: 'tudo' }); mostrarJanela(); } },
      { type: 'separator' },
      ...projetosBandeja.map((n) => ({ label: n, click: () => mostrarProjeto(n) })),
    ] : [{ label: '(carregando…)', enabled: false }] },
    { type: 'separator' },
    { label: 'Reconstruir', click: async () => { await req('POST', '/api/reconstruir', {}); notificar('CÓRTEX', 'Reconstruindo o cérebro.'); } },
  ];
  if (vigilanciaSuportada) {
    itens.push({ label: vigilanciaPausada ? 'Retomar vigilância' : 'Pausar vigilância', click: async () => {
      const r = await req('POST', '/api/vigilancia', { pausada: !vigilanciaPausada });
      if (r.ok) vigilanciaPausada = !vigilanciaPausada;
      montarMenuBandeja();
    } });
  }
  itens.push(
    { label: 'Abrir pasta de dados', click: () => shell.openPath(DADOS) },
    { type: 'separator' },
    { label: modo === 'externo' ? `Conectado a ${URL_BASE()}` : `Porta ${PORTA}`, enabled: false },
    { label: 'Sair', click: () => { saindo = true; app.quit(); } },
  );
  tray.setContextMenu(Menu.buildFromTemplate(itens));
}

function criarBandeja() {
  const arq = process.platform === 'win32' ? 'bandeja.ico' : 'bandeja.png';
  let img = nativeImage.createFromPath(path.join(ICONES, arq));
  if (process.platform !== 'win32') { const x2 = path.join(ICONES, 'bandeja@2x.png'); if (fs.existsSync(x2)) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(x2) }); }
  try { tray = new Tray(img); } catch { tray = null; return; } // ambiente sem bandeja
  tray.setToolTip('CÓRTEX — segundo cérebro local');
  tray.on('click', alternarJanela);
  tray.on('right-click', () => atualizarProjetosBandeja());
  montarMenuBandeja();
}

function notificar(titulo, corpo) {
  try { if (Notification.isSupported()) new Notification({ title: titulo, body: corpo, icon: path.join(ICONES, 'icone.png') }).show(); } catch { /* ok */ }
}

// Gancho de teste: CORTEX_PRINT=<arquivo.png> espera a interface montar, salva um print da janela e sai.
function printDeTeste(arquivo) {
  const espera = Number(process.env.CORTEX_PRINT_ESPERA || 15000);
  setTimeout(async () => {
    try {
      const info = await janela.webContents.executeJavaScript(`(async () => ({ temApp: !!window.cortexApp, versao: window.cortexApp && window.cortexApp.versao, plataforma: window.cortexApp && window.cortexApp.plataforma, barra: (document.querySelector('[data-cortex-titulo]') || {}).getAttribute ? document.querySelector('[data-cortex-titulo]').getAttribute('data-cortex-titulo') : null, titulo: document.title }))()`);
      console.log('[CASCA] teste', JSON.stringify({ ...info, modo, porta: PORTA, maximizada: janela.isMaximized(), bounds: janela.getBounds() }));
      const img = await janela.webContents.capturePage();
      fs.writeFileSync(arquivo, img.toPNG());
      console.log('[CASCA] print salvo em', arquivo);
    } catch (e) { console.log('[CASCA] falha no print', e && e.message); }
    saindo = true; app.quit();
  }, espera);
}

// ---------------------------------------------------------------- IPC (preload)
ipcMain.handle('janela:min', () => { if (janela) janela.minimize(); });
ipcMain.handle('janela:max', () => { if (!janela) return false; if (janela.isMaximized()) janela.unmaximize(); else janela.maximize(); return janela.isMaximized(); });
ipcMain.handle('janela:fechar', () => { if (janela) janela.close(); });
ipcMain.handle('janela:estado', () => (janela ? { maximizada: janela.isMaximized(), focada: janela.isFocused() } : null));
ipcMain.handle('dialogo:pasta', async (_e, opcoes = {}) => {
  const r = await dialog.showOpenDialog(janela, { title: opcoes.titulo || 'Escolher pasta', defaultPath: opcoes.inicio || os.homedir(), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('abrir:caminho', async (_e, alvo) => {
  if (typeof alvo !== 'string' || !alvo) return false;
  if (/^https?:\/\//i.test(alvo)) { await shell.openExternal(alvo); return true; }
  if (!fs.existsSync(alvo)) return false;
  return (await shell.openPath(alvo)) === '';
});
ipcMain.handle('mostrar:no-explorador', (_e, alvo) => { if (typeof alvo === 'string' && fs.existsSync(alvo)) { shell.showItemInFolder(alvo); return true; } return false; });
ipcMain.handle('app:info', () => ({ versao: app.getVersion(), plataforma: process.platform, modo, porta: PORTA, dados: DADOS, appDir: APP_DIR, exe: process.execPath, empacotado: app.isPackaged }));
ipcMain.handle('app:config-mudou', () => sincronizarConfig()); // a interface avisa após salvar /api/config
ipcMain.handle('app:sair', () => { saindo = true; app.quit(); });

// ---------------------------------------------------------------- ciclo de vida
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => { if (!argv.includes('--escondido')) mostrarJanela(); });
  app.setAppUserModelId('local.cortex.app');
  Menu.setApplicationMenu(null);

  // O app rodando de dentro de uma pasta sincronizada (OneDrive etc.) trava arquivos entre os PCs.
  function avisarPastaSincronizada() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const aqui = path.dirname(process.execPath).toLowerCase();
    const nuvens = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(os.homedir(), 'Dropbox'), path.join(os.homedir(), 'Google Drive')]
      .filter(Boolean).map((x) => x.toLowerCase());
    if (!nuvens.some((n) => aqui.startsWith(n)) && !/\\onedrive|\\dropbox|google drive/.test(aqui)) return;
    const bat = path.join(path.dirname(process.execPath), 'Instalar CORTEX.bat');
    const r = dialog.showMessageBoxSync(janela, { type: 'warning', title: 'CÓRTEX', buttons: ['Instalar agora', 'Depois'], defaultId: 0, cancelId: 1,
      message: 'O CÓRTEX está rodando de dentro de uma pasta sincronizada.',
      detail: 'Isso faz os seus PCs disputarem os arquivos do programa (erro "pasta em uso"). Clique em "Instalar agora" para copiar o app para uma pasta local deste PC. A sincronização do cérebro continua funcionando normalmente.' });
    if (r === 0 && fs.existsSync(bat)) { shell.openPath(bat); saindo = true; setTimeout(() => app.quit(), 500); }
  }

  app.whenReady().then(async () => {
    criarJanela();
    criarBandeja();
    try {
      await ligarServidor();
    } catch (e) {
      dialog.showErrorBox('CÓRTEX', `Não consegui ligar o servidor.\n\n${e && e.message ? e.message : e}`);
      saindo = true;
      app.quit();
      return;
    }
    await janela.loadURL(URL_BASE() + '/').catch(() => {});
    avisarPastaSincronizada();
    if (process.env.CORTEX_PRINT) printDeTeste(process.env.CORTEX_PRINT);
    await sincronizarConfig();
    atualizarProjetosBandeja();
    setInterval(sincronizarConfig, 5000).unref();
    setInterval(atualizarProjetosBandeja, 60000).unref();
  });

  app.on('before-quit', () => { saindo = true; });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try { if (servidorInterno && typeof servidorInterno.parar === 'function') servidorInterno.parar(); } catch { /* saindo */ }
  });
}
