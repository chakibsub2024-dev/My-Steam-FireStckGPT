@echo off
REM MyStream development launcher for Windows. Needs Node.js 22+ (https://nodejs.org).
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul && echo Created .env - add your TMDB_API_KEY, then run this again. && notepad .env && exit /b
node --version >nul 2>&1 || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
echo Starting MyStream on http://localhost:8787 ...
start "" http://localhost:8787
node services\api\src\server.js
pause
