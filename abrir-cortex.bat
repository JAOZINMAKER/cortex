@echo off
chcp 65001 >nul
title CORTEX
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [CORTEX] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra de novo.
  pause
  exit /b 1
)

if not exist "node_modules\three" (
  echo [CORTEX] Primeira execucao: instalando dependencias com versao fixa...
  call npm ci --no-audit --no-fund || call npm install --no-audit --no-fund
)

rem comando "cortex", PATH, skill do Claude Code e CLAUDE.md (so imprime quando muda algo)
node instalar.js --silencioso

rem ja esta rodando? so abre o navegador
node cli.js ping >nul 2>nul
if not errorlevel 1 (
  echo [CORTEX] Ja esta ligado. Abrindo o navegador.
  node cli.js abrir
  timeout /t 3 >nul
  exit /b 0
)

echo [CORTEX] Ligando a maquina. Esta janela mostra o log; feche para desligar.
node server\index.js --abrir
pause
