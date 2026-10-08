[CmdletBinding()]
param(
    [string]$TargetIp,
    [ValidateRange(1, 65535)][int]$Port = 57088,
    [ValidateRange(1, 120)][int]$Samples = 12,
    [ValidateRange(1, 60)][int]$IntervalSeconds = 5,
    [string]$OutputFile
)

# 仅检查本机与指定对端，不扫描网段，不修改防火墙或网络设置。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$reportRoot = [Environment]::GetFolderPath('MyDocuments')
if (-not $reportRoot) { $reportRoot = [System.IO.Path]::GetTempPath() }
$appLogPath = Join-Path $reportRoot 'LAN Drop\logs\app.log'
if (-not $OutputFile) {
    $OutputFile = Join-Path $reportRoot 'LAN Drop\logs\diagnostics.txt'
}
$OutputFile = [System.IO.Path]::GetFullPath($OutputFile)
$reportDirectory = [System.IO.Path]::GetDirectoryName($OutputFile)
$null = New-Item -ItemType Directory -Path $reportDirectory -Force
# 每次覆盖报告，避免排查文件持续堆积。
Set-Content -LiteralPath $OutputFile -Value '' -Encoding UTF8
function Write-Diagnostic([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message
    Write-Output $line
    Add-Content -LiteralPath $OutputFile -Value $line -Encoding UTF8
}

Write-Diagnostic "开始诊断：端口=$Port，采样次数=$Samples，间隔=${IntervalSeconds}秒；输出=$OutputFile"
foreach ($command in @('Get-NetIPAddress', 'Get-NetConnectionProfile', 'Get-NetFirewallProfile', 'Get-NetTCPConnection')) {
    try {
        $data = switch ($command) {
            'Get-NetIPAddress' { Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, IPAddress, PrefixLength, AddressState }
            'Get-NetConnectionProfile' { Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory, IPv4Connectivity }
            'Get-NetFirewallProfile' { Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction }
            'Get-NetTCPConnection' { Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq $Port | Select-Object LocalAddress, LocalPort, OwningProcess }
        }
        Write-Diagnostic ("{0}：{1}" -f $command, ($data | Format-Table -AutoSize | Out-String).Trim())
    } catch { Write-Diagnostic "读取 $command 失败：$($_.Exception.Message)" }
}

$targets = @('127.0.0.1')
if ($TargetIp) {
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($TargetIp, [ref]$parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        throw 'TargetIp 必须是有效 IPv4 地址。'
    }
    $targets += $TargetIp
}
$targets = @($targets | Select-Object -Unique)
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromMilliseconds(2500)
$results = @()
try {
    for ($sample = 1; $sample -le $Samples; $sample++) {
        foreach ($ip in $targets) {
            $url = "http://${ip}:${Port}/api/info"
            $watch = [System.Diagnostics.Stopwatch]::StartNew()
            $response = $null
            try {
                $response = $client.GetAsync($url).GetAwaiter().GetResult()
                $null = $response.EnsureSuccessStatusCode()
                $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                if (-not $body.id -or -not $body.name -or -not $body.os) { throw '响应缺少设备字段，可能不是 LAN Drop 服务。' }
                $watch.Stop()
                $results += [pscustomobject]@{ IP = $ip; Success = $true; ElapsedMs = $watch.ElapsedMilliseconds }
                Write-Diagnostic "采样=$sample；成功；URL=$url；耗时=$($watch.ElapsedMilliseconds)ms；ID=$($body.id)；公告地址=$($body.ip):$($body.port)"
                if ($body.port -ne $Port) { Write-Diagnostic '提示：公告端口与实际连接端口不一致，请检查运行版本与端口设置。' }
                if ($ip -ne '127.0.0.1' -and $body.ip -ne $ip) { Write-Diagnostic '提示：公告 IP 与实际连接 IP 不一致，可能存在多网卡或旧地址。' }
            } catch {
                $watch.Stop()
                $results += [pscustomobject]@{ IP = $ip; Success = $false; ElapsedMs = $watch.ElapsedMilliseconds }
                Write-Diagnostic "采样=$sample；失败；URL=$url；耗时=$($watch.ElapsedMilliseconds)ms；原因=$($_.Exception.GetBaseException().Message)"
            } finally { if ($response) { $response.Dispose() } }
        }
        if ($sample -lt $Samples) { Start-Sleep -Seconds $IntervalSeconds }
    }
} finally { $client.Dispose(); $handler.Dispose() }

foreach ($ip in $targets) {
    $items = @($results | Where-Object IP -eq $ip)
    $successes = @($items | Where-Object Success).Count
    Write-Diagnostic "汇总：${ip}:${Port}；成功=$successes/$($items.Count)；失败=$($items.Count - $successes)"
}
$logPath = $appLogPath
if (Test-Path -LiteralPath $logPath) {
    Write-Diagnostic "应用日志末尾（$logPath）："
    Get-Content -LiteralPath $logPath -Encoding UTF8 -Tail 30 | ForEach-Object { Write-Diagnostic $_ }
} else { Write-Diagnostic "未找到应用诊断日志：$logPath；新版程序启动后会生成。" }
Write-Diagnostic '定位提示：本机回环失败先查监听端口与进程；回环成功、对端失败时，在两台设备分别执行脚本，对比网卡、HTTP 错误与防火墙信息。'
Write-Diagnostic "诊断完成：$OutputFile"
