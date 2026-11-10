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

echo [CORTEX] Ligando a maquina em http://127.0.0.1:4747
start "" /min cmd /c "timeout /t 3 >nul & start http://127.0.0.1:4747"
node server\index.js
pause
