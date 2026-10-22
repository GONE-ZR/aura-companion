@echo off
chcp 65001 >nul
title 生成发布签名（安静陪伴）
set "JAVA_HOME=D:\tools\jdk17\jdk-17.0.20.1+1"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "KS=D:\tools\aura-release.keystore"
set "PROPS=D:\opencode workspace\aura-companion\android\keystore.properties"

if exist "%KS%" (
  echo   已经存在 keystore，跳过生成：%KS%
  goto :props
)

echo   生成新的发布签名（有效期 100 年）...
keytool -genkeypair -v ^
  -keystore "%KS%" ^
  -storetype PKCS12 ^
  -alias aura ^
  -keyalg RSA -keysize 2048 -sigalg SHA256withRSA ^
  -validity 36500 ^
  -storepass auracomp2026 -keypass auracomp2026 ^
  -dname "CN=Aura Companion, OU=Personal, O=Aura, L=, ST=, C=CN"
if errorlevel 1 (
  echo   [x] keytool 失败
  pause
  exit /b 1
)
echo   签名已生成：%KS%

:props
> "%PROPS%" echo storeFile=D:/tools/aura-release.keystore
>> "%PROPS%" echo storePassword=auracomp2026
>> "%PROPS%" echo keyAlias=aura
>> "%PROPS%" echo keyPassword=auracomp2026
echo   写入 %PROPS%
echo   完成。
pause
