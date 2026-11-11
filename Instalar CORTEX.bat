@echo off
chcp 65001 >nul
setlocal
title CORTEX - instalacao

rem O app SEMPRE fica numa pasta local deste PC (nunca no OneDrive): pode rodar este arquivo de qualquer lugar,
rem inclusive de uma pasta sincronizada; ele copia tudo para %LOCALAPPDATA%\Programs\CORTEX.
set "ORIGEM=%~dp0"
if "%ORIGEM:~-1%"=="\" set "ORIGEM=%ORIGEM:~0,-1%"
set "DESTINO=%LOCALAPPDATA%\Programs\CORTEX"
set "EXE=%DESTINO%\CORTEX.exe"
set "ICONE=%DESTINO%\CORTEX.ico"

if not exist "%ORIGEM%\CORTEX.exe" (
  echo [CORTEX] Nao achei o CORTEX.exe ao lado deste arquivo. Extraia o zip inteiro e rode de dentro da pasta.
  pause
  exit /b 1
)

echo [CORTEX] Fechando o CORTEX se estiver aberto...
taskkill /F /IM CORTEX.exe >nul 2>nul
timeout /t 2 >nul

if /I "%ORIGEM%"=="%DESTINO%" (
  echo [CORTEX] Ja esta na pasta local. Pulando a copia.
) else (
  echo [CORTEX] Copiando o app para "%DESTINO%" ^(pasta local, fora do OneDrive^)...
  robocopy "%ORIGEM%" "%DESTINO%" /MIR /R:3 /W:2 /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo [CORTEX] Nao consegui copiar tudo. Feche janelas abertas na pasta do CORTEX e rode de novo.
    pause
    exit /b 1
  )
)

echo [CORTEX] Criando atalhos na Area de Trabalho e no Menu Iniciar...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell;" ^
  "$destinos = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'));" ^
  "foreach ($d in $destinos) { if (-not $d) { continue }; $l = $s.CreateShortcut((Join-Path $d 'CORTEX.lnk'));" ^
  "  $l.TargetPath = $env:EXE; $l.WorkingDirectory = (Split-Path $env:EXE); $l.IconLocation = $env:ICONE + ',0';" ^
  "  $l.Description = 'CORTEX - segundo cerebro local'; $l.Save() }"
if errorlevel 1 echo [CORTEX] Aviso: nao consegui criar os atalhos. O app funciona mesmo assim pelo CORTEX.exe.

echo [CORTEX] Instalando o comando "cortex", as skills do Claude Code e a sincronizacao...
set "ELECTRON_RUN_AS_NODE=1"
"%EXE%" "%DESTINO%\resources\app\instalar.js" --exe "%EXE%" --sync-auto
set "ELECTRON_RUN_AS_NODE="

echo.
echo [CORTEX] Pronto. App instalado em "%DESTINO%".
echo [CORTEX] Faca o mesmo nos outros PCs: todos usam a pasta OneDrive\CORTEX e viram um cerebro so.
echo [CORTEX] A pasta de onde voce rodou este arquivo pode ser apagada.
start "" "%EXE%"
timeout /t 6 >nul
