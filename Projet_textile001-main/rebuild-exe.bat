@echo off
REM Reconstruction de l'executable JO Management (marker, fiches, tickets)
REM Sortie : V1_textile\JO-Management-Portable.exe

cd /d "C:\john\Projet_textile001-main\Projet_textile001-main"

echo ============================================
echo 1/5 Seed catalogue etendu (tailles enfant, jogging, ensembles)...
echo ============================================
call npm run seed:catalogue
if errorlevel 1 (
  echo.
  echo ERREUR : le seed du catalogue a echoue.
  pause
  exit /b 1
)

echo ============================================
echo 2/5 Verification des types (tsc --noEmit)...
echo ============================================
call npx tsc --noEmit
if errorlevel 1 (
  echo.
  echo ERREUR : la verification des types a echoue. Build annule.
  pause
  exit /b 1
)

echo ============================================
echo 3/5 Build Next.js...
echo ============================================
call npm run build
if errorlevel 1 (
  echo.
  echo ERREUR : le build Next.js a echoue.
  pause
  exit /b 1
)

echo ============================================
echo 4/5 Preparation desktop...
echo ============================================
call node scripts/prepare-desktop.cjs
if errorlevel 1 (
  echo.
  echo ERREUR : la preparation desktop a echoue.
  pause
  exit /b 1
)

echo ============================================
echo 5/5 Creation de l'executable portable...
echo ============================================
call npx electron-builder --win portable
if errorlevel 1 (
  echo.
  echo ERREUR : electron-builder a echoue.
  pause
  exit /b 1
)

echo.
echo TERMINE : V1_textile\JO-Management-Portable.exe
echo.
pause
