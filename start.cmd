@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title YanZhou Sport Live NXT
set "SPORT_NODE=%~dp0runtime\node.exe"
if exist "%SPORT_NODE%" goto runtime_ready
where.exe node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Use the Windows portable ZIP or install Node.js 22 or newer.
  pause
  exit /b 1
)
set "SPORT_NODE=node.exe"
:runtime_ready
if not exist "%~dp0node_modules\ws\package.json" (
  echo Dependencies are missing. Run npm ci in this folder or use the Windows portable ZIP.
  pause
  exit /b 1
)
set "SPORT_OPEN=--open"
if /i "%~1"=="--headless" set "SPORT_OPEN="
"%SPORT_NODE%" "%~dp0server\server.js" %SPORT_OPEN%
set "SPORT_EXIT=%ERRORLEVEL%"
if not "%SPORT_EXIT%"=="0" if /i not "%~1"=="--headless" pause
exit /b %SPORT_EXIT%
