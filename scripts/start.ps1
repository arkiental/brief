param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$briefRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $briefRoot
$runtimePath = Join-Path $briefRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$pidPath = Join-Path $runtimePath 'server.pid'
if (Test-Path -LiteralPath $pidPath) {
  $briefPid = [int](Get-Content -LiteralPath $pidPath)
  $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $briefPid" -ErrorAction SilentlyContinue
  if ($oldProcess -and $oldProcess.CommandLine -and $oldProcess.CommandLine.Contains((Join-Path $briefRoot 'server.js'))) { Write-Output 'Brief is already running.'; exit 0 }
}
if (!$NodePath) {
  $nodeSetting = Join-Path $runtimePath 'node-path.txt'
  if (Test-Path -LiteralPath $nodeSetting) { $NodePath = (Get-Content -LiteralPath $nodeSetting).Trim() }
  else { $NodePath = (Get-Command node).Source }
}
$nodeMajor = [int]((& $NodePath --version) -replace '^v(\d+).*','$1')
if ($nodeMajor -lt 22) { throw 'Brief requires Node.js 22.12 or newer. Pass -NodePath with a supported executable.' }
$serverPath = Join-Path $briefRoot 'server.js'
$briefProcess = Start-Process -FilePath $NodePath -ArgumentList '--env-file-if-exists=.env',('"' + $serverPath + '"') -WorkingDirectory $briefRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log') -PassThru
Set-Content -LiteralPath $pidPath -Value $briefProcess.Id
Start-Sleep -Milliseconds 600
if ($briefProcess.HasExited) { throw "Brief did not start. See $runtimePath\server-error.log" }
Write-Output "Brief started (process $($briefProcess.Id))."
