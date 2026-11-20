param(
    [string]$RuntimeCache = (Join-Path ([IO.Path]::GetTempPath()) 'YanZhouSport-runtime-cache')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
$name = "YanZhou-Sport-Live-NXT-$($manifest.version)-Windows-x64"
$nodeVersion = 'v24.22.3'
$runtimeName = "node-$nodeVersion-win-x64"
$runtimeHash = 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$dist = (New-Item -ItemType Directory -Path (Join-Path $root 'dist') -Force).FullName
$stage = (New-Item -ItemType Directory -Path (Join-Path $dist ('.stage-' + [guid]::NewGuid().ToString('N')))).FullName
$cache = (New-Item -ItemType Directory -Path $RuntimeCache -Force).FullName
$archive = Join-Path $cache "$runtimeName.zip"

try {
    if (!(Test-Path -LiteralPath $archive -PathType Leaf)) {
        $download = Join-Path $stage 'node-download.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$nodeVersion/$runtimeName.zip" -OutFile $download -TimeoutSec 180
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $runtimeHash) { throw 'Official Node.js ZIP checksum mismatch.' }
        Copy-Item -LiteralPath $download -Destination $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $runtimeHash) { throw 'Cached Node.js ZIP checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    $release = (New-Item -ItemType Directory -Path (Join-Path $stage $name)).FullName
    foreach ($item in @('LICENSE', 'README.md', 'start.cmd', 'package.json', 'package-lock.json', 'server', 'public')) {
        Copy-Item -LiteralPath (Join-Path $root $item) -Destination $release -Recurse
    }
    $runtime = (New-Item -ItemType Directory -Path (Join-Path $release 'runtime')).FullName
    Copy-Item -LiteralPath (Join-Path $stage "$runtimeName/node.exe"), (Join-Path $stage "$runtimeName/LICENSE") -Destination $runtime
    Push-Location -LiteralPath $release
    try {
        & $npm ci --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Failed to stage runtime dependencies.' }
        & (Join-Path $runtime 'node.exe') --version
        if ($LASTEXITCODE) { throw 'The bundled runtime did not start.' }
    } finally { Pop-Location }
    $pendingZip = Join-Path $stage "$name.zip"
    Compress-Archive -LiteralPath $release -DestinationPath $pendingZip -CompressionLevel Optimal
    $zip = Join-Path $dist "$name.zip"
    Move-Item -LiteralPath $pendingZip -Destination $zip -Force
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $name.zip" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
    Get-Item -LiteralPath $zip, "$zip.sha256" | Select-Object FullName, Length
} finally {
    if (Test-Path -LiteralPath $stage -PathType Container) {
        $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
        $resolvedDist = (Resolve-Path -LiteralPath $dist).Path
        if ((Split-Path -Parent $resolvedStage) -eq $resolvedDist -and (Split-Path -Leaf $resolvedStage) -like '.stage-*') {
            Remove-Item -LiteralPath $resolvedStage -Recurse -Force
        }
    }
}
