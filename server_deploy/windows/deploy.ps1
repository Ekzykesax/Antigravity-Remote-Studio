# Antigravity Remote Studio - Windows Server 一键部署脚本
# 请在 Windows 云服务器上右键以管理员身份运行 PowerShell 执行此脚本

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Remote Studio - Windows 云服务器中继部署" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1. 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "⚠️  建议使用管理员身份运行此脚本，以便自动配置防火墙规则。" -ForegroundColor Yellow
}

# 2. 自动放行 Windows 本地防火墙端口 (7000, 8888, 7500)
Write-Host "🛡️  正在检查并配置 Windows 防火墙入站规则..." -ForegroundColor Green
try {
    $ports = @(7000, 8888, 7500)
    foreach ($p in $ports) {
        $ruleName = "Antigravity_FRP_Port_$p"
        $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        if (-not $existing) {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $p -Protocol TCP -Action Allow | Out-Null
            Write-Host "   ✅ 已放行 TCP 端口: $p" -ForegroundColor Gray
        } else {
            Write-Host "   ℹ️  端口 $p 防火墙规则已存在" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "⚠️  防火墙自动放行跳过 (非管理员权限或系统策略限制)。请确保在云厂商控制台安全组放行 7000 与 8888 端口。" -ForegroundColor Yellow
}

# 3. 检查并下载 frps.exe
$frpsBin = Join-Path $ScriptDir "frps.exe"
if (-not (Test-Path $frpsBin)) {
    Write-Host "📦 本地未找到 frps.exe，正在从 GitHub 下载最新 FRP 服务端组件..." -ForegroundColor Green
    $version = "0.61.1"
    $zipUrl = "https://github.com/fatedier/frp/releases/download/v${version}/frp_${version}_windows_amd64.zip"
    $zipPath = Join-Path $ScriptDir "frp_download.zip"
    
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host "   下载地址: $zipUrl" -ForegroundColor Gray
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        
        Write-Host "📂 正在解压提取 frps.exe ..." -ForegroundColor Green
        Expand-Archive -Path $zipPath -DestinationPath (Join-Path $ScriptDir "tmp_frp") -Force
        
        $extractedFrps = Get-ChildItem -Path (Join-Path $ScriptDir "tmp_frp") -Filter "frps.exe" -Recurse | Select-Object -First 1
        if ($extractedFrps) {
            Copy-Item -Path $extractedFrps.FullName -Destination $frpsBin -Force
            Write-Host "✅ frps.exe 提取成功！" -ForegroundColor Green
        }
        
        Remove-Item -Path (Join-Path $ScriptDir "tmp_frp") -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "❌ 自动下载失败: $_" -ForegroundColor Red
        Write-Host "💡 您也可以手动从 https://github.com/fatedier/frp/releases 下载 frp_${version}_windows_amd64.zip" -ForegroundColor Yellow
        Write-Host "   并将里面的 frps.exe 解压放置到当前目录即可。" -ForegroundColor Yellow
        pause
        exit
    }
}

# 4. 检查配置文件
$cfgFile = Join-Path $ScriptDir "frps.toml"
if (-not (Test-Path $cfgFile)) {
    @"
bindPort = 7000
auth.token = "antigravity"

webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "admin8888"
"@ | Out-File -FilePath $cfgFile -Encoding utf8
}

Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "🚀 FRP 服务端已就绪！即将启动服务..." -ForegroundColor Green
Write-Host "   - 监听连接端口: 7000 (TCP)" -ForegroundColor Gray
Write-Host "   - 远程映射端口: 8888 (TCP)" -ForegroundColor Gray
Write-Host "   - 管理面板: http://localhost:7500" -ForegroundColor Gray
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "⚠️  请务必在阿里云/腾讯云等控制台【安全组】中放行 7000 与 8888 端口！" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan

& $frpsBin -c $cfgFile
