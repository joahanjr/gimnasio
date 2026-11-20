@echo off
chcp 65001 >nul
title Desinstalar Gimnasio
net session >nul 2>&1 || (echo Haz clic derecho en desinstalar.bat y elige "Ejecutar como administrador". & pause & exit /b 1)
schtasks /End /TN "Gimnasio" >nul 2>&1
schtasks /Delete /TN "Gimnasio" /F >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }" >nul 2>&1
netsh advfirewall firewall delete rule name="Gimnasio" >nul 2>&1
del "%PUBLIC%\Desktop\Gimnasio.url" >nul 2>&1
echo La app se desinstalo. Tus datos siguen en %SystemDrive%\Gimnasio: borra esa carpeta solo si ya no los necesitas.
pause
