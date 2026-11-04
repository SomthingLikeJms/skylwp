param(
 [Parameter(Mandatory=$true)][string]$DataDirectory,
 [Parameter(Mandatory=$true)][string]$ReportPath,
 [int]$RunningSeconds=45,
 [int]$PausedSeconds=30,
 [int]$InteractiveSeconds=30
)
$ErrorActionPreference='Stop'
$runtime=Get-Content -LiteralPath (Join-Path $DataDirectory 'runtime.json') -Raw|ConvertFrom-Json
$rootProcessId=[int]$runtime.pid
$headers=@{Authorization=('Bearer '+$runtime.token)}
$baseUrl='http://127.0.0.1:'+$runtime.port
$logical=[Environment]::ProcessorCount
$script:owned=[System.Collections.Generic.HashSet[int]]::new()
$script:roles=@()
function Status { Invoke-RestMethod -Uri ($baseUrl+'/status') -Headers $headers -TimeoutSec 6 }
function Command([string]$name) { Invoke-RestMethod -Uri ($baseUrl+'/command') -Headers $headers -Method Post -ContentType 'application/json' -Body (@{command=$name}|ConvertTo-Json) -TimeoutSec 6|Out-Null }
function Configure($config) { Invoke-RestMethod -Uri ($baseUrl+'/config') -Headers $headers -Method Post -ContentType 'application/json' -Body ($config|ConvertTo-Json -Depth 10) -TimeoutSec 6|Out-Null }
function Refresh-Tree {
 $rows=@(Get-CimInstance Win32_Process -Filter "Name='AsciiCity.exe' OR Name='msedgewebview2.exe'")
 $script:owned=[System.Collections.Generic.HashSet[int]]::new();[void]$script:owned.Add($rootProcessId)
 foreach($row in $rows){if($row.Name -eq 'msedgewebview2.exe' -and $row.CommandLine -and $row.CommandLine.IndexOf($DataDirectory,[StringComparison]::OrdinalIgnoreCase) -ge 0){[void]$script:owned.Add([int]$row.ProcessId)}}
 do{$added=$false;foreach($row in $rows){if($script:owned.Contains([int]$row.ParentProcessId) -and $script:owned.Add([int]$row.ProcessId)){$added=$true}}}while($added)
 $script:roles=@($rows|Where-Object{$script:owned.Contains([int]$_.ProcessId)}|ForEach-Object{
  $role=if($_.Name -eq 'AsciiCity.exe'){'host'}elseif($_.CommandLine -match '--type=([^\s]+)'){$Matches[1]}else{'browser'}
  [pscustomobject]@{pid=$_.ProcessId;name=$_.Name;role=$role}
 })
}
function Sample {
 $rows=@(Get-CimInstance Win32_PerfRawData_PerfProc_Process|Where-Object{$script:owned.Contains([int]$_.IDProcess)})
 if(!$rows.Count){throw 'No owned process counters'}
 $cpu=@{};foreach($row in $rows){$cpu[[string]$row.IDProcess]=@{ticks=[double]$row.PercentProcessorTime;stamp=[double]$row.Timestamp_Sys100NS}}
 $gpu=@{};$gpuAvailable=$false
 try {foreach($row in Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine){if($row.Name -match '^pid_(\d+)_' -and $script:owned.Contains([int]$Matches[1])){$gpu[$row.Name]=@{ticks=[double]$row.UtilizationPercentage;stamp=[double]$row.Timestamp_Sys100NS;engine=($row.Name -replace '^pid_\d+_','')};$gpuAvailable=$true}}}catch{}
 [pscustomobject]@{at=[Diagnostics.Stopwatch]::GetTimestamp()/[Diagnostics.Stopwatch]::Frequency;cpu=$cpu;gpu=$gpu;gpuAvailable=$gpuAvailable;processes=$rows.Count;privateWorkingMiB=[double]($rows|Measure-Object WorkingSetPrivate -Sum).Sum/1MB;workingMiB=[double]($rows|Measure-Object WorkingSet -Sum).Sum/1MB;privateCommittedMiB=[double]($rows|Measure-Object PrivateBytes -Sum).Sum/1MB}
}
function Mean($values){[Math]::Round([double]($values|Measure-Object -Average).Average,3)}
function Peak($values){[Math]::Round([double]($values|Measure-Object -Maximum).Maximum,3)}
$original=Status
$testConfig=$original.config|ConvertTo-Json -Depth 10|ConvertFrom-Json
$testConfig.pauseWhenCovered=$false
$phases=@()
try {
 Configure $testConfig
 foreach($phase in @(@{name='wallpaper-running';seconds=$RunningSeconds;mode='wallpaper';pause=$false},@{name='wallpaper-paused';seconds=$PausedSeconds;mode='wallpaper';pause=$true},@{name='interactive';seconds=$InteractiveSeconds;mode='interactive';pause=$false})){
  Command $phase.mode
  if($phase.pause){Command 'pause'}else{Command 'resume'}
  Start-Sleep -Seconds 3
  $beforeStatus=Status
  for($attempt=0;$beforeStatus.mode -ne $phase.mode -and $attempt -lt 3;$attempt++){
   Command $phase.mode;Start-Sleep -Seconds 3;$beforeStatus=Status
  }
  if($beforeStatus.mode -ne $phase.mode){throw ('Mode did not stabilize: '+$phase.name)}
  Refresh-Tree
  $previous=Sample
  $start=$previous.at
  $samples=@()
  do {
   Start-Sleep -Seconds 2
   $current=Sample
   $cpuPercent=0.0
   foreach($id in $current.cpu.Keys){if($previous.cpu.ContainsKey($id)){$a=$previous.cpu[$id];$b=$current.cpu[$id];if($b.stamp -gt $a.stamp){$cpuPercent+=100*[Math]::Max(0,$b.ticks-$a.ticks)/($b.stamp-$a.stamp)/$logical}}}
   $engines=@{}
   foreach($name in $current.gpu.Keys){if($previous.gpu.ContainsKey($name)){$a=$previous.gpu[$name];$b=$current.gpu[$name];if($b.stamp -gt $a.stamp){$v=100*[Math]::Max(0,$b.ticks-$a.ticks)/($b.stamp-$a.stamp);if(!$engines.ContainsKey($b.engine)){$engines[$b.engine]=0.0};$engines[$b.engine]+=$v}}}
   $gpuPercent=if($engines.Count){[double]($engines.Values|Measure-Object -Maximum).Maximum}else{0.0}
   $s=Status
   if($s.mode -ne $phase.mode){throw ('Mode changed during measurement: '+$phase.name)}
   $samples+=[pscustomobject]@{elapsedSeconds=[Math]::Round($current.at-$start,3);cpuPercent=[Math]::Round($cpuPercent,4);busiestGpuEnginePercent=[Math]::Round($gpuPercent,4);gpuAvailable=$current.gpuAvailable;privateWorkingMiB=[Math]::Round($current.privateWorkingMiB,3);workingMiB=[Math]::Round($current.workingMiB,3);privateCommittedMiB=[Math]::Round($current.privateCommittedMiB,3);processes=$current.processes;fps=$s.metrics.fps;composeCostMs=$s.metrics.cost;paused=$s.paused;covered=$s.covered;rejectedEvents=$s.metrics.rejectedEvents}
   $previous=$current
  }while($current.at-$start -lt $phase.seconds)
  $result=[pscustomobject]@{mode=$phase.name;durationSeconds=[Math]::Round($current.at-$start,3);sampleCount=$samples.Count;cpuMeanPercent=Mean $samples.cpuPercent;cpuPeakPercent=Peak $samples.cpuPercent;busiestGpuEngineMeanPercent=Mean $samples.busiestGpuEnginePercent;busiestGpuEnginePeakPercent=Peak $samples.busiestGpuEnginePercent;gpuAvailable=($samples.gpuAvailable -contains $true);privateWorkingMeanMiB=Mean $samples.privateWorkingMiB;privateWorkingStartMiB=$samples[0].privateWorkingMiB;privateWorkingEndMiB=$samples[-1].privateWorkingMiB;privateCommitMeanMiB=Mean $samples.privateCommittedMiB;fpsMean=Mean $samples.fps;processCount=Peak $samples.processes;before=$beforeStatus;samples=$samples}
  $phases+=$result
  Write-Output ($result|Select-Object mode,durationSeconds,cpuMeanPercent,cpuPeakPercent,busiestGpuEngineMeanPercent,privateWorkingMeanMiB,privateCommitMeanMiB,fpsMean,processCount|ConvertTo-Json -Compress)
 }
} finally {
 try {$restored=(Status).config;$restored.pauseWhenCovered=$original.config.pauseWhenCovered;Configure $restored;if($original.manualPause){Command 'pause'}else{Command 'resume'};Command $original.mode}catch{Write-Warning 'Could not restore original native mode/config'}
}
$report=[ordered]@{measuredAtUtc=[DateTime]::UtcNow.ToString('o');baseCommit='1920866905a248c103cf9e024cc4b8134fbb7e85';version=$original.version;logicalProcessors=$logical;scope='Host plus all WebView2 descendants using this portable profile. CPU normalized to the entire machine. GPU is the busiest shared engine, not a sum across engines. Private working set excludes shared pages.';roles=$script:roles;phases=$phases;after=Status}
$report|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $ReportPath -Encoding UTF8
