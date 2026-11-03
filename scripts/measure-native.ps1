param([string]$DataDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\AsciiCity-Wallpaper\data'), [int]$Seconds = 30)
$ErrorActionPreference='Stop'
$runtime=Get-Content -LiteralPath (Join-Path $DataDirectory 'runtime.json') -Raw | ConvertFrom-Json
$wallpaperPid=[int]$runtime.pid
$headers=@{Authorization=('Bearer '+$runtime.token)}
$baseUrl='http://127.0.0.1:'+$runtime.port
function Get-WallpaperProcessTree {
    $processes=Get-CimInstance Win32_Process
    $ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add($wallpaperPid)
    # A rapidly restarted WebView can briefly reuse a browser process whose
    # original parent already exited. Include our unique portable data directory.
    $profileDirectory=[IO.Path]::GetFullPath($DataDirectory)
    foreach($process in $processes){
        if($process.Name -eq 'msedgewebview2.exe' -and $process.CommandLine -and $process.CommandLine.IndexOf($profileDirectory,[StringComparison]::OrdinalIgnoreCase) -ge 0){[void]$ids.Add([int]$process.ProcessId)}
    }
    do {$added=$false;foreach($process in $processes){if($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)){$added=$true}}}while($added)
    return $ids
}
function Read-Sample {
    $ids=Get-WallpaperProcessTree
    $cpu=0.0;$working=0.0;$private=0.0
    foreach($id in $ids){try{$process=Get-Process -Id $id -ErrorAction Stop;$cpu+=$process.TotalProcessorTime.TotalSeconds;$working+=$process.WorkingSet64;$private+=$process.PrivateMemorySize64}catch{}}
    $privateWorking=0.0
    try {Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$ids.Contains([int]$_.IDProcess)} | ForEach-Object {$privateWorking+=[double]$_.WorkingSetPrivate}}catch{}
    [pscustomobject]@{Time=[Diagnostics.Stopwatch]::GetTimestamp()/[Diagnostics.Stopwatch]::Frequency;Cpu=$cpu;WorkingMiB=$working/1MB;PrivateMiB=$private/1MB;PrivateWorkingMiB=$privateWorking/1MB;Processes=$ids.Count}
}
$status=Invoke-RestMethod -Uri ($baseUrl+'/status') -Headers $headers
$originalConfig=$status.config
$testConfig=$originalConfig | ConvertTo-Json -Depth 8 | ConvertFrom-Json
$testConfig.pauseWhenCovered=$false
Invoke-RestMethod -Uri ($baseUrl+'/config') -Method Post -Headers $headers -ContentType 'application/json' -Body ($testConfig|ConvertTo-Json -Depth 8) | Out-Null
$logical=[Environment]::ProcessorCount
$measurements=@()
try { foreach($mode in @('running','paused')) {
    $command=if($mode -eq 'running'){'resume'}else{'pause'}
    Invoke-RestMethod -Uri ($baseUrl+'/command') -Method Post -Headers $headers -ContentType 'application/json' -Body (@{command=$command}|ConvertTo-Json) | Out-Null
    $before=Read-Sample
    $samples=@()
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while($clock.Elapsed.TotalSeconds -lt $Seconds){Start-Sleep -Seconds 2;$samples+=Read-Sample}
    $last=$samples[-1]
    $measurements+=[pscustomobject]@{Mode=$mode;Seconds=$last.Time-$before.Time;CpuPercent=100*($last.Cpu-$before.Cpu)/($last.Time-$before.Time)/$logical;PrivateWorkingMiB=($samples|Measure-Object PrivateWorkingMiB -Average).Average;WorkingMiB=($samples|Measure-Object WorkingMiB -Average).Average;PrivateCommittedMiB=($samples|Measure-Object PrivateMiB -Average).Average;Processes=($samples|Measure-Object Processes -Maximum).Maximum}
}
} finally {
    try {
        $latest=(Invoke-RestMethod -Uri ($baseUrl+'/status') -Headers $headers).config
        $latest.pauseWhenCovered=$originalConfig.pauseWhenCovered
        Invoke-RestMethod -Uri ($baseUrl+'/config') -Method Post -Headers $headers -ContentType 'application/json' -Body ($latest|ConvertTo-Json -Depth 8) | Out-Null
    } catch {
        $settingsFile=Join-Path $DataDirectory 'settings.json'
        $latest=Get-Content -LiteralPath $settingsFile -Raw|ConvertFrom-Json
        $latest.pauseWhenCovered=$originalConfig.pauseWhenCovered
        $latest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $settingsFile -Encoding utf8
    }
}
Invoke-RestMethod -Uri ($baseUrl+'/command') -Method Post -Headers $headers -ContentType 'application/json' -Body '{"command":"resume"}' | Out-Null
$report=[pscustomobject]@{MeasuredAt=(Get-Date -Format o);LogicalProcessors=$logical;Scope='Host, all descendants, and WebView2 processes using this portable data directory; private working set excludes shared pages';Measurements=$measurements;Status=(Invoke-RestMethod -Uri ($baseUrl+'/status') -Headers $headers)}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\artifacts\native-resources.json') -Encoding utf8
$measurements | ConvertTo-Json -Compress
