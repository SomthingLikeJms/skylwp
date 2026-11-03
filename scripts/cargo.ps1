param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CargoArgs)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME = Join-Path $projectRoot '.toolchain\cargo'
$env:RUSTUP_HOME = Join-Path $projectRoot '.toolchain\rustup'
$env:CARGO_BUILD_JOBS = '8'
$rustBin = Join-Path $env:CARGO_HOME 'bin'
$mingwBin = Join-Path $env:RUSTUP_HOME 'toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin'
$gccBin = Join-Path $projectRoot '.toolchain\w64devkit\bin'
$env:Path = "$rustBin;$gccBin;$mingwBin;" + $env:Path
$env:CC = Join-Path $gccBin 'gcc.exe'
$env:CXX = Join-Path $gccBin 'g++.exe'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = $env:CC
$compat = Join-Path $projectRoot '.toolchain\gcc-compat'
New-Item -ItemType Directory -Path $compat -Force | Out-Null
$runtime = Join-Path $env:RUSTUP_HOME 'toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\lib\self-contained\libgcc_eh.a'
Copy-Item -LiteralPath $runtime -Destination (Join-Path $compat 'libgcc_eh.a') -Force
$env:RUSTFLAGS = '-Lnative=' + $compat
& (Join-Path $rustBin 'cargo.exe') @CargoArgs
exit $LASTEXITCODE
