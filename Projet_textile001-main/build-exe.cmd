@echo off
setlocal
title Build JO Management - exe portable
cd /d "%~dp0"

echo ============================================
echo  JO Management - Construction du .exe
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Node.js / npm introuvable sur ce poste.
  echo Installez Node.js depuis https://nodejs.org puis relancez ce script.
  pause
  exit /b 1
)

rem Suppression de l'ancien dossier de build V_textile
if exist "V_textile" (
  echo Suppression de l'ancien dossier V_textile...
  rmdir /s /q "V_textile"
)

echo [1/3] Installation des dependances (npm install)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/3] Compilation de l'application (build de production)...
call npm run desktop:build
if errorlevel 1 goto :fail

echo.
echo [3/3] Termine.
echo Le fichier executable se trouve dans le dossier V1_textile :
echo   V1_textile\JO-Management-Portable.exe
echo.
pause
exit /b 0

:fail
echo.
echo ERREUR : le build a echoue. Verifiez les messages ci-dessus.
pause
exit /b 1
