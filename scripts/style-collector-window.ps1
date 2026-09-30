param([switch]$SelfTest, [string]$AppearanceJson = '')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot 'style-collector-window.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
[AtelierCollectorWindow]::Run($SelfTest.IsPresent, $AppearanceJson)
