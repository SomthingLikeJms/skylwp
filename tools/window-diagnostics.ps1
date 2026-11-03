param([string]$DataDirectory=(Join-Path (Split-Path -Parent $PSScriptRoot) 'outputs\AsciiCity-Wallpaper\data'))
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CityWindowDiagnostics {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int size);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetStyle(IntPtr h,int index);
 public static string ClassName(IntPtr h){var s=new StringBuilder(128);GetClassName(h,s,128);return s.ToString();}
}
'@
$status=Get-Content -LiteralPath (Join-Path $DataDirectory 'status.json') -Raw | ConvertFrom-Json
$windowHandle=[IntPtr][long]$status.hwnd
$parent=[CityWindowDiagnostics]::GetParent($windowHandle)
$outer=[CityWindowDiagnostics+Rect]::new();$client=[CityWindowDiagnostics+Rect]::new()
[void][CityWindowDiagnostics]::GetWindowRect($windowHandle,[ref]$outer)
[void][CityWindowDiagnostics]::GetClientRect($windowHandle,[ref]$client)
$above=[CityWindowDiagnostics]::GetWindow($windowHandle,3)
$below=[CityWindowDiagnostics]::GetWindow($windowHandle,2)
[pscustomobject]@{Hwnd=$status.hwnd;Parent=$parent.ToInt64();ParentClass=[CityWindowDiagnostics]::ClassName($parent);Above=[CityWindowDiagnostics]::ClassName($above);Below=[CityWindowDiagnostics]::ClassName($below);Visible=[CityWindowDiagnostics]::IsWindowVisible($windowHandle);Outer=$outer;Client=$client;Dpi=[CityWindowDiagnostics]::GetDpiForWindow($windowHandle);Style=[CityWindowDiagnostics]::GetStyle($windowHandle,-16).ToInt64();ExtendedStyle=[CityWindowDiagnostics]::GetStyle($windowHandle,-20).ToInt64()} | ConvertTo-Json -Depth 4
