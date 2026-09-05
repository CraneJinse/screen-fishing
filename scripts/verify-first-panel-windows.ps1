param([string]$AppRoot = '', [string]$Profile = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'artifacts') -Force | Out-Null
$electron = Join-Path $projectRoot 'node_modules/electron/dist/electron.exe'
$results = @()
$cases = @(
  @{ Name='hidden-1'; Style='Hidden'; Mode='' },
  @{ Name='hidden-2'; Style='Hidden'; Mode='' },
  @{ Name='hidden-3'; Style='Hidden'; Mode='' },
  @{ Name='normal'; Style='Normal'; Mode='' },
  @{ Name='hidden-slow'; Style='Hidden'; Mode='--slow' },
  @{ Name='hidden-failure'; Style='Hidden'; Mode='--failure' }
)
foreach ($case in $cases) {
  $arguments = 'scripts/verify-first-panel-open.js ' + $case.Mode
  if ($AppRoot) { $arguments += ' --app-root "' + $AppRoot + '"' }
  if ($Profile) { $arguments += ' --profile "' + $Profile + '"' }
  $out = Join-Path $projectRoot ('artifacts/windows-panel-' + $case.Name + '.log')
  $err = Join-Path $projectRoot ('artifacts/windows-panel-' + $case.Name + '.err')
  $probe = Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle $case.Style -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $processHandle = $probe.Handle # Retain the handle so Windows PowerShell preserves ExitCode.
  if (-not $probe.WaitForExit(30000)) { Stop-Process -Id $probe.Id; throw "Test timeout: $($case.Name)" }
  $mode = if ($case.Mode) { $case.Mode.Substring(2) } else { 'normal' }
  $result = Get-Content -LiteralPath (Join-Path $projectRoot "artifacts/first-panel-$mode-report.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($probe.ExitCode -ne 0) { throw "Test process failed: $($case.Name), see $err" }
  $results += [ordered]@{ name=$case.Name; ok=$result.ok; checks=$result.checks }
  if (-not $result.ok) { throw "First panel regression: $($case.Name), see $out" }
}
$report = [ordered]@{ ok=$true; appRoot=$AppRoot; cases=$results; input='Chromium input; real Windows process startup styles' }
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $projectRoot 'artifacts/windows-panel-report.json') -Encoding UTF8
$results | ForEach-Object { Write-Output ($_.name + ': PASS') }
