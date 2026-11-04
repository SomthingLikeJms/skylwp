param([switch]$RepairOrder, [string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CityIconLayers {
 public delegate bool Visitor(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Visitor v,IntPtr p);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string n);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetStyle(IntPtr h,int i);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,uint attr,out uint value,uint size);
 public static string Class(IntPtr h){var s=new StringBuilder(128);GetClassName(h,s,128);return s.ToString();}
 public static List<object> Scan(){var list=new List<object>();EnumWindows((h,p)=>{var c=Class(h);if(c=="Progman"||c=="WorkerW")Read(h,0,list);return true;},IntPtr.Zero);return list;}
 static void Read(IntPtr h,int depth,List<object> list){uint cloaked,pid;DwmGetWindowAttribute(h,14,out cloaked,4);GetWindowThreadProcessId(h,out pid);var c=Class(h);int count=-1;if(c=="SysListView32"){IntPtr result;SendMessageTimeout(h,0x1004,IntPtr.Zero,IntPtr.Zero,2,500,out result);count=result.ToInt32();}list.Add(new{handle=h.ToInt64(),parent=GetParent(h).ToInt64(),depth,cls=c,pid,visible=IsWindowVisible(h),style=GetStyle(h,-16).ToInt64(),exstyle=GetStyle(h,-20).ToInt64(),cloaked,items=count});if(depth>=3)return;for(var child=GetWindow(h,5);child!=IntPtr.Zero;child=GetWindow(child,2))Read(child,depth+1,list);}
 public static bool Above(IntPtr window,IntPtr icons){for(var h=GetWindow(icons,3);h!=IntPtr.Zero;h=GetWindow(h,3))if(h==window)return true;return false;}
}
'@
$projectRoot=Split-Path -Parent $PSScriptRoot
$data=Join-Path $projectRoot 'outputs\AsciiCity-Wallpaper\data'
$runtime=Get-Content -LiteralPath (Join-Path $data 'runtime.json') -Raw | ConvertFrom-Json
$status=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$runtime.port+'/status') -Headers @{Authorization='Bearer '+$runtime.token}
$handle=[IntPtr][long]$status.hwnd
$parent=[CityIconLayers]::GetParent($handle)
$icons=[CityIconLayers]::FindWindowEx($parent,[IntPtr]::Zero,'SHELLDLL_DefView',$null)
$wasAbove=$icons -ne [IntPtr]::Zero -and [CityIconLayers]::Above($handle,$icons)
if($RepairOrder){
 if($status.mode -ne 'wallpaper' -or $icons -eq [IntPtr]::Zero){throw 'No shared icon parent in wallpaper mode.'}
 if((Get-Process -Id $runtime.pid).Path -ne (Join-Path $projectRoot 'outputs\AsciiCity-Wallpaper\AsciiCity.exe')){throw 'Unexpected wallpaper process.'}
 if(-not [CityIconLayers]::SetWindowPos($handle,$icons,0,0,0,0,0x0213)){throw 'Could not lower wallpaper below icons.'}
}
$report=[PSCustomObject]@{version=$status.version;mode=$status.mode;wallpaper=$status.hwnd;icons=$icons.ToInt64();wasAboveIcons=$wasAbove;aboveIcons=($icons -ne [IntPtr]::Zero -and [CityIconLayers]::Above($handle,$icons));windows=[CityIconLayers]::Scan()}
$json=$report | ConvertTo-Json -Depth 6
if($OutputPath){$json | Set-Content -LiteralPath $OutputPath -Encoding utf8}
$json
