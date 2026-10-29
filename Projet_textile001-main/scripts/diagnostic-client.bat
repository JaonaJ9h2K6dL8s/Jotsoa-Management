@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title Diagnostic connexion JO Management
set SERVER=192.168.0.12
echo ============================================
echo   DIAGNOSTIC CONNEXION SERVEUR JO MANAGEMENT
echo ============================================
echo.
echo [1/4] Configuration reseau de ce PC :
ipconfig | findstr /C:"IPv4"
echo.
echo [2/4] Test ping vers le serveur %SERVER% :
ping -n 3 -w 1000 %SERVER%
echo.
echo [3/4] Test du port 3000 (connexion au serveur) :
powershell -NoProfile -Command "$r = Test-NetConnection -ComputerName %SERVER% -Port 3000 -WarningAction SilentlyContinue; if ($r.TcpTestSucceeded) { echo '  >>> PORT 3000 : OK - le serveur est joignable' } else { echo '  >>> PORT 3000 : BLOQUE ou serveur eteint' }"
echo.
echo [4/4] Test de la page web :
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://%SERVER%:3000/api/health' -TimeoutSec 10 -UseBasicParsing; echo ('  >>> PAGE WEB : OK (HTTP ' + $r.StatusCode + ') - ouvrez http://%SERVER%:3000 dans le navigateur') } catch { echo '  >>> PAGE WEB : ECHEC - ' + $_.Exception.Message }"
echo.
echo ============================================
echo   Copiez-collez tout ce texte et envoyez-le
echo ============================================
pause
