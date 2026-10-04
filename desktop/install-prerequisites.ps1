$ErrorActionPreference = 'Stop'
function Test-AtelierRuntime {
    $taskRegistry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    try {
        $taskRuntime = $taskRegistry.OpenSubKey('SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')
        if (-not $taskRuntime) { return $false }
        try {
            $taskVersion = [version]($taskRuntime.GetValue('Version', '0.0') -replace '^v', '')
            if ($taskRuntime.GetValue('Installed', 0) -ne 1 -or $taskVersion -lt [version]'14.44.0.0') { return $false }
        } finally { $taskRuntime.Dispose() }
    } finally { $taskRegistry.Dispose() }
    # NSIS 本身是 32 位；显式读取 64 位系统目录，避免误判并重复安装。
    $taskSystemDir = if ([Environment]::Is64BitProcess) { 'System32' } else { 'Sysnative' }
    foreach ($taskDll in @('msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $env:SystemRoot "$taskSystemDir\$taskDll"))) { return $false }
    }
    return $true
}
try {
    if (Test-AtelierRuntime) { exit 0 }

    # 不分发复制自开发电脑的系统 DLL；按需从微软官网取得原安装器。
    $taskTempDir = Join-Path ([IO.Path]::GetTempPath()) ('NAI-Atelier-prerequisite-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskTempDir | Out-Null
    $taskInstallerPath = Join-Path $taskTempDir 'vc_redist.x64.exe'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $taskInstallerPath -UseBasicParsing -TimeoutSec 120
    $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskInstallerPath
    if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Microsoft runtime signature verification failed' }
    $taskProcess = Start-Process -FilePath $taskInstallerPath -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -WindowStyle Hidden -PassThru -Wait
    if ($taskProcess.ExitCode -notin @(0, 1638, 3010)) { throw "Microsoft runtime installation failed: $($taskProcess.ExitCode)" }
    if (-not (Test-AtelierRuntime)) { throw 'Microsoft runtime is still unavailable; restart Windows and retry' }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($taskTempDir -and (Test-Path -LiteralPath $taskTempDir)) {
        $taskResolved = [IO.Path]::GetFullPath($taskTempDir)
        $taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($taskResolved.StartsWith($taskTempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($taskResolved).StartsWith('NAI-Atelier-prerequisite-')) {
            Remove-Item -LiteralPath $taskResolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
