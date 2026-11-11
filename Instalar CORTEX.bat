@echo off
chcp 65001 >nul
setlocal
title CORTEX - instalacao
cd /d "%~dp0"

set "EXE=%~dp0CORTEX.exe"
set "APPDIR=%~dp0resources\app"
set "ICONE=%~dp0CORTEX.ico"

if not exist "%EXE%" (
  echo [CORTEX] Nao achei o CORTEX.exe nesta pasta. Extraia o zip inteiro e rode este arquivo de dentro dela.
  pause
  exit /b 1
)

echo [CORTEX] Criando atalhos na Area de Trabalho e no Menu Iniciar...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell;" ^
  "$destinos = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'));" ^
  "foreach ($d in $destinos) { if (-not $d) { continue }; $l = $s.CreateShortcut((Join-Path $d 'CORTEX.lnk'));" ^
  "  $l.TargetPath = $env:EXE; $l.WorkingDirectory = (Split-Path $env:EXE); $l.IconLocation = $env:ICONE + ',0';" ^
  "  $l.Description = 'CORTEX - segundo cerebro local'; $l.Save() }"
if errorlevel 1 echo [CORTEX] Aviso: nao consegui criar os atalhos. O app funciona mesmo assim pelo CORTEX.exe.

echo [CORTEX] Instalando o comando "cortex", as skills do Claude Code e o aviso no CLAUDE.md...
set "ELECTRON_RUN_AS_NODE=1"
"%EXE%" "%APPDIR%\instalar.js" --exe "%EXE%"
set "ELECTRON_RUN_AS_NODE="

echo.
echo [CORTEX] Pronto. Abrindo o CORTEX.
echo [CORTEX] Terminais abertos daqui pra frente ja reconhecem o comando "cortex".
start "" "%EXE%"
timeout /t 4 >nul
