#!/usr/bin/env node
'use strict';
// CÓRTEX — instalador idempotente. Roda a cada abertura do abrir-cortex.bat e em "cortex skill instalar".
//  1. comando `cortex` (Windows: %USERPROFILE%\.cortex\bin\cortex.cmd + script sh para Git Bash; Linux/mac: ~/.local/bin/cortex)
//  2. essa pasta no PATH do usuário (Windows: HKCU\Environment via reg, preservando o valor existente)
//  3. skill do Claude Code em ~/.claude/skills/cortex/SKILL.md (com o caminho real da instalação)
//  4. bloco curto entre marcadores em ~/.claude/CLAUDE.md
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

function escreverSeMudou(arquivo, conteudo, modo) {
  let atual = null;
  try { atual = fs.readFileSync(arquivo, 'utf8'); } catch { /* novo */ }
  if (atual === conteudo) return false;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo, modo ? { mode: modo } : undefined);
  if (modo) { try { fs.chmodSync(arquivo, modo); } catch { /* windows */ } }
  return true;
}

function pastaBin(home) {
  return WIN ? path.join(home, '.cortex', 'bin') : path.join(home, '.local', 'bin');
}

function instalarComando(home, feito) {
  const bin = pastaBin(home);
  const cli = path.join(ROOT, 'cli.js');
  if (WIN) {
    if (escreverSeMudou(path.join(bin, 'cortex.cmd'), `@echo off\r\nnode "${cli}" %*\r\n`)) feito.push(`comando criado: ${path.join(bin, 'cortex.cmd')}`);
    // Git Bash procura "cortex" sem extensão no PATH
    if (escreverSeMudou(path.join(bin, 'cortex'), `#!/bin/sh\nexec node "${barra(cli)}" "$@"\n`, 0o755)) feito.push(`comando para Git Bash: ${path.join(bin, 'cortex')}`);
  } else {
    if (escreverSeMudou(path.join(bin, 'cortex'), `#!/bin/sh\nexec node "${cli}" "$@"\n`, 0o755)) feito.push(`comando criado: ${path.join(bin, 'cortex')}`);
  }
  return bin;
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
      avisos.push(`não consegui adicionar ${bin} ao PATH (${e.message}). Use: node "${path.join(ROOT, 'cli.js')}"`);
    }
    return;
  }
  const no = (process.env.PATH || '').split(':').some((p) => normal(p) === normal(bin));
  if (!no) avisos.push(`${bin} não está no seu PATH. Adicione ao ~/.bashrc ou ~/.zshrc:  export PATH="$HOME/.local/bin:$PATH"`);
}

// ----- skill e CLAUDE.md -----
function instalarSkill(home, feito, avisos) {
  const origem = path.join(ROOT, 'skill', 'cortex', 'SKILL.md');
  let txt;
  try { txt = fs.readFileSync(origem, 'utf8'); } catch { avisos.push(`skill não encontrada em ${origem}`); return; }
  txt = txt.split('{{CORTEX_DIR}}').join(barra(ROOT));
  const destino = path.join(home, '.claude', 'skills', 'cortex', 'SKILL.md');
  if (escreverSeMudou(destino, txt)) feito.push(`skill do Claude Code: ${destino}`);
}

function blocoClaudeMd() {
  const cli = barra(path.join(ROOT, 'cli.js'));
  return [
    MARCA_INI,
    '## CÓRTEX (segundo cérebro local do usuário)',
    `- "córtex" ou "cortex" é o app local do usuário em \`${barra(ROOT)}\`: junta notas do Obsidian, repositórios git, sessões do Claude Code e pastas num cérebro 3D.`,
    '- Quando o usuário citar o córtex, pedir contexto do que já foi feito num projeto, pedir para mostrar algo no cérebro ou para registrar o trabalho: use a skill `cortex`.',
    `- Comando: \`cortex <comando>\` (ou \`node "${cli}" <comando>\` se \`cortex\` não estiver no PATH). \`cortex ajuda\` lista tudo.`,
    '- O córtex só lê os cofres do usuário; para registrar trabalho use `cortex registrar`, nunca edite `data/` à mão.',
    MARCA_FIM,
  ].join('\n');
}

function atualizarClaudeMd(home, feito) {
  const arq = path.join(home, '.claude', 'CLAUDE.md');
  let atual = '';
  try { atual = fs.readFileSync(arq, 'utf8'); } catch { /* novo */ }
  const bloco = blocoClaudeMd();
  const eol = atual.includes('\r\n') ? '\r\n' : '\n';
  const blocoEol = bloco.split('\n').join(eol);
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

function instalar({ silencioso = false } = {}) {
  const home = os.homedir();
  const feito = [], avisos = [];
  const bin = instalarComando(home, feito);
  garantirPath(bin, feito, avisos);
  instalarSkill(home, feito, avisos);
  atualizarClaudeMd(home, feito);
  if (!silencioso || feito.length || avisos.length) {
    if (!feito.length && !avisos.length) console.log('[córtex] instalação em dia: comando, PATH, skill e CLAUDE.md.');
    for (const f of feito) console.log('[córtex] ' + f);
    for (const a of avisos) console.log('[córtex] aviso: ' + a);
  }
  return { feito, avisos, bin, home };
}

module.exports = { instalar };

if (require.main === module) {
  instalar({ silencioso: process.argv.includes('--silencioso') });
}
