# 清理 omp 浏览器工具启动的残留 chrome 进程（防止可见窗口/后台进程残留在桌面）。
# 只匹配 %USERPROFILE%\.omp\puppeteer 路径下的 chrome.exe，不会误伤用户自己的 Chrome。
$omp = Join-Path $env:USERPROFILE '.omp\puppeteer'
$targets = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$omp*" }
if (-not $targets) {
    Write-Output "no omp chrome processes found"
} else {
    foreach ($p in $targets) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output ("killed pid=" + $p.ProcessId)
    }
}
