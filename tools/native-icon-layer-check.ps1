param([string]$ReportPath=(Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\desktop-icons\regression.json'))
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$runtime=Get-Content -LiteralPath (Join-Path $root 'outputs\AsciiCity-Wallpaper\data\runtime.json') -Raw | ConvertFrom-Json
$base='http://127.0.0.1:'+$runtime.port
$headers=@{Authorization='Bearer '+$runtime.token}
function Status { Invoke-RestMethod -Uri ($base+'/status') -Headers $headers }
function Command([string]$name) { Invoke-RestMethod -Uri ($base+'/command') -Headers $headers -Method Post -ContentType 'application/json' -Body (@{command=$name}|ConvertTo-Json -Compress) | Out-Null }
function AwaitMode([string]$mode) {
 $deadline=[DateTime]::UtcNow.AddSeconds(6)
 do { $s=Status; if($s.mode -eq $mode -and $s.hwnd -ne 0){return $s};Start-Sleep -Milliseconds 100 } while([DateTime]::UtcNow -lt $deadline)
 throw "Mode did not become $mode"
}
function IconState {
 $s=Status;$h=[IntPtr][long]$s.hwnd;$p=[CityIconLayers]::GetParent($h)
 $icons=[CityIconLayers]::FindWindowEx($p,[IntPtr]::Zero,'SHELLDLL_DefView',$null)
 if($icons -eq [IntPtr]::Zero){throw 'This test requires the shared-parent Windows 11 desktop.'}
 [PSCustomObject]@{window=$h;parent=$p;icons=$icons;above=[CityIconLayers]::Above($h,$icons)}
}
function AssertBelow([string]$phase) {
 $state=IconState
 if($state.above){throw "Wallpaper covers desktop icons: $phase"}
 $script:results.Add([PSCustomObject]@{phase=$phase;belowIcons=$true})
}
$initial=Status
if($initial.version -ne '0.9.2'){throw 'Expected the 0.9.2 repair build.'}
$snapshot= & (Join-Path $PSScriptRoot 'desktop-layer-check.ps1') | ConvertFrom-Json
$iconCount=@($snapshot.windows | Where-Object cls -eq 'SysListView32')[0].items
$hideIcons=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name HideIcons).HideIcons
$results=[Collections.Generic.List[object]]::new()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CityIconVisibility {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
}
'@
try {
 AssertBelow 'startup'
 Command 'wallpaper';[void](AwaitMode 'wallpaper');AssertBelow 'initial'
 $h=(IconState).window
 for($i=0;$i -lt 3;$i++){
  if(-not [CityIconLayers]::SetWindowPos($h,[IntPtr]::Zero,0,0,0,0,0x0213)){throw 'Raise attempt failed.'}
  AssertBelow "raise-$i"
  [void][CityIconVisibility]::ShowWindow($h,0)
  [void][CityIconVisibility]::ShowWindow($h,4)
  AssertBelow "show-$i"
 }
 for($i=0;$i -lt 4;$i++){
  Command 'interactive';$interactive=AwaitMode 'interactive'
  if([CityIconLayers]::GetParent([IntPtr][long]$interactive.hwnd) -ne [IntPtr]::Zero){throw 'Interactive window remained attached.'}
  Command 'wallpaper';[void](AwaitMode 'wallpaper');AssertBelow "mode-cycle-$i"
 }
 # Deliberately bypass WM_WINDOWPOSCHANGING for our own window only, proving
 # the existing five-second watchdog also detects and repairs independent drift.
 $state=IconState
 if(-not [CityIconLayers]::SetWindowPos($state.window,[IntPtr]::Zero,0,0,0,0,0x0613)){throw 'Drift injection failed.'}
 if(-not (IconState).above){throw 'The fallback repair test did not actually create order drift.'}
 $timer=[Diagnostics.Stopwatch]::StartNew()
 do {Start-Sleep -Milliseconds 150;$state=IconState} while($state.above -and $timer.Elapsed.TotalSeconds -lt 8)
 if($state.above){throw 'The watchdog did not restore desktop icon order.'}
 $results.Add([PSCustomObject]@{phase='watchdog-drift';belowIcons=$true;recoveryMs=$timer.ElapsedMilliseconds})
 AssertBelow 'final'
 $current=Status
 if(($initial.config|ConvertTo-Json -Depth 30 -Compress) -ne ($current.config|ConvertTo-Json -Depth 30 -Compress)){throw 'User configuration changed.'}
 if((Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name HideIcons).HideIcons -ne $hideIcons){throw 'Desktop icon preference changed.'}
 $final= & (Join-Path $PSScriptRoot 'desktop-layer-check.ps1') | ConvertFrom-Json
 $finalCount=@($final.windows | Where-Object cls -eq 'SysListView32')[0].items
 $report=[PSCustomObject]@{version=$current.version;iconCountBefore=$iconCount;iconCountAfter=$finalCount;configurationPreserved=$true;iconPreferencePreserved=$true;checks=$results}
 $report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $ReportPath -Encoding utf8
 $report | ConvertTo-Json -Depth 7
} finally {
 Command 'wallpaper';[void](AwaitMode 'wallpaper')
 $state=IconState
 if($state.above){[void][CityIconLayers]::SetWindowPos($state.window,$state.icons,0,0,0,0,0x0213)}
}
