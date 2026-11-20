#!/bin/sh
# Arma gimnasio-windows.zip para instalar la app en una computadora con Windows (instrucciones en windows/LEEME.txt).
set -e
cd "$(dirname "$0")"
(cd web && npx ng build)
rm -rf paquete && mkdir -p paquete/gimnasio/api paquete/gimnasio/web/dist/web
cp api/server.js api/package.json api/package-lock.json paquete/gimnasio/api/
cp -R web/dist/web/browser paquete/gimnasio/web/dist/web/
cp windows/* paquete/gimnasio/
rm -f gimnasio-windows.zip
(cd paquete && zip -qr ../gimnasio-windows.zip gimnasio)
rm -rf paquete
echo "Listo: $(pwd)/gimnasio-windows.zip"
