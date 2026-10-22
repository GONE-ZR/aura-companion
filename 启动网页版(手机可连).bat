@echo off
chcp 65001 >nul
cd /d "%~dp0"
python tools\launch.py lan
if errorlevel 9009 (
  echo   [x] python not found in PATH. Install Python 3.10+ and tick "Add to PATH".
  pause
  exit /b 1
)
pause
