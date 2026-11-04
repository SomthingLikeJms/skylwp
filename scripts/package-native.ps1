param([switch]$SkipBuild, [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(!$OutputDirectory){$OutputDirectory=Join-Path $projectRoot 'outputs'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
Push-Location $projectRoot
try {
    if(!$SkipBuild){
        $env:Path='C:\Program Files\nodejs;'+$env:Path
        & npm.cmd run build
        if($LASTEXITCODE -ne 0){throw '前端构建失败'}
        & "$PSScriptRoot\cargo.ps1" build --release --manifest-path apps/shell/Cargo.toml
        if($LASTEXITCODE -ne 0){throw '桌面构建失败'}
    }
    $destination=Join-Path $OutputDirectory 'AsciiCity-Wallpaper'
    New-Item -ItemType Directory -Path $destination -Force|Out-Null
    Copy-Item -LiteralPath 'apps\shell\target\release\ascii-city-wallpaper.exe' -Destination (Join-Path $destination 'AsciiCity.exe') -Force
    Copy-Item -LiteralPath 'apps\shell\target\release\WebView2Loader.dll' -Destination $destination -Force
    Copy-Item -LiteralPath 'collectors\browser-extension' -Destination $destination -Recurse -Force
    Copy-Item -LiteralPath 'docs\PORTABLE.md' -Destination (Join-Path $destination '使用说明.md') -Force
    Copy-Item -LiteralPath 'docs\THIRD-PARTY-NOTICES.txt' -Destination $destination -Force
    Copy-Item -LiteralPath 'LICENSE' -Destination $destination -Force
    Copy-Item -LiteralPath 'docs\THIRD-PARTY-LICENSES.txt' -Destination $destination -Force
    Copy-Item -LiteralPath 'docs\licenses' -Destination $destination -Recurse -Force
    [IO.File]::WriteAllText((Join-Path $destination 'Start.cmd'),"@echo off`r`nstart `"`" `"%~dp0AsciiCity.exe`"`r`n",[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $destination 'Stop.cmd'),"@echo off`r`nstart `"`" `"%~dp0AsciiCity.exe`" --stop`r`n",[Text.Encoding]::ASCII)
    # Deliberately enumerate distributable files: local data and pairing tokens stay out of the ZIP.
    $packageFiles=@('AsciiCity.exe','WebView2Loader.dll','Start.cmd','Stop.cmd','使用说明.md','LICENSE','THIRD-PARTY-NOTICES.txt','THIRD-PARTY-LICENSES.txt','licenses','browser-extension') | ForEach-Object {Join-Path $destination $_}
    Compress-Archive -LiteralPath $packageFiles -DestinationPath (Join-Path $OutputDirectory 'AsciiCity-Wallpaper.zip') -Force
    Get-Item -LiteralPath (Join-Path $OutputDirectory 'AsciiCity-Wallpaper.zip') | Select-Object FullName,Length | ConvertTo-Json -Compress
} finally {Pop-Location}
