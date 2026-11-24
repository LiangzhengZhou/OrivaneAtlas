param(
    [Parameter(Mandatory)] [string] $Executable,
    [Parameter(Mandatory)] [string] $OutputDirectory
)
$ErrorActionPreference = 'Stop'
$exe = Get-Item -LiteralPath $Executable
if ($exe.VersionInfo.ProductName -notin @('Atlas UX 404 fixture', 'Atlas UX 405 icon fixture')) {
    throw 'Supply the isolated unsigned icon fixture.'
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Supply a new output directory.' }
$out = (New-Item -ItemType Directory -Path $OutputDirectory).FullName
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IconProbe {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern uint PrivateExtractIconsW(string file, int index, int width, int height, out IntPtr icon, out uint id, uint count, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr kind, IntPtr dpi, uint flags, uint timeout, out IntPtr result);
}
'@

$shell = foreach ($size in @(16,20,24,28,30,32,36,40,42,48,56,60,64,72,80,96,128,256)) {
    $handle = [IntPtr]::Zero
    $id = [uint32]0
    $count = [IconProbe]::PrivateExtractIconsW($exe.FullName, 0, $size, $size, [ref]$handle, [ref]$id, 1, 0)
    if ($count -ne 1 -or $handle -eq [IntPtr]::Zero) { throw "Shell extraction failed for $size px" }
    try {
        $icon = [Drawing.Icon]::FromHandle($handle)
        if ($icon.Width -ne $size -or $icon.Height -ne $size) { throw "Unexpected icon dimensions for $size px" }
        $bitmap = $icon.ToBitmap()
        try { $bitmap.Save((Join-Path $out "$size.png"), [Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
        [ordered]@{px=$size; resourceId=$id}
    } finally { [void][IconProbe]::DestroyIcon($handle) }
}
$start = [Diagnostics.ProcessStartInfo]::new($exe.FullName)
$start.WorkingDirectory = $out
$start.UseShellExecute = $false
$start.WindowStyle = 'Hidden'
$start.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $out 'profile'
$process = [Diagnostics.Process]::Start($start)
try {
    $until = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 250
        $process.Refresh()
        if ($process.HasExited) { throw 'Fixture exited before opening its window.' }
        $hwnd = $process.MainWindowHandle
    } while ($hwnd -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $until)
    if ($hwnd -eq [IntPtr]::Zero) { throw 'No fixture window.' }
    $dpi = [IconProbe]::GetDpiForWindow($hwnd)
    $live = [IntPtr]::Zero
    # WM_GETICON / ICON_SMALL returns the HICON held by the running window.
    $sent = [IconProbe]::SendMessageTimeoutW($hwnd, 0x7f, [IntPtr]::Zero, [IntPtr]([int]$dpi), 2, 3000, [ref]$live)
    if ($sent -eq [IntPtr]::Zero -or $live -eq [IntPtr]::Zero) { throw 'Window icon not available.' }
    $liveIcon = [Drawing.Icon]::FromHandle($live)
    if ($exe.VersionInfo.ProductName -eq 'Atlas UX 405 icon fixture') {
        if (@($shell.resourceId | Sort-Object -Unique).Count -ne $shell.Count) {
            throw 'Multiple requested sizes selected the same executable resource.'
        }
        if ($liveIcon.Width -ne 256 -or $liveIcon.Height -ne 256) {
            throw 'Tauri did not load the high-resolution first frame.'
        }
    }
    $bitmap = $liveIcon.ToBitmap()
    try { $bitmap.Save((Join-Path $out 'window.png'), [Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose() }
    $result = [ordered]@{
        product=$exe.VersionInfo.ProductName; dpi=$dpi
        windowIconWidth=$liveIcon.Width; windowIconHeight=$liveIcon.Height
        shellFrames=$shell
    }
    $result | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'result.json') -Encoding utf8
} finally {
    if (!$process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
