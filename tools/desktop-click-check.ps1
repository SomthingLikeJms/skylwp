param([string]$ProjectRoot=(Split-Path -Parent $PSScriptRoot),[switch]$ProbeOnly)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName Accessibility
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
[ComImport,Guid("618736e0-3c3d-11cf-810c-00aa00389b71"),InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
public interface IDesktopAccessibleHit { [DispId(-5017)] [return:MarshalAs(UnmanagedType.Struct)] object HitTest(int x,int y); }
public static class CityClickQA {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
 [StructLayout(LayoutKind.Explicit)] public struct InputData { [FieldOffset(0)] public Mouse Mouse; }
 [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public InputData Data; }
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll",EntryPoint="GetPhysicalCursorPos")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll",EntryPoint="SetPhysicalCursorPos")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,Input[] inputs,int size);
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,out IDesktopAccessibleHit result);
 public static object HitTest(IntPtr h,int x,int y){var iid=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");IDesktopAccessibleHit result;var hr=AccessibleObjectFromWindow(h,unchecked((uint)-4),ref iid,out result);Marshal.ThrowExceptionForHR(hr);return result.HitTest(x,y);}
 public static string Class(Point p){var s=new StringBuilder(128);GetClassName(WindowFromPoint(p),s,128);return s.ToString();}
 public static void Button(bool down){var i=new Input { Type=0, Data=new InputData { Mouse=new Mouse { Flags=down?2u:4u } } };if(SendInput(1,new[]{i},Marshal.SizeOf<Input>())!=1)throw new Exception("SendInput failed");}
}
'@
$runtime=Get-Content -LiteralPath (Join-Path $ProjectRoot 'outputs\AsciiCity-Wallpaper\data\runtime.json') -Raw|ConvertFrom-Json
$headers=@{Authorization="Bearer $($runtime.token)"}
$base="http://127.0.0.1:$($runtime.port)"
function CityStatus {Invoke-RestMethod -Uri "$base/status" -Headers $headers}
function CountClicks { $v=(CityStatus).counters.'desktop.click'; if($null -eq $v){0}else{[long]$v} }
$original=CityStatus
if(!$original.config.desktopFireworks){throw '桌面烟花未启用'}
if($original.manualPause){throw '请先恢复动画后再测试'}
$originalCursor=[CityClickQA+Point]::new();[void][CityClickQA]::GetCursorPos([ref]$originalCursor)
$foreground=[CityClickQA]::GetForegroundWindow()
$oldDpi=[CityClickQA]::SetThreadDpiAwarenessContext([IntPtr](-4))
$shell=New-Object -ComObject Shell.Application
$minimized=$false
try {
    Invoke-RestMethod -Method Post -Uri "$base/command" -Headers $headers -ContentType 'application/json' -Body '{"command":"wallpaper"}'|Out-Null
    $shell.MinimizeAll();$minimized=$true
    Start-Sleep -Milliseconds 1300
    $rect=[CityClickQA+Rect]::new();[void][CityClickQA]::GetWindowRect([IntPtr][long](CityStatus).hwnd,[ref]$rect)
    $point=[CityClickQA+Point]::new()
    $point.X=$rect.Left+[int](($rect.Right-$rect.Left)*0.97)
    $point.Y=$rect.Top+[int](($rect.Bottom-$rect.Top)*0.24)
    $class=[CityClickQA]::Class($point)
    if($class -notin @('SysListView32','SHELLDLL_DefView','Progman','WorkerW')){throw "目标不是桌面：$class"}
    $element=[System.Windows.Automation.AutomationElement]::FromHandle([CityClickQA]::WindowFromPoint($point))
    $control=$element.Current.ControlType.ProgrammaticName
    if($control -ne 'ControlType.List' -and $control -ne 'ControlType.Pane'){throw "目标不是空白区域：$control"}
    $hit=[CityClickQA]::HitTest([CityClickQA]::WindowFromPoint($point),$point.X,$point.Y)
    if($hit -isnot [int] -or $hit -ne 0){
      $found=$false
      :scan foreach($fy in @(0.24,0.34,0.44,0.54,0.64,0.74,0.84,0.94,0.99)){
        foreach($fx in @(0.88,0.97,0.75,0.55,0.35,0.15,0.995)){
          $probe=[CityClickQA+Point]::new();$probe.X=$rect.Left+[int](($rect.Right-$rect.Left)*$fx);$probe.Y=$rect.Top+[int](($rect.Bottom-$rect.Top)*$fy)
          if([CityClickQA]::Class($probe) -notin @('SysListView32','SHELLDLL_DefView','Progman','WorkerW')){continue}
          $value=[CityClickQA]::HitTest([CityClickQA]::WindowFromPoint($probe),$probe.X,$probe.Y)
          if($value -is [int] -and $value -eq 0){$point=$probe;$found=$true;break scan}
        }
      }
      if(!$found){throw "未找到桌面空白点，初始命中类型为 $($hit.GetType().FullName)，值 $hit"}
    }
    if($ProbeOnly){[pscustomobject]@{physicalPoint=$point;actualHit='desktop background';windowClass=$class}|ConvertTo-Json -Depth 3;return}
    [void][CityClickQA]::SetCursorPos($point.X,$point.Y)
    $actualPoint=[CityClickQA+Point]::new();[void][CityClickQA]::GetCursorPos([ref]$actualPoint)
    if([Math]::Abs($actualPoint.X-$point.X) -gt 1 -or [Math]::Abs($actualPoint.Y-$point.Y) -gt 1){throw '鼠标物理坐标与目标不一致'}
    Start-Sleep -Milliseconds 200
    $hoverHit=[CityClickQA]::HitTest([CityClickQA]::WindowFromPoint($point),$point.X,$point.Y)
    if($hoverHit -isnot [int] -or $hoverHit -ne 0){throw '悬停后目标属于图标，未发送点击'}
    $before=CountClicks
    [CityClickQA]::Button($true);Start-Sleep -Milliseconds 50;[CityClickQA]::Button($false)
    Start-Sleep -Milliseconds 1050
    $after=CountClicks
    if($after -ne $before+1){
      [void][CityClickQA]::GetCursorPos([ref]$actualPoint)
      [pscustomobject]@{expected=$point;actual=$actualPoint;postHit=[CityClickQA]::HitTest([CityClickQA]::WindowFromPoint($point),$point.X,$point.Y)}|ConvertTo-Json -Depth 3
      & (Join-Path $ProjectRoot 'apps\shell\target\release\examples\desktop_hit.exe') $point.X $point.Y
      throw "桌面实际点击未触发：$before -> $after"
    }
    $env:Path='C:\Program Files\nodejs;'+$env:Path
    & node (Join-Path $ProjectRoot 'tools\native-firework-frame.mjs')
    if($LASTEXITCODE -ne 0){throw '前端烟花验证失败'}
    # Drag away and return: it must remain Explorer selection, not a second firework.
    [CityClickQA]::Button($true)
    [void][CityClickQA]::SetCursorPos($point.X+70,$point.Y+30)
    Start-Sleep -Milliseconds 70
    [void][CityClickQA]::SetCursorPos($point.X,$point.Y)
    [CityClickQA]::Button($false)
    Start-Sleep -Milliseconds 350
    $drag=CountClicks
    if($drag -ne $after){throw '拖动框选误触发烟花'}
    $report=[pscustomobject]@{actualWindowsInput=$true;windowClass=$class;controlType=$control;point=$point;before=$before;afterClick=$after;afterDrag=$drag;dragIgnored=$true;mode=(CityStatus).mode}
    $report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $ProjectRoot 'artifacts\climate-water\desktop-click-report.json') -Encoding utf8
    $report|ConvertTo-Json -Depth 5
} finally {
    if($minimized){$shell.UndoMinimizeALL()}
    [void][CityClickQA]::SetCursorPos($originalCursor.X,$originalCursor.Y)
    [void][CityClickQA]::SetForegroundWindow($foreground)
    [void][CityClickQA]::SetThreadDpiAwarenessContext($oldDpi)
}
