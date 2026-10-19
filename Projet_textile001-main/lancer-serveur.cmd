@echo off
setlocal
title JO Management - Serveur
cd /d "%~dp0"

echo ============================================
echo  JO Management - Demarrage du serveur
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Node.js / npm introuvable sur ce poste.
  echo Installez Node.js depuis https://nodejs.org puis relancez ce script.
  pause
  exit /b 1
)

rem Si le build de production existe, on le sert (plus rapide) ;
rem sinon on compile d'abord, puis on demarre.
if exist ".next\BUILD_ID" (
  echo Demarrage du serveur de production sur le port 3000...
  call npm start
) else (
  echo Premiere compilation, veuillez patienter...
  call npm run build
  if errorlevel 1 goto :fail
  call npm start
)
goto :eof

:fail
echo.
echo ERREUR : la compilation a echoue. Verifiez les messages ci-dessus.
pause
exit /b 1
