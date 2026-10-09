param([string]$ReplaceExecutable = '')

$ErrorActionPreference = 'Stop'
$repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontend = Join-Path $repository 'tensormesh'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $repository '../..'))
$cachedNpm = Join-Path $workspace 'work/package/bin/npm-cli.js'
$cachedCargo = Join-Path $workspace 'work/audit-cargo'
$previousCargoHome = $env:CARGO_HOME
$destination = $null
if ($ReplaceExecutable) {
    $destination = [System.IO.Path]::GetFullPath($ReplaceExecutable)
    if ([System.IO.Path]::GetExtension($destination) -ne '.exe') {
        throw 'Replacement target must be an explicit .exe path'
    }
    if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($destination)))) {
        throw 'Replacement target directory does not exist'
    }
    $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $destination }
    if ($running) { throw 'Close the old TensorMesh app before rebuilding it' }
}
Push-Location $frontend
try {
    if (Test-Path -LiteralPath $cachedNpm) {
        node $cachedNpm run build
    } else {
        npm run build
    }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    if (Test-Path -LiteralPath $cachedCargo) { $env:CARGO_HOME = $cachedCargo }
    cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol --locked --offline
    if ($LASTEXITCODE -ne 0) { throw 'Native build failed; old executable has not been replaced' }
    node node_modules/@tauri-apps/cli/tauri.js bundle --debug --no-binary-patching --config '{"bundle":{"useLocalToolsDir":true}}'
    if ($LASTEXITCODE -ne 0) { throw 'Installer bundling failed' }
    $executable = Join-Path $frontend 'src-tauri/target/debug/tensormesh.exe'
    if (-not (Test-Path -LiteralPath $executable)) { throw 'New executable is missing' }
    if ($destination -and $destination -ne $executable) {
        if (Test-Path -LiteralPath $destination) {
            $backupName = [System.IO.Path]::GetFileNameWithoutExtension($destination) + '-previous-' + [guid]::NewGuid().ToString('N') + '.exe'
            $backup = Join-Path ([System.IO.Path]::GetDirectoryName($destination)) $backupName
            Copy-Item -LiteralPath $destination -Destination $backup
            Write-Output "Original preserved: $backup"
        }
        Copy-Item -LiteralPath $executable -Destination $destination -Force
        $expectedHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
        $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($actualHash -ne $expectedHash) { throw 'Replacement executable verification failed' }
        Write-Output "Replaced and hash-verified: $destination"
    }
    Write-Output "Updated executable: $frontend/src-tauri/target/debug/tensormesh.exe"
    Write-Output "Updated installer: $frontend/src-tauri/target/debug/bundle/nsis/"
} finally {
    $env:CARGO_HOME = $previousCargoHome
    Pop-Location
}
