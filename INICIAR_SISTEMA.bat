@echo off
title Sistema Ricardo - Servidor Local
echo ===================================================
echo           INICIANDO SISTEMA RICARDO
echo ===================================================
echo.
cd /d "%~dp0"
echo Verificando dependencias...
echo Iniciando servidor en http://localhost:3000 ...
echo.
start http://localhost:3000
npm run dev
pause

