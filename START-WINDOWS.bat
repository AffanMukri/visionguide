@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 18 or later, then run this launcher again.
  pause
  exit /b 1
)
if not exist "node_modules\maplibre-gl\dist\maplibre-gl.mjs" (
  echo Install project dependencies first with: npm.cmd install
  pause
  exit /b 1
)
if not defined GRAPHHOPPER_API_KEY echo Note: Set GRAPHHOPPER_API_KEY to enable walking routes.
node server.cjs
pause
