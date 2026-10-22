param([switch]$SelfTest, [string]$AppearanceJson = '', [switch]$LoadOnly)
$ErrorActionPreference = 'Stop'
$collectorLoadTimer = [System.Diagnostics.Stopwatch]::StartNew()
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Xaml
$collectorFramework = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$collectorAssemblies = @([System.Windows.Forms.Form].Assembly.Location, [System.Drawing.Image].Assembly.Location, [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location, [System.Xaml.XamlReader].Assembly.Location, [System.Windows.Window].Assembly.Location, [System.Windows.Media.Brush].Assembly.Location, [System.Windows.Threading.Dispatcher].Assembly.Location, (Join-Path $collectorFramework 'System.dll'), (Join-Path $collectorFramework 'System.Core.dll'))
$collectorSources = @((Join-Path $PSScriptRoot 'style-collector-wallpaper.cs'), (Join-Path $PSScriptRoot 'style-collector-view.cs'), (Join-Path $PSScriptRoot 'style-collector-window.cs'))
function Compile-Collector([string]$outputPath = '') {
    # 保留磁盘程序集缓存和无写权限时的内存编译。
    $collectorCompilerParameters = [System.CodeDom.Compiler.CompilerParameters]::new()
    $collectorCompilerParameters.GenerateInMemory = -not $outputPath
    if ($outputPath) { $collectorCompilerParameters.OutputAssembly = $outputPath }
    $collectorCompilerParameters.ReferencedAssemblies.AddRange([string[]]$collectorAssemblies)
    $collectorCompiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
    try {
        $collectorCompilation = $collectorCompiler.CompileAssemblyFromFile($collectorCompilerParameters, [string[]]$collectorSources)
        if ($collectorCompilation.Errors.HasErrors) { throw (($collectorCompilation.Errors | ForEach-Object ToString) -join "`n") }
        if (-not $outputPath) { $null = $collectorCompilation.CompiledAssembly }
    } finally { $collectorCompiler.Dispose() }
}
# 源码、CLR 和框架引用共同决定缓存，改代码自动重编译；主题变化无需重编译。
$collectorFingerprint = [System.Environment]::Version.ToString() + '|' + [IntPtr]::Size + '|' + ($collectorAssemblies -join '|')
foreach ($collectorSource in $collectorSources) { $collectorFingerprint += "`0" + [System.IO.File]::ReadAllText($collectorSource) }
foreach ($collectorReference in $collectorAssemblies) { $collectorFingerprint += '|' + [System.IO.File]::GetLastWriteTimeUtc($collectorReference).Ticks }
$collectorHasher = [System.Security.Cryptography.SHA256]::Create()
try { $collectorHash = [BitConverter]::ToString($collectorHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($collectorFingerprint))).Replace('-', '').ToLowerInvariant() }
finally { $collectorHasher.Dispose() }
$collectorResourceRoot = if ($env:NAI_RESOURCE_ROOT) { $env:NAI_RESOURCE_ROOT } else { Join-Path (Get-Location).Path 'local-cache' }
$collectorCache = Join-Path $collectorResourceRoot 'collector-runtime'
$collectorAssemblyPath = Join-Path $collectorCache ($collectorHash + '.dll')
$collectorCached = $false
$collectorLoaded = $false
$collectorCacheError = ''
try {
    [System.IO.Directory]::CreateDirectory($collectorCache) | Out-Null
    if (Test-Path -LiteralPath $collectorAssemblyPath) {
        try { Add-Type -Path $collectorAssemblyPath; $collectorLoaded = $true; $collectorCached = $true }
        catch { Remove-Item -LiteralPath $collectorAssemblyPath -Force }
    }
    if (-not $collectorLoaded) {
        Compile-Collector $collectorAssemblyPath
        Add-Type -Path $collectorAssemblyPath
        $collectorLoaded = $true
    }
} catch {
    $collectorCacheError = $_.Exception.Message + " | " + $_.ScriptStackTrace
    # 缓存目录不可写不阻断收集，仍可在当前进程内编译。
    if (-not $collectorLoaded) { Compile-Collector }
}
$null = [AtelierCollectorWindow]
if ($LoadOnly) {
    @{ cacheHit = $collectorCached; loadMs = $collectorLoadTimer.ElapsedMilliseconds; assembly = $collectorAssemblyPath; cacheError = $collectorCacheError } | ConvertTo-Json -Compress
    return
}
[AtelierCollectorWindow]::Run($SelfTest.IsPresent, $AppearanceJson)
