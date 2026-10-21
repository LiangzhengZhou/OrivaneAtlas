$ErrorActionPreference = 'Stop'
$atlasRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$atlasExe = Join-Path $atlasRoot 'src-tauri/target/release/examples/local_storage_probe.exe'
$atlasBundle = Join-Path $atlasRoot '.artifacts/local-storage-fixture-0/storage.js'
$atlasScript = Join-Path $atlasRoot 'tests/native/local-storage-probe.js'
$atlasProfile = Join-Path $atlasRoot ('.artifacts/local-webview2-probe-crash-' + [Guid]::NewGuid().ToString('N'))
$atlasReadyLog = Join-Path $atlasRoot '.artifacts/local-webview2-crash-checkpoint.json'
$atlasErrorLog = Join-Path $atlasRoot '.artifacts/local-webview2-crash-stderr.log'
$atlasRecoveredLog = Join-Path $atlasRoot '.artifacts/local-webview2-crash-recovered.json'
if (-not (Test-Path -LiteralPath $atlasExe)) { throw 'Build the isolated native probe first' }

$atlasProcess = Start-Process -FilePath $atlasExe -WorkingDirectory $atlasRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $atlasReadyLog -RedirectStandardError $atlasErrorLog -ArgumentList @(('"' + $atlasBundle + '"'), ('"' + $atlasScript + '"'), ('"' + $atlasProfile + '"'), 'checkpoint')
try {
    $atlasDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $atlasEvidence = $null
    while ([DateTime]::UtcNow -lt $atlasDeadline) {
        if (Test-Path -LiteralPath $atlasReadyLog) {
            $atlasLine = Get-Content -LiteralPath $atlasReadyLog | Where-Object { $_.StartsWith('{') } | Select-Object -First 1
            if ($atlasLine) { $atlasEvidence = $atlasLine | ConvertFrom-Json; break }
        }
        if ($atlasProcess.HasExited) { throw 'Probe exited before durable checkpoint' }
        Start-Sleep -Milliseconds 100
    }
    if (-not $atlasEvidence.ok -or $atlasEvidence.tasks -ne 1500 -or $atlasEvidence.outbox -ne 50) { throw 'Invalid durable checkpoint' }
    $atlasOwnedProcess = Get-Process -Id $atlasProcess.Id
    if ($atlasOwnedProcess.Path -ne $atlasExe -or $atlasOwnedProcess.StartTime -ne $atlasProcess.StartTime) { throw 'Probe process identity changed' }
    Stop-Process -Id $atlasOwnedProcess.Id -Force
    $atlasProcess.WaitForExit()
} finally {
    if (-not $atlasProcess.HasExited) {
        $atlasOwnedProcess = Get-Process -Id $atlasProcess.Id
        if ($atlasOwnedProcess.Path -eq $atlasExe -and $atlasOwnedProcess.StartTime -eq $atlasProcess.StartTime) { Stop-Process -Id $atlasOwnedProcess.Id -Force }
    }
}
Push-Location -LiteralPath $atlasRoot
try {
    & $atlasExe $atlasBundle $atlasScript $atlasProfile *> $atlasRecoveredLog
    if ($LASTEXITCODE -ne 0) { throw 'Native restart failed' }
    $atlasRecovered = (Get-Content -LiteralPath $atlasRecoveredLog | Where-Object { $_.StartsWith('{') } | Select-Object -First 1) | ConvertFrom-Json
    foreach ($atlasIdentityKey in @('workspaceId','principalId','deviceId')) {
        if ($atlasRecovered.localIdentity.$atlasIdentityKey -ne $atlasEvidence.localIdentity.$atlasIdentityKey) { throw 'Native identity changed after crash' }
    }
    if (-not $atlasRecovered.fileDurable -or -not $atlasRecovered.fileResumed -or $atlasRecovered.fileId -ne $atlasEvidence.fileId) { throw 'Native original File bytes or identity changed after crash' }
    if (-not $atlasRecovered.replicaDurable -or -not $atlasRecovered.replicaResumed) { throw 'Native canonical receipt/cursor lost after crash' }
    if (-not $atlasRecovered.commandDurable -or -not $atlasRecovered.commandResumed) { throw 'Native Work command/effect group lost after crash' }
    if (-not $atlasRecovered.commandAttemptDurable) { throw 'Native grouped sending attempt lost after crash' }
    if (-not $atlasRecovered.ok -or -not $atlasRecovered.resumed -or -not $atlasRecovered.applicationDurable -or -not $atlasRecovered.applicationResumed -or $atlasRecovered.tasks -ne 1500 -or $atlasRecovered.documents -ne 500 -or $atlasRecovered.files -ne 1000 -or $atlasRecovered.outbox -ne 50) { throw 'Native durable recovery failed' }
    Write-Output ($atlasRecovered | ConvertTo-Json -Compress)
} finally { Pop-Location }
