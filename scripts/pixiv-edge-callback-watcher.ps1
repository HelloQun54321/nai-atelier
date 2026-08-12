param(
  [switch]$SelfTest,
  [switch]$CaptureExisting,
  [switch]$Diagnostic,
  [switch]$ClipboardCapture
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Web

$callbackHost = 'app-api.pixiv.net'
$callbackPath = '/web/v1/users/auth/pixiv/callback'
$deadline = [DateTime]::UtcNow.AddMinutes(5)
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windowCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window
)
$addressIdCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  'addressEditBox'
)
$addressClassCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty,
  'OmniboxViewViews'
)
$addressCondition = [System.Windows.Automation.OrCondition]::new(
  [System.Windows.Automation.Condition[]]@($addressIdCondition, $addressClassCondition)
)

if ($ClipboardCapture) {
  Add-Type -AssemblyName System.Windows.Forms
  $previousClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
  try {
    $edge = Get-Process -Name 'msedge' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -eq $edge) { exit 3 }
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($edge.Id)
    Start-Sleep -Milliseconds 250
    $shell.SendKeys('^l')
    Start-Sleep -Milliseconds 150
    $shell.SendKeys('^c')
    Start-Sleep -Milliseconds 200
    $value = [System.Windows.Forms.Clipboard]::GetText()
    $shell.SendKeys('{ESC}')
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri)) { exit 4 }
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne $callbackHost -or $uri.AbsolutePath -ne $callbackPath) { exit 4 }
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    if ([string]::IsNullOrWhiteSpace($query.Get('code'))) { exit 4 }
    [Console]::Out.WriteLine($uri.AbsoluteUri)
    exit 0
  } finally {
    try {
      if ($null -eq $previousClipboard) {
        [System.Windows.Forms.Clipboard]::Clear()
      } else {
        [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true)
      }
    } catch {}
  }
}

if ($Diagnostic) {
  $edgeProcessIds = @{}
  Get-Process -Name 'msedge' | ForEach-Object { $edgeProcessIds[[int]$_.Id] = $true }
  $diagnostics = @()
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  foreach ($window in $windows) {
    if (-not $edgeProcessIds.ContainsKey([int]$window.Current.ProcessId)) { continue }
    $edits = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
    foreach ($edit in $edits) {
      $diagnostics += [pscustomobject]@{
        automationId = [string]$edit.Current.AutomationId
        className = [string]$edit.Current.ClassName
        valuePattern = [bool]$edit.Current.IsValuePatternAvailable
        legacyPattern = [bool]$edit.Current.IsLegacyIAccessiblePatternAvailable
        textPattern = [bool]$edit.Current.IsTextPatternAvailable
      }
    }
  }
  [pscustomobject]@{ edgeWindowCount = @($windows | Where-Object { $edgeProcessIds.ContainsKey([int]$_.Current.ProcessId) }).Count; editControls = $diagnostics } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

function Get-PixivCallbackUrls {
  $results = New-Object System.Collections.Generic.List[string]
  $edgeProcessIds = @{}
  Get-Process -Name 'msedge' | ForEach-Object { $edgeProcessIds[[int]$_.Id] = $true }
  if ($edgeProcessIds.Count -eq 0) { return $results }
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  foreach ($window in $windows) {
    if (-not $edgeProcessIds.ContainsKey([int]$window.Current.ProcessId)) { continue }
    try {
      $addressBar = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
      if ($null -eq $addressBar) { continue }
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
      if ([string]::IsNullOrWhiteSpace($value) -and $addressBar.Current.IsTextPatternAvailable) {
        try {
          $text = $addressBar.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
          $value = [string]$text.DocumentRange.GetText(-1)
        } catch {}
      }
      if ([string]::IsNullOrWhiteSpace($value)) { $value = [string]$addressBar.Current.Name }
      if ([string]::IsNullOrWhiteSpace($value)) { $value = [string]$addressBar.Current.HelpText }
      if ([string]::IsNullOrWhiteSpace($value)) { $value = [string]$addressBar.Current.ItemStatus }
      $uri = $null
      if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri)) { continue }
      if ($uri.Scheme -ne 'https' -or $uri.Host -ne $callbackHost -or $uri.AbsolutePath -ne $callbackPath) { continue }
      $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
      if ([string]::IsNullOrWhiteSpace($query.Get('code'))) { continue }
      $results.Add($uri.AbsoluteUri)
    } catch { continue }
  }
  return $results
}

$ignoredCallbacks = @{}
if (-not $CaptureExisting) {
  Get-PixivCallbackUrls | ForEach-Object { $ignoredCallbacks[[string]$_] = $true }
}

[Console]::Out.WriteLine('NPM_PIXIV_WATCHER_READY')
if ($SelfTest) { exit 0 }

while ([DateTime]::UtcNow -lt $deadline) {
  foreach ($callbackUrl in (Get-PixivCallbackUrls)) {
    if ($ignoredCallbacks.ContainsKey([string]$callbackUrl)) { continue }
    [Console]::Out.WriteLine($callbackUrl)
    exit 0
  }
  Start-Sleep -Milliseconds 300
}

exit 2
