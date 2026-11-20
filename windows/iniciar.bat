@echo off
rem La ejecuta el Programador de tareas al encender la computadora (como SYSTEM, sin ventana).
rem Si la app se cierra por un error, vuelve a arrancar a los 10 segundos.
call "%SystemDrive%\Gimnasio\config.bat"
cd /d "%~dp0api"
:arrancar
"%NODE%" server.js >> "%SystemDrive%\Gimnasio\datos\registro.log" 2>&1
rem ping como pausa: timeout no funciona sin ventana.
ping -n 11 127.0.0.1 >nul
goto :arrancar
