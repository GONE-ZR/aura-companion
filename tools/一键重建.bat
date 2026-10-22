@echo off
chcp 65001 >nul
title 安静陪伴 · 一键重建
cd /d "%~dp0"
echo.
echo   安静陪伴 · 一键重建全部产物
echo   ------------------------------------------------------
echo.

REM ---------- 工具链路径（全部在 D 盘） ----------
set "JAVA_HOME=D:\tools\jdk17\jdk-17.0.20.1+1"
set "ANDROID_HOME=D:\tools\android-sdk"
set "ANDROID_SDK_ROOT=D:\tools\android-sdk"
set "GRADLE_USER_HOME=D:\gradle-home"
set "ELECTRON_BUILDER_CACHE=D:\electron-builder-cache"
set "npm_config_cache=D:\npm-cache"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo   [1/6] 生成图标
python tools\make_icons.py || goto :fail
echo   [2/6] 导出人设模板（桌面版要用）
python tools\export_personas.py || goto :fail
echo   [3/6] 组装前端 web/ 目录（APK 用）
python tools\build_web.py || goto :fail
echo   [4/6] 自检
python tools\selftest.py || goto :fail
echo   [5/6] 打包桌面版
pushd desktop
call npx electron-builder --win --x64 || (popd & goto :fail)
popd
echo   [6/6] 打包安卓 APK
call npx cap copy android || goto :fail
pushd android
call gradlew.bat assembleDebug --no-daemon --console=plain || (popd & goto :fail)
popd

echo.
echo   ============================================================
echo    全部完成
echo    桌面版：desktop\dist\安静陪伴-1.0.0-x64.exe
echo    APK   ：android\app\build\outputs\apk\debug\app-debug.apk
echo   ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo   [x] 有一步失败了，看上面的报错。
pause
exit /b 1
