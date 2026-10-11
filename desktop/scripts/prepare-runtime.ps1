param([switch]$Offline)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$downloads = Join-Path $desktopRoot '.downloads'
$runtimeRoot = Join-Path $desktopRoot 'runtime'
New-Item -ItemType Directory -Path $downloads, $runtimeRoot -Force | Out-Null
$archives = @(
  @{ Name = 'python'; Url = 'https://www.python.org/ftp/python/3.13.12/python-3.13.12-embed-amd64.zip'; Hash = '76f238f606250c87c6beac75dccd35ee99070a13490555936abb6cb64ecce3d0'; Direct = $true },
  @{ Name = 'git'; Url = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip'; Hash = 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be'; Direct = $false }
)
foreach ($archive in $archives) {
  $zip = Join-Path $downloads ($archive.Name + '.zip')
  if (-not (Test-Path -LiteralPath $zip)) {
    if ($Offline) { throw "Missing archive: $zip" }
    if ($archive.Direct) { Invoke-WebRequest -NoProxy $archive.Url -OutFile $zip }
    else { Invoke-WebRequest $archive.Url -OutFile $zip }
  }
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archive.Hash) { throw "Checksum mismatch: $zip" }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $runtimeRoot $archive.Name) -Force
}
$pythonRoot = Join-Path $runtimeRoot 'python'
# The embedded distribution isolates imports from the machine's Python install.
@('python313.zip', '.', 'Lib/site-packages', 'import site') | Set-Content -LiteralPath (Join-Path $pythonRoot 'python313._pth') -Encoding ascii
$uvArgs = @('pip', 'install', '--python', (Join-Path $pythonRoot 'python.exe'), '--require-hashes',
  '--target', (Join-Path $pythonRoot 'Lib/site-packages'), '-r', (Join-Path $desktopRoot 'python-requirements.txt'))
if ($Offline) { $uvArgs += '--offline' }
& uv @uvArgs
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
& (Join-Path $pythonRoot 'python.exe') -c 'import akshare, akquant, yfinance, pandas_market_calendars; print("Bundled Python imports passed: AKShare " + akshare.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'Bundled Python import check failed' }
& (Join-Path $runtimeRoot 'git/cmd/git.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled Git check failed' }
$archives | Select-Object Name, Url, Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'sources.json')
Copy-Item -LiteralPath (Join-Path $desktopRoot 'python-requirements.txt') -Destination $runtimeRoot
