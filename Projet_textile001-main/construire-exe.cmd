@echo off
setlocal EnableDelayedExpansion
title Construction JO Management - exe portable (autonome)
cd /d "%~dp0"

echo ==========================================================
echo  JO Management - Construction du .exe (sans installation)
echo ==========================================================
echo.

rem Ce script utilise le runtime Node integre au projet
rem (resources\node.exe) : aucune installation de Node.js n'est requise.

set "NODE_EXE=%~dp0resources\node.exe"
if not exist "%NODE_EXE%" (
  echo ERREUR : resources\node.exe introuvable dans le projet.
  pause
  exit /b 1
)
if not exist "node_modules\electron-builder\cli.js" (
  echo ERREUR : les dependances du projet sont incompletes.
  echo Relancez le script depuis le dossier complet du projet.
  pause
  exit /b 1
)

rem --- Etape 0 : suppression des donnees et de tous les utilisateurs ---
echo [0/3] Effacement des donnees et utilisateurs (base SQLite)...
"%NODE_EXE%" scripts\reset-data.cjs
if errorlevel 1 goto :fail

rem --- Etape 1 : suppression de l'ancien dossier V_textile ---
if exist "V_textile" (
  echo.
  echo [1/3] Suppression de l'ancien dossier V_textile...
  rmdir /s /q "V_textile"
)

rem --- Etape 2 : preparation du paquet desktop ---
echo.
echo [2/3] Preparation du paquet desktop...
"%NODE_EXE%" scripts\prepare-desktop.cjs
if errorlevel 1 goto :fail

rem --- Etape 3 : creation de l'exe portable dans V1_textile ---
echo.
echo [3/3] Creation de l'exe portable (peut prendre quelques minutes)...
"%NODE_EXE%" node_modules\electron-builder\cli.js --win portable
if errorlevel 1 goto :fail

echo.
echo ==========================================================
echo  TERMINE : V1_textile\JO-Management-Portable.exe
echo  Double-cliquez sur ce fichier pour lancer l'application.
echo ==========================================================
echo.
pause
exit /b 0

:fail
echo.
echo ERREUR : la construction a echoue. Copiez le message ci-dessus.
pause
exit /b 1
