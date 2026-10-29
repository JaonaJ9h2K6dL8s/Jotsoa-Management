@echo off
title JO Management - Serveur
cd /d "D:\Projet_textile001-main\Projet_textile001-main"
echo ============================================
echo   JO Management - Demarrage du serveur
echo   Ce PC (serveur)  : http://localhost:3000
echo   Poste Coupe etc. : http://192.168.50.1:3000
echo ============================================
echo.
echo Laissez cette fenetre OUVERTE pendant le travail.
echo Pour arreter le serveur : fermez cette fenetre.
echo.
npm run dev -- -H 0.0.0.0
pause
