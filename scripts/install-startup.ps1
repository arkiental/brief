$ErrorActionPreference = 'Stop'
$startupPath = [Environment]::GetFolderPath('Startup')
$linkPath = Join-Path $startupPath 'Brief.lnk'
$launcher = Join-Path $PSScriptRoot 'start.ps1'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $linkPath) {
  $existing = $shell.CreateShortcut($linkPath)
  if (!$existing.Arguments.Contains($launcher)) { throw 'A different Brief startup entry already exists. It was not changed.' }
}
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Start the local Brief Markdown workspace'
$shortcut.Save()
Write-Output 'Brief will start when you sign in to Windows.'
