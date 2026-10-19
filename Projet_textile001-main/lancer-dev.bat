@echo off
REM Lancement en mode developpement (aperçu immediat des modifications)
REM Puis ouvrir : http://localhost:3117

cd /d "C:\john\Projet_textile001-main\Projet_textile001-main"
echo Serveur dev sur http://localhost:3117 (Ctrl+C pour arreter)
start "" http://localhost:3117
call npx next dev -p 3117
pause
