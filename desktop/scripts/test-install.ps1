$ErrorActionPreference = 'Stop'
# Installs the real appId: run only on a disposable hosted CI account.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer acceptance requires a disposable GitHub-hosted Windows runner.'
}
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRoot = Split-Path $desktopRoot
$version = (Get-Content (Join-Path $desktopRoot 'package.json') | ConvertFrom-Json).version
$installer = (Resolve-Path (Join-Path $repoRoot "release/WhyJ-Quant-Setup-$version-win-x64.exe")).Path
$installDir = Join-Path $env:RUNNER_TEMP '安装 验收\WhyJ Quant'
$exe = Join-Path $installDir 'WhyJ Quant.exe'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Get-InstalledApp {
  @(Get-ChildItem $uninstallRoot | Get-ItemProperty | Where-Object { $_.DisplayName -match '^WhyJ Quant(?: \d.*)?$' })
}
if ((Get-InstalledApp).Count -ne 0 -or (Test-Path -LiteralPath $installDir)) {
  throw 'Expected a clean account without an existing WhyJ Quant installation.'
}
if ([IO.Path]::GetPathRoot($installDir) -eq [IO.Path]::GetPathRoot($env:SystemRoot)) {
  throw 'Acceptance must install on a non-system drive.'
}
$dataDir = Join-Path $env:APPDATA 'WhyJ Quant\workspace\.ohquant'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$sentinel = Join-Path $dataDir 'installer-acceptance.txt'
$marker = [Guid]::NewGuid().ToString()
Set-Content -LiteralPath $sentinel -Value $marker -NoNewline
function Install-App([string[]]$InstallerArguments) {
  $process = Start-Process -FilePath $installer -ArgumentList $InstallerArguments -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $exe)) { throw "Installed executable missing: $exe" }
  if ((Get-InstalledApp).Count -ne 1) { throw 'Per-user uninstall registration missing or duplicated.' }
  if ((Get-InstalledApp)[0].DisplayVersion -ne $version) { throw 'Registered version does not match the installer.' }
  if ((Get-Content -LiteralPath $sentinel -Raw) -ne $marker) { throw 'Research data changed during installation.' }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
    $link = Join-Path $folder 'WhyJ Quant.lnk'
    if (-not (Test-Path -LiteralPath $link)) { throw "Shortcut missing: $link" }
    if ($shell.CreateShortcut($link).TargetPath -ne $exe) { throw "Shortcut points outside the selected directory: $link" }
  }
}
# NSIS requires /D last, with no quotes around its value, including spaces.
Install-App @('/S', '/currentuser', "/D=$installDir")
Write-Host 'PASS first install: non-system drive, Unicode/spaces, per-user shortcuts, data retained'
# No /D: the installer must recover the previous folder from its own registry.
Install-App @('/S', '/currentuser')
Write-Host 'PASS reinstall: selected directory and existing research data retained'
$env:WHYJ_SMOKE_EXE = $exe
Push-Location $repoRoot
try {
  bun run --cwd desktop test:smoke
  if ($LASTEXITCODE) { throw "Installed application smoke failed: $LASTEXITCODE" }
  @{ version = $version; installDir = $installDir; dataDir = $dataDir;
    checks = @('unicode-spaces-non-system-drive', 'per-user-shortcuts', 'reinstall-location', 'data-retention')
  } | ConvertTo-Json | Set-Content output/playwright/desktop/installer-result.json
} finally { Pop-Location }
