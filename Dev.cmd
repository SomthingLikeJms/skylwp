@echo off
setlocal
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if not exist "node_modules\vite\bin\vite.js" (
  echo Run npm ci first to install development dependencies.
  pause
  exit /b 1
)
call npm run dev
