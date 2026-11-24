param([Parameter(Mandatory)][int]$FixtureProcess,[Parameter(Mandatory)][int]$LogicalWidth)
$ErrorActionPreference='Stop'
$fixture=Get-Process -Id $FixtureProcess
if ($fixture.MainModule.FileVersionInfo.ProductName -ne 'Atlas UX 407 fixture') {throw 'Unexpected window owner'}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TaskWindow {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr insert, int x, int y, int w, int t, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
}
"@
[void][TaskWindow]::SetProcessDpiAwarenessContext([IntPtr](-4))
$hwnd=$fixture.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero){throw 'Missing fixture window'}
$dpi=[TaskWindow]::GetDpiForWindow($hwnd)
[void][TaskWindow]::ShowWindow($hwnd,3)
Start-Sleep -Milliseconds 150
$rect=New-Object TaskWindow+Rect
if(![TaskWindow]::GetWindowRect($hwnd,[ref]$rect)){throw 'Cannot read window bounds'}
if($LogicalWidth -gt 0){
  $height=$rect.bottom-$rect.top-24
  [void][TaskWindow]::ShowWindow($hwnd,9)
  if(![TaskWindow]::SetWindowPos($hwnd,[IntPtr]::Zero,([Math]::Max(0,$rect.left)+8),([Math]::Max(0,$rect.top)+8),[int]($LogicalWidth*$dpi/96),$height,0x14)){throw 'Cannot resize fixture window'}
  Start-Sleep -Milliseconds 150
  if(![TaskWindow]::GetWindowRect($hwnd,[ref]$rect)){throw 'Cannot read resized window bounds'}
}
[pscustomobject]@{dpi=$dpi;windowWidth=$rect.right-$rect.left;windowHeight=$rect.bottom-$rect.top} | ConvertTo-Json -Compress
