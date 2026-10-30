@echo off
chcp 65001 >nul
title Antigravity FRP Server
cd /d "%~dp0"

echo ==========================================================
echo   Antigravity Remote Studio - Windows 云服务器中继
echo ==========================================================

if not exist "frps.exe" (
    echo [提示] 首次运行，正在调用 PowerShell 自动下载并配置环境...
    powershell -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
    pause
    exit /b
)

echo [1/2] 正在启动 FRP 服务端 (frps.exe)...
echo [2/2] 监听端口: 7000，目标端口: 8888
echo ----------------------------------------------------------
echo 提示: 请保持此窗口开启，或将其最小化到后台运行。
echo ----------------------------------------------------------

frps.exe -c frps.toml
pause
