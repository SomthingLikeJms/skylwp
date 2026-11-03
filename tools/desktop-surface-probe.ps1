$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DesktopSurfaceProbe {
 public delegate bool Visitor(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Visitor v,IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 public static string Class(IntPtr h){var s=new StringBuilder(128);GetClassName(h,s,128);return s.ToString();}
 public static IntPtr[] Lists(){var list=new List<IntPtr>();EnumWindows((h,p)=>{if(Class(h)!="Progman"&&Class(h)!="WorkerW")return true;var v=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);if(v!=IntPtr.Zero){var i=FindWindowEx(v,IntPtr.Zero,"SysListView32",null);if(i!=IntPtr.Zero)list.Add(i);}return true;},IntPtr.Zero);return list.ToArray();}
}
'@
$oldDpi=[DesktopSurfaceProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::ListItem)
 $report=@()
 foreach($handle in [DesktopSurfaceProbe]::Lists()){
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $items=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
  $matches=@();$last=@()
  for($i=0;$i -lt $items.Count;$i++){
    $r=$items[$i].Current.BoundingRectangle
    if($r.Contains([System.Windows.Point]::new(1652,432))){$matches+=@{index=$i;x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}}
    if($i -ge $items.Count-2){$last+=@{index=$i;x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}}
  }
  $report+=@{handle=$handle.ToInt64();class=[DesktopSurfaceProbe]::Class($handle);count=$items.Count;matches=$matches;last=$last}
 }
 $report|ConvertTo-Json -Depth 6
} finally {[void][DesktopSurfaceProbe]::SetThreadDpiAwarenessContext($oldDpi)}
