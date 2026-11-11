#!/usr/bin/env node
'use strict';
// CÓRTEX — instalador idempotente. Roda a cada abertura (abrir-cortex.bat / app) e em "cortex skill instalar".
//  1. comando `cortex` (Windows: %USERPROFILE%\.cortex\bin\cortex.cmd + script sh para Git Bash; Linux/mac: ~/.local/bin/cortex)
//     com --exe "<CORTEX.exe>" o comando roda o CLI pelo próprio app (ELECTRON_RUN_AS_NODE=1), sem precisar de Node instalado
//     (--dados "<pasta>" grava também a pasta de dados do app em app.json, para o CLI achar a config/porta)
//  2. essa pasta no PATH do usuário (Windows: HKCU\Environment via reg, preservando o valor existente)
//  3. TODAS as skills de skills/ em ~/.claude/skills/<nome>/SKILL.md (com caminhos reais)
//  4. bloco curto entre marcadores em ~/.claude/CLAUDE.md
//  5. ~/.cortex/app.json com o caminho do exe (o CLI usa para ligar o app escondido)
// Só escreve o que mudou. Com --silencioso, não imprime nada quando tudo já está em dia.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const WIN = process.platform === 'win32';
const MARCA_INI = '<!-- CORTEX:INICIO -->';
const MARCA_FIM = '<!-- CORTEX:FIM -->';

// Caminho com barras "/" funciona no Node, no Git Bash, no PowerShell e no cmd (entre aspas).
const barra = (p) => p.replace(/\\/g, '/');
// Git Bash: C:/x → /c/x (só para o script sh)
const posixBash = (p) => barra(p).replace(/^([A-Za-z]):\//, (_, d) => '/' + d.toLowerCase() + '/');

// CORTEX_HOME troca a home (testes), como no servidor
const homeDe = () => process.env.CORTEX_HOME || os.homedir();

function escreverSeMudou(arquivo, conteudo, modo) {
  let atual = null;
  try { atual = fs.readFileSync(arquivo, 'utf8'); } catch { /* novo */ }
  if (atual === conteudo) return false;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo, modo ? { mode: modo } : undefined);
  if (modo) { try { fs.chmodSync(arquivo, modo); } catch { /* windows */ } }
  return true;
}

const pastaBin = (home) => (WIN ? path.join(home, '.cortex', 'bin') : path.join(home, '.local', 'bin'));
const arquivoApp = (home) => path.join(home, '.cortex', 'app.json');

function lerApp(home) {
  try { return JSON.parse(fs.readFileSync(arquivoApp(home), 'utf8')); } catch { return null; }
}

// O exe do app: --exe explícito; ou este próprio processo, se rodando como CORTEX.exe em modo node; ou o já gravado.
function descobrirExe(opcoes, home) {
  if (opcoes.exe) return path.resolve(opcoes.exe);
  if (process.env.ELECTRON_RUN_AS_NODE && process.versions.electron) return process.execPath;
  const app = lerApp(home);
  if (app && app.exe && fs.existsSync(app.exe)) return app.exe;
  return null;
}

function instalarComando(home, exe, feito) {
  const bin = pastaBin(home);
  const cli = path.join(ROOT, 'cli.js');
  if (WIN) {
    const cmd = exe
      ? `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${cli}" %*\r\n`
      : `@echo off\r\nnode "${cli}" %*\r\n`;
    const sh = exe
      ? `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${posixBash(exe)}" "${barra(cli)}" "$@"\n`
      : `#!/bin/sh\nexec node "${barra(cli)}" "$@"\n`;
    if (escreverSeMudou(path.join(bin, 'cortex.cmd'), cmd)) feito.push(`comando ${exe ? '(pelo app)' : '(pelo node)'}: ${path.join(bin, 'cortex.cmd')}`);
    // Git Bash procura "cortex" sem extensão no PATH
    if (escreverSeMudou(path.join(bin, 'cortex'), sh, 0o755)) feito.push(`comando para Git Bash: ${path.join(bin, 'cortex')}`);
  } else {
    const sh = exe
      ? `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${cli}" "$@"\n`
      : `#!/bin/sh\nexec node "${cli}" "$@"\n`;
    if (escreverSeMudou(path.join(bin, 'cortex'), sh, 0o755)) feito.push(`comando ${exe ? '(pelo app)' : '(pelo node)'}: ${path.join(bin, 'cortex')}`);
  }
  return bin;
}

function gravarApp(home, exe, bin, feito, dadosDir) {
  if (!exe) return;
  let versao = null;
  try { versao = require('./package.json').version; } catch { /* sem package.json */ }
  const atual = lerApp(home) || {};
  const novo = { exe, appDir: ROOT, cli: path.join(ROOT, 'cli.js'), bin, versao, dadosDir: dadosDir || atual.dadosDir || null };
  const igual = ['exe', 'appDir', 'cli', 'bin', 'versao', 'dadosDir'].every((k) => atual[k] === novo[k]);
  if (igual) return;
  escreverSeMudou(arquivoApp(home), JSON.stringify({ ...novo, instaladoEm: new Date().toISOString() }, null, 2) + '\n');
  feito.push(`app registrado: ${arquivoApp(home)} → ${exe}`);
}

// ----- PATH do usuário -----
function lerPathWindows() {
  try {
    const s = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const m = /^\s*Path\s+(REG_EXPAND_SZ|REG_SZ)\s+(.*)$/mi.exec(s);
    if (m) return { tipo: m[1].toUpperCase(), valor: m[2].trim() };
  } catch { /* chave ainda não existe */ }
  return { tipo: 'REG_EXPAND_SZ', valor: '' };
}

const normal = (p) => p.trim().replace(/[\\/]+$/, '').toLowerCase();

function garantirPath(bin, feito, avisos) {
  if (WIN) {
    const { tipo, valor } = lerPathWindows();
    const partes = valor.split(';').filter(Boolean);
    if (partes.some((p) => normal(p) === normal(bin))) return;
    const novo = partes.concat(bin).join(';');
    try {
      execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', tipo, '/d', novo, '/f'], { windowsHide: true, stdio: 'ignore' });
      // setx dispara WM_SETTINGCHANGE (novos terminais enxergam o PATH) e de quebra deixa CORTEX_DIR definido
      try { execFileSync('setx', ['CORTEX_DIR', ROOT], { windowsHide: true, stdio: 'ignore' }); } catch { /* opcional */ }
      feito.push(`PATH do usuário: ${bin} adicionado (vale para terminais novos; reinicie o app do Claude para as sessões enxergarem)`);
    } catch (e) {
      avisos.push(`não consegui adicionar ${bin} ao PATH (${e.message}). Use o caminho completo: "${path.join(bin, 'cortex.cmd')}"`);
    }
    return;
  }
  const no = (process.env.PATH || '').split(':').some((p) => normal(p) === normal(bin));
  if (!no) avisos.push(`${bin} não está no seu PATH. Adicione ao ~/.bashrc ou ~/.zshrc:  export PATH="$HOME/.local/bin:$PATH"`);
}

// ----- skills -----
// A lógica é a do servidor (server/skills-instalar.js), a mesma usada por /api/skills e pela tela SKILLS do app.
const skillsMod = require('./server/skills-instalar.js');

function skillsDoApp() { return skillsMod.listar({ appDir: ROOT, home: homeDe() }).map((s) => s.nome); }

// [{ nome, titulo, descricao, executavel, parametros, versaoApp, versaoInstalada, instalada, status, caminho, origem }]
function statusSkills(home = homeDe()) { return skillsMod.listar({ appDir: ROOT, home }); }

// devolve as linhas do que mudou (vazio = já estava em dia)
function instalarSkills(alvo = 'todas', home = homeDe()) {
  const { resultados } = skillsMod.instalar(alvo, { appDir: ROOT, home });
  return resultados.filter((r) => r.mudou).map((r) => `skill ${r.nome}: ${path.join(r.caminho, 'SKILL.md')}`);
}

function removerSkill(nome, home = homeDe()) {
  const { resultados } = skillsMod.remover(nome, { appDir: ROOT, home });
  const r = resultados[0];
  if (r && !r.removida && r.motivo && !/não estava instalada/.test(r.motivo)) throw new Error(`${r.nome}: ${r.motivo}`);
  return !!(r && r.removida);
}

// ----- CLAUDE.md -----
function blocoClaudeMd(home) {
  const bin = barra(pastaBin(home));
  const outras = skillsDoApp().filter((n) => n !== 'cortex').map((n) => '`' + n + '`').join(', ');
  return [
    MARCA_INI,
    '## CÓRTEX (segundo cérebro local do usuário)',
    '- "córtex" ou "cortex" é o app local do usuário: junta notas do Obsidian, repositórios git, sessões do Claude Code e pastas num cérebro 3D.',
    '- **Quando o usuário falar em córtex, use a skill `cortex`.** Para pedidos específicos há skills próprias: ' + outras + '.',
    '- Comando: `cortex <comando>` (`cortex ajuda` lista tudo). Se não estiver no PATH: `"' + bin + '/cortex"` (Git Bash) ou `& "' + bin + '/cortex.cmd"` (PowerShell).',
    '- O córtex só lê os cofres do usuário; para registrar trabalho use `cortex registrar` (skill `cortex-registrar`).',
    MARCA_FIM,
  ].join('\n');
}

function atualizarClaudeMd(home, feito) {
  const arq = path.join(home, '.claude', 'CLAUDE.md');
  let atual = '';
  try { atual = fs.readFileSync(arq, 'utf8'); } catch { /* novo */ }
  const eol = atual.includes('\r\n') ? '\r\n' : '\n';
  const blocoEol = blocoClaudeMd(home).split('\n').join(eol);
  let novo;
  const i = atual.indexOf(MARCA_INI), f = atual.indexOf(MARCA_FIM);
  if (i >= 0 && f > i) {
    novo = atual.slice(0, i) + blocoEol + atual.slice(f + MARCA_FIM.length);
  } else {
    const sep = atual.length === 0 ? '' : (atual.endsWith(eol) ? eol : eol + eol);
    novo = atual + sep + blocoEol + eol;
  }
  if (escreverSeMudou(arq, novo)) feito.push(`CLAUDE.md global: bloco do CÓRTEX ${i >= 0 ? 'atualizado' : 'adicionado'} em ${arq}`);
}

function instalar(opcoes = {}) {
  const { silencioso = false } = opcoes;
  const home = homeDe();
  const feito = [], avisos = [];
  const exe = descobrirExe(opcoes, home);
  if (opcoes.exe && !fs.existsSync(exe)) avisos.push(`--exe aponta para um arquivo que não existe: ${exe}`);
  const bin = instalarComando(home, exe, feito);
  gravarApp(home, exe, bin, feito, opcoes.dados ? path.resolve(opcoes.dados) : null);
  garantirPath(bin, feito, avisos);
  try { feito.push(...instalarSkills('todas', home)); } catch (e) { avisos.push(e.message); }
  atualizarClaudeMd(home, feito);
  if (!silencioso || feito.length || avisos.length) {
    if (!feito.length && !avisos.length) console.log('[córtex] instalação em dia: comando, PATH, skills e CLAUDE.md.');
    for (const f of feito) console.log('[córtex] ' + f);
    for (const a of avisos) console.log('[córtex] aviso: ' + a);
  }
  return { feito, avisos, bin, home, exe };
}

module.exports = { instalar, instalarSkills, removerSkill, statusSkills, skillsDoApp, lerApp, arquivoApp, pastaBin };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const valor = (nome) => {
    const i = argv.indexOf('--' + nome);
    if (i >= 0) return argv[i + 1];
    const a = argv.find((x) => x.startsWith('--' + nome + '='));
    return a ? a.slice(nome.length + 3) : undefined;
  };
  // --exe "<CORTEX.exe>": o comando roda pelo app · --dados "<pasta>": pasta de dados do app (%APPDATA%\CORTEX)
  instalar({ silencioso: argv.includes('--silencioso'), exe: valor('exe'), dados: valor('dados') });
}
