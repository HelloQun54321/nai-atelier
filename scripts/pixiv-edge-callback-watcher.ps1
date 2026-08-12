param([switch]$SelfTest)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Web
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NpmPixivNativeWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
'@

$callbackHost = 'app-api.pixiv.net'
$callbackPath = '/web/v1/users/auth/pixiv/callback'
$deadline = [DateTime]::UtcNow.AddMinutes(5)
$addressCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  'addressEditBox'
)

[Console]::Out.WriteLine('NPM_PIXIV_WATCHER_READY')
if ($SelfTest) { exit 0 }

while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $handle = [NpmPixivNativeWindow]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { throw 'No foreground window' }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $process = Get-Process -Id ([int]$window.Current.ProcessId)
    if ($process.ProcessName -ne 'msedge') { throw 'Foreground window is not Edge' }
    $addressBar = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
    if ($null -eq $addressBar) { throw 'Edge address bar not found' }
    $value = ''
    try {
      $pattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $value = [string]$pattern.Current.Value
    } catch {}
    if ([string]::IsNullOrWhiteSpace($value)) {
      try {
        $legacy = $addressBar.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        $value = [string]$legacy.Current.Value
      } catch {}
    }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri)) { throw 'Not an absolute URL' }
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne $callbackHost -or $uri.AbsolutePath -ne $callbackPath) { throw 'Not the Pixiv callback' }
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    if ([string]::IsNullOrWhiteSpace($query.Get('code'))) { throw 'Missing callback code' }
    [Console]::Out.WriteLine($uri.AbsoluteUri)
    exit 0
  } catch {}
  Start-Sleep -Milliseconds 300
}

exit 2
