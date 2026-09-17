$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repo = Split-Path -Parent $PSScriptRoot
$roots = @('src-tauri/icons/android', 'src-tauri/gen/android/app/src/main/res')
foreach ($root in $roots) {
    $folder = Join-Path $repo $root
    $launcher = Get-Content -LiteralPath (Join-Path $folder 'mipmap-anydpi-v26/ic_launcher.xml') -Raw
    if (-not $launcher.Contains('@drawable/atlas_launcher_safe_foreground')) { throw 'Safe foreground not wired' }
    $wrapper = Get-Content -LiteralPath (Join-Path $folder 'drawable/atlas_launcher_safe_foreground.xml') -Raw
    if (-not $wrapper.Contains('android:inset="13%"')) { throw 'Unexpected safe inset' }
    foreach ($density in @('mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi')) {
        $path = Join-Path $folder "mipmap-$density/ic_launcher_foreground.png"
        $bitmap = [System.Drawing.Bitmap]::new($path)
        try {
            $outside = 0
            $count = 0
            for ($y = 0; $y -lt $bitmap.Height; $y++) {
                for ($x = 0; $x -lt $bitmap.Width; $x++) {
                    if ($bitmap.GetPixel($x, $y).A -le 32) { continue }
                    $count++
                    # Resource inset scales the foreground to 74% before launcher masking.
                    $dx = ($x + 0.5 - $bitmap.Width / 2) * 0.74
                    $dy = ($y + 0.5 - $bitmap.Height / 2) * 0.74
                    if ($dx * $dx + $dy * $dy -gt [Math]::Pow($bitmap.Width * 33 / 108, 2)) { $outside++ }
                }
            }
            if ($count -eq 0 -or $outside -ne 0) { throw "Unsafe foreground: $path ($outside outside)" }
            Write-Output "$root / $density : $count visible pixels, none outside 66dp safe circle"
        } finally { $bitmap.Dispose() }
    }
}
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $repo $roots[0]) -Recurse -File) {
    $relative = [System.IO.Path]::GetRelativePath((Join-Path $repo $roots[0]), $file.FullName)
    $other = Join-Path (Join-Path $repo $roots[1]) $relative
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $other).Hash) {
        throw "Packaging resource differs: $relative"
    }
}
Write-Output 'Canonical and packaged Android icon resources match.'
