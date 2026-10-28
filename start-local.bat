@echo off
rem Starts Job Hunter locally: API on http://localhost:4000 and web app on http://localhost:5173
cd /d "%~dp0"
echo Starting Job Hunter...
start "Job Hunter API" cmd /k "npm run dev:server"
start "Job Hunter Web" cmd /k "npm run dev:web"
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
