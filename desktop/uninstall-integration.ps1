param([Parameter(Mandatory = $true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
# 仅注销仍指向本安装位置的协议，其他程序或源码工坊的注册不受影响。
$taskRuntime = Join-Path ([IO.Path]::GetFullPath($InstallDir)) 'resources\runtime'
$taskExpected = '"' + (Join-Path $taskRuntime 'node.exe') + '" "' + (Join-Path $taskRuntime 'scripts\pixiv-scheme-handler.mjs') + '" "%1"'
$taskKey = 'HKCU:\Software\Classes\pixiv'
try {
    $taskCommand = (Get-Item -LiteralPath "$taskKey\shell\open\command" -ErrorAction SilentlyContinue).GetValue('')
    if ($taskCommand -and $taskCommand.StartsWith($taskExpected, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $taskKey -Recurse -Force
    }
} catch { # 未注册或已由其他程序接管，不阻断卸载。
}
