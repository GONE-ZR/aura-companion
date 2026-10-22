@echo off
chcp 65001 >nul
title 安静陪伴 · 一键装到手机
echo.
echo   安静陪伴 · 手机自动安装
echo   ------------------------------------------------------
echo.
echo   现在只要做一件事：把数据线插上手机，并在手机里打开
echo     设置 - 关于手机 - 连续点「版本号」7 次 - 输入锁屏密码
echo     - 返回设置 - 系统和更新 - 开发者选项 - 打开「USB 调试」
echo.
echo   剩下的（安装、启动、填密钥、验证）全部由本程序自动完成。
echo   这个窗口请一直开着。
echo.

set "ADB=D:\tools\android-sdk\platform-tools\adb.exe"
if not exist "%ADB%" (
  echo   [x] 找不到 adb
  pause
  exit /b 1
)

:wait
echo   [等待] 找手机中...
"%ADB%" devices | findstr /R "device$" >nul
if errorlevel 1 (
  timeout /t 3 /nobreak >nul
  goto :wait
)

echo   [找到] 手机已连接，开始自动安装...
echo.
python "D:\opencode workspace\aura-companion\tools\phone_autopilot.py"

echo.
echo   全部完成。过程截图在：
echo   D:\opencode workspace\aura-companion\phone_shots\
echo.
pause
