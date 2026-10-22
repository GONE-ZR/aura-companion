@echo off
chcp 65001 >nul
title 安静陪伴 · 本机网页版
cd /d "%~dp0"

echo.
echo   安静陪伴 · 本机启动
echo   ----------------------------------------
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo   [x] 没找到 python。请先装 Python 3.10 以上，并勾选 Add to PATH。
  echo.
  pause
  exit /b 1
)

if not exist ".venv" (
  echo   首次运行，正在创建虚拟环境并安装依赖（大约 1-3 分钟）...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip -q
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

if not exist ".env" (
  echo.
  echo   [i] 没找到 .env。你可以直接在网页里点"设置 API 密钥"填，
  echo       也可以现在按回车复制一份 .env.example 改名。
  echo.
  pause
  copy .env.example .env
)

echo.
echo   正在启动... 浏览器会自动打开 http://127.0.0.1:8000
echo   关掉这个窗口就等于关掉服务。
echo.

start "" http://127.0.0.1:8000
python app.py --port 8000
pause
