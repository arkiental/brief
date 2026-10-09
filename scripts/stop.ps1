$ErrorActionPreference = 'Stop'
$briefRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $briefRoot '.runtime/server.pid'
if (!(Test-Path -LiteralPath $pidPath)) { Write-Output 'Brief is not running.'; exit 0 }
$briefPid = [int](Get-Content -LiteralPath $pidPath)
$briefProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $briefPid" -ErrorAction SilentlyContinue
if ($briefProcess -and $briefProcess.CommandLine -and $briefProcess.CommandLine.Contains((Join-Path $briefRoot 'server.js'))) {
  Stop-Process -Id $briefPid
  Write-Output 'Brief stopped.'
} elseif ($briefProcess) {
  throw 'The recorded process belongs to another command. It was not stopped.'
}
Remove-Item -LiteralPath $pidPath
