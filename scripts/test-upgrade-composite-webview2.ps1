param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]+$')][string]$Prefix
)
$ErrorActionPreference='Stop'
$atlasRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$atlasArtifacts=Join-Path $atlasRoot '.artifacts'
$atlasExe=Join-Path $atlasRoot 'src-tauri/target/release/examples/local_storage_probe.exe'
$atlasBundle=(Resolve-Path -LiteralPath $Bundle).Path
$atlasProbe=Join-Path $atlasRoot 'tests/native/upgrade-composite-probe.js'
$atlasOutput=Join-Path $atlasArtifacts ($Prefix+'.jsonl')
$atlasErrors=Join-Path $atlasArtifacts ($Prefix+'-stderr.log')
$atlasManifest=Join-Path $atlasArtifacts ($Prefix+'-manifest.json')
foreach($atlasPath in @($atlasOutput,$atlasErrors,$atlasManifest)){
  if(Test-Path -LiteralPath $atlasPath){throw 'Evidence already exists; select a new prefix'}
}
$atlasProfile=Join-Path $atlasArtifacts ('local-webview2-probe-composite-'+[guid]::NewGuid().ToString('N'))
@{profile=$atlasProfile;startedAt=(Get-Date -Format o);files=(@($atlasExe,$atlasBundle,$atlasProbe)|Get-FileHash -Algorithm SHA256|Select-Object Path,Hash)}|ConvertTo-Json -Depth 4|Set-Content $atlasManifest
$atlasProcess=Start-Process -FilePath $atlasExe -WorkingDirectory $atlasRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $atlasOutput -RedirectStandardError $atlasErrors -ArgumentList @(('"'+$atlasBundle+'"'),('"'+$atlasProbe+'"'),('"'+$atlasProfile+'"'))
try{
  if(-not $atlasProcess.WaitForExit(30000)){throw 'Native composite fixture did not finish within 30 seconds'}
  $atlasJson=Get-Content -LiteralPath $atlasOutput|Where-Object{$_.StartsWith('{')}|Select-Object -First 1
  if(-not $atlasJson){throw 'Missing native JSON evidence'}
  $atlasResult=$atlasJson|ConvertFrom-Json
  if(-not $atlasResult.ok -or $atlasResult.nativeImagesDecoded -ne 3 -or -not $atlasResult.restartUnchanged -or -not $atlasResult.originalOutboxDeviceIdsPreserved -or $atlasResult.recoveredSending -ne 1){throw "Native composite validation failed: $atlasJson"}
  Write-Output $atlasJson
  $atlasRestartOutput=Join-Path $atlasArtifacts ($Prefix+'-restart.jsonl')
  $atlasRestartErrors=Join-Path $atlasArtifacts ($Prefix+'-restart-stderr.log')
  $atlasProcess=Start-Process -FilePath $atlasExe -WorkingDirectory $atlasRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $atlasRestartOutput -RedirectStandardError $atlasRestartErrors -ArgumentList @(('"'+$atlasBundle+'"'),('"'+$atlasProbe+'"'),('"'+$atlasProfile+'"'))
  if(-not $atlasProcess.WaitForExit(30000)){throw 'Native process restart did not finish within 30 seconds'}
  $atlasRestartJson=Get-Content -LiteralPath $atlasRestartOutput|Where-Object{$_.StartsWith('{')}|Select-Object -First 1
  $atlasRestart=$atlasRestartJson|ConvertFrom-Json
  if(-not $atlasRestart.ok -or -not $atlasRestart.nativeProcessRestart -or $atlasRestart.nativeImagesDecoded -ne 3 -or -not $atlasRestart.restartUnchanged){throw "Native process restart validation failed: $atlasRestartJson"}
  Write-Output $atlasRestartJson
}finally{
  if(-not $atlasProcess.HasExited){
    $atlasOwned=Get-Process -Id $atlasProcess.Id
    if($atlasOwned.Path -eq $atlasExe -and $atlasOwned.StartTime -eq $atlasProcess.StartTime){Stop-Process -Id $atlasOwned.Id -Force}
  }
}
