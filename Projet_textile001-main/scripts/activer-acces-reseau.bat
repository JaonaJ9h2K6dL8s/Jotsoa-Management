@echo off
rem ============================================================
rem  JO Management — Activation de l'acces reseau (PC serveur)
rem  A executer UNE FOIS sur l'ordinateur serveur.
rem  Ouvre le port 3000 dans le pare-feu Windows et affiche
rem  l'adresse a communiquer aux autres postes.
rem ============================================================

rem --- Auto-elevation administrateur ---
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Demande des droits administrateur...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo [1/3] Ouverture du port 3000 (TCP entrant)...
netsh advfirewall firewall delete rule name="JO Management - Serveur" >nul 2>&1
netsh advfirewall firewall add rule name="JO Management - Serveur" dir=in action=allow protocol=TCP localport=3000 profile=any
if %errorLevel% neq 0 (
  echo ERREUR : impossible de modifier le pare-feu.
  pause
  exit /b 1
)

echo.
echo [2/3] Redemarrage non requis - regle appliquee immediatement.
echo.
echo [3/3] Adresse a utiliser depuis les autres postes du reseau :
echo.
ipconfig | findstr /i "IPv4"
echo.
echo    http://IP-DU-CE-PC:3000
echo.
echo Exemple : si l'adresse affichee est 192.168.1.50,
echo           les autres postes ouvrent http://192.168.1.50:3000
echo.
echo Ce fichier peut etre ferme. La regle reste active apres redemarrage.
pause
