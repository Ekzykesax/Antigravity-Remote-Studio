@echo off
chcp 65001 >nul
title Antigravity Remote Studio (反重力移动工作台)

cd /d "%~dp0"

echo ===================================================
echo   🚀 Antigravity Remote Studio (反重力移动工作台)
echo ===================================================
echo.

:: 清理旧中继与端口占用
powershell -NoProfile -Command "Stop-Process -Name ssh -Force -ErrorAction SilentlyContinue; Get-NetTCPConnection -LocalPort 8888 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul

:: 检测 Python 环境
set "PY_BIN="
where py >nul 2>nul
if %errorlevel% equ 0 (
    set "PY_BIN=py -3"
) else (
    set "PY_BIN=python"
)

echo [Gateway] 正在启动网关与 SSH 专用中继通道...
%PY_BIN% -u -m gateway.app

echo.
echo [Antigravity] 服务已停止。
pause