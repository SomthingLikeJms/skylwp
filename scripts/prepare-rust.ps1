$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchainRoot = Join-Path $projectRoot '.toolchain'
New-Item -ItemType Directory -Path $toolchainRoot -Force | Out-Null
$env:CARGO_HOME = Join-Path $toolchainRoot 'cargo'
$env:RUSTUP_HOME = Join-Path $toolchainRoot 'rustup'
$rustup = Join-Path $env:CARGO_HOME 'bin\rustup.exe'
if (!(Test-Path -LiteralPath $rustup)) {
    $installer = Join-Path $toolchainRoot 'rustup-init.exe'
    Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-gnu/rustup-init.exe' -OutFile $installer
    & $installer -y --no-modify-path --profile minimal --default-host x86_64-pc-windows-gnu --default-toolchain stable
    if ($LASTEXITCODE -ne 0) { throw 'Rust 工具链准备失败' }
}
& $rustup show
$gccRoot = Join-Path $toolchainRoot 'w64devkit'
if (!(Test-Path -LiteralPath (Join-Path $gccRoot 'bin\gcc.exe'))) {
    $archive = Join-Path $toolchainRoot 'w64devkit.7z.exe'
    Invoke-WebRequest -Uri 'https://github.com/skeeto/w64devkit/releases/download/v2.11.0/w64devkit-x64-2.11.0.7z.exe' -OutFile $archive
    $extraction = Start-Process -FilePath $archive -ArgumentList @('-y',"-o$toolchainRoot") -WindowStyle Hidden -Wait -PassThru
    if ($extraction.ExitCode -ne 0) { throw 'GCC 解压失败' }
}
