@echo off
title CrediFlux - Servidor Local
echo ===================================================
echo             INICIANDO CREDIFLUX
echo ===================================================
echo.
cd /d "%~dp0"
echo Verificando dependencias...
echo Iniciando servidor en http://localhost:3000 ...
echo.
start http://localhost:3000
npm run dev
pause

