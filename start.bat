@echo off
REM ============================================================
REM  WCA CRM - one-click launcher (Windows)
REM  Opens the backend API and the frontend in two windows,
REM  then launches the app in your default browser.
REM ============================================================

echo Starting WCA CRM...

REM --- Backend API (port 4000) ---
start "WCA CRM - Backend API" cmd /k "cd /d "%~dp0server" && npm start"

REM --- Frontend (port 5173) ---
start "WCA CRM - Frontend" cmd /k "cd /d "%~dp0client" && npm run dev"

REM --- Give the dev server a moment, then open the browser ---
timeout /t 5 /nobreak >nul
start "" http://localhost:5173

echo.
echo WCA CRM is starting in two new windows.
echo   Backend : http://localhost:4000
echo   Frontend: http://localhost:5173
echo.
echo Close those two windows to stop the servers.
