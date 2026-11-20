@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Instalar Gimnasio
rem Instala o actualiza la app en esta computadora. Hay que ejecutarlo como administrador.
rem Los datos viven en C:\Gimnasio y no se tocan al actualizar.

set "APP=%~dp0"
set "BASE=%SystemDrive%\Gimnasio"

net session >nul 2>&1 || goto :sin_admin
where node >nul 2>&1 || goto :sin_node
for /f "usebackq delims=" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set "NODE_MAYOR=%%v"
rem better-sqlite3 11 trae binarios para Windows solo hasta Node 23: con Node 22 LTS no hace falta compilar nada.
if not "%NODE_MAYOR%"=="22" goto :version_node
for /f "delims=" %%n in ('where node') do if not defined NODE set "NODE=%%n"

echo.
echo [1/5] Deteniendo la app si ya estaba instalada...
schtasks /End /TN "Gimnasio" >nul 2>&1
call :detener

echo [2/5] Instalando librerias. Necesita internet y tarda unos minutos...
pushd "%APP%api"
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto :error_npm
popd

echo [3/5] Preparando las carpetas de datos en %BASE% ...
if not exist "%BASE%\datos" mkdir "%BASE%\datos"
if not exist "%BASE%\respaldos" mkdir "%BASE%\respaldos"
if not exist "%BASE%\config.bat" call :crear_config

echo [4/5] Programando que arranque sola al encender la computadora...
schtasks /Create /TN "Gimnasio" /TR "\"%APP%iniciar.bat\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul || goto :error_tarea
rem Permite entrar desde otras computadoras de la red del gimnasio (solo redes privadas).
netsh advfirewall firewall delete rule name="Gimnasio" >nul 2>&1
netsh advfirewall firewall add rule name="Gimnasio" dir=in action=allow protocol=TCP localport=3000 profile=private >nul
> "%PUBLIC%\Desktop\Gimnasio.url" echo [InternetShortcut]
>> "%PUBLIC%\Desktop\Gimnasio.url" echo URL=http://localhost:3000/

echo [5/5] Iniciando...
schtasks /Run /TN "Gimnasio" >nul
ping -n 6 127.0.0.1 >nul
start "" "http://localhost:3000/"
echo.
echo Listo. La app se abre en el navegador y en el escritorio quedo el acceso directo "Gimnasio".
echo Datos: %BASE%\datos    Respaldos: %BASE%\respaldos    Registro de errores: %BASE%\datos\registro.log
echo La primera vez entra con usuario admin y contrasena admin; la app pide cambiarla.
pause
exit /b 0

:crear_config
> "%BASE%\config.bat" echo @echo off
>> "%BASE%\config.bat" echo rem Configuracion del Gimnasio. La lee iniciar.bat al arrancar.
>> "%BASE%\config.bat" echo rem Para respaldar en la nube: en Google Drive para escritorio agrega la carpeta %BASE%\respaldos a "Carpetas a sincronizar".
>> "%BASE%\config.bat" echo rem Para respaldar en una USB, cambia BACKUP_DIR por la letra de la USB, por ejemplo: set "BACKUP_DIR=E:\Respaldos gimnasio"
>> "%BASE%\config.bat" echo set "NODE=%NODE%"
>> "%BASE%\config.bat" echo set "DB_FILE=%BASE%\datos\gimnasio.db"
>> "%BASE%\config.bat" echo set "BACKUP_DIR=%BASE%\respaldos"
exit /b 0

:detener
rem Cierra el programa que este usando el puerto 3000 (la version anterior de la app). PowerShell: netstat cambia de idioma.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }" >nul 2>&1
exit /b 0

:sin_admin
echo Haz clic derecho en instalar.bat y elige "Ejecutar como administrador".
pause
exit /b 1

:sin_node
echo Falta Node.js. Descarga e instala Node.js 22 LTS para Windows de 64 bits desde:
echo   https://nodejs.org/dist/latest-v22.x/
echo Busca el archivo que termina en "x64.msi". Despues vuelve a ejecutar instalar.bat.
pause
exit /b 1

:version_node
echo Esta app necesita Node.js 22 LTS y esta computadora tiene la version %NODE_MAYOR%.
echo Desinstala Node.js desde "Agregar o quitar programas" e instala la version 22 desde:
echo   https://nodejs.org/dist/latest-v22.x/
pause
exit /b 1

:error_npm
popd
echo No se pudieron instalar las librerias. Revisa la conexion a internet y vuelve a intentarlo.
pause
exit /b 1

:error_tarea
echo No se pudo programar el arranque automatico.
pause
exit /b 1
