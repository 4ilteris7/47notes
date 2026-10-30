param(
  [switch]$InspectOnly,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json
$taskUserProfile = [Environment]::GetFolderPath('UserProfile')
$taskExpectedInstallDir = Join-Path $taskUserProfile 'AppData\Local\Programs\Notes'
$taskInstallDir = [System.IO.Path]::GetFullPath($taskExpectedInstallDir)
$taskExecutable = Join-Path $taskInstallDir 'Notes.exe'
$taskArchive = Join-Path $taskInstallDir 'resources\app.asar'
$taskInstaller = Join-Path $taskRoot "release\Notes-Setup-$($taskManifest.version).exe"
$taskDataDir = Join-Path $taskUserProfile 'AppData\Roaming\Notes'
$taskLinks = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Notes.lnk'),
  (Join-Path $taskUserProfile 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Notes.lnk')
)

if ($taskInstallDir -ne $taskExpectedInstallDir) { throw 'Kurulum hedefi beklenen Notes klasoru degil.' }
foreach ($taskRequired in @($taskExecutable, $taskArchive, $taskInstaller)) {
  if (-not (Test-Path -LiteralPath $taskRequired -PathType Leaf)) { throw "Gerekli dosya bulunamadi: $taskRequired" }
}

Push-Location -LiteralPath $taskRoot
try {
  function Get-NotesPackage([string]$ArchivePath) {
    $taskJson = & node -e "const asar=require('@electron/asar'); const p=JSON.parse(asar.extractFile(process.argv[1],'package.json')); process.stdout.write(JSON.stringify({name:p.name,productName:p.productName,version:p.version}));" $ArchivePath
    if ($LASTEXITCODE -ne 0) { throw "Uygulama paketi okunamadi: $ArchivePath" }
    return ($taskJson | ConvertFrom-Json)
  }

  function Get-NotesFileHash([string]$FilePath) {
    $taskStream = [System.IO.File]::OpenRead($FilePath)
    $taskHasher = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-', '') }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
  }

  $taskBefore = Get-NotesPackage $taskArchive
  if ($taskBefore.name -ne $taskManifest.name -or $taskBefore.productName -ne $taskManifest.productName) {
    throw 'Hedef klasordeki uygulama bu Notes projesiyle eslesmiyor.'
  }

  if ($InspectOnly) {
    [pscustomobject]@{ installedVersion=$taskBefore.version; targetVersion=$taskManifest.version; installDirectory=$taskInstallDir; installer=$taskInstaller; dataDirectory=$taskDataDir } | ConvertTo-Json
    return
  }

  $taskBackupDir = Join-Path $taskRoot ('.local-updates\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
  New-Item -ItemType Directory -Path $taskBackupDir -Force | Out-Null
  Copy-Item -LiteralPath $taskArchive -Destination (Join-Path $taskBackupDir 'previous-app.asar')
  foreach ($taskLink in $taskLinks) {
    if (Test-Path -LiteralPath $taskLink) {
      $taskLabel = if ($taskLink -eq $taskLinks[0]) { 'desktop' } else { 'start-menu' }
      Copy-Item -LiteralPath $taskLink -Destination (Join-Path $taskBackupDir "$taskLabel.lnk")
    }
  }

  # Let the current version close normally before the silent in-place upgrade.
  $taskProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $taskExecutable -and $_.CommandLine -notmatch '--type=' })
  foreach ($taskProcess in $taskProcesses) {
    $taskRunning = Get-Process -Id $taskProcess.ProcessId -ErrorAction SilentlyContinue
    if ($taskRunning) { [void]$taskRunning.CloseMainWindow() }
  }
  Start-Sleep -Milliseconds 1000

  # Only application JSON files are copied; the installed profile stays in place.
  $taskDataHashes = @{}
  foreach ($taskName in @('notes-data.json','alarm-history.json')) {
    $taskDataFile = Join-Path $taskDataDir $taskName
    if (Test-Path -LiteralPath $taskDataFile -PathType Leaf) {
      Copy-Item -LiteralPath $taskDataFile -Destination (Join-Path $taskBackupDir $taskName)
      $taskDataHashes[$taskName] = Get-NotesFileHash $taskDataFile
    }
  }

  # /D is deliberately the final NSIS argument, including paths containing spaces.
  $taskArguments = '/S --updated /currentuser /D=' + $taskInstallDir
  $taskUpdate = Start-Process -FilePath $taskInstaller -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait -PassThru
  if ($taskUpdate.ExitCode -ne 0) { throw "Guncelleyici basarisiz. Cikis kodu: $($taskUpdate.ExitCode). Yedek: $taskBackupDir" }

  $taskAfter = Get-NotesPackage $taskArchive
  if ($taskAfter.version -ne $taskManifest.version) { throw "Kurulu surum dogrulanamadi. Beklenen: $($taskManifest.version), bulunan: $($taskAfter.version)" }
  foreach ($taskName in $taskDataHashes.Keys) {
    $taskHash = Get-NotesFileHash (Join-Path $taskDataDir $taskName)
    if ($taskHash -ne $taskDataHashes[$taskName]) { throw "Guncelleme sirasinda veri dosyasi degisti: $taskName. Yedek: $taskBackupDir" }
  }

  $taskShell = New-Object -ComObject WScript.Shell
  foreach ($taskLink in $taskLinks) {
    if (Test-Path -LiteralPath $taskLink) {
      $taskShortcut = $taskShell.CreateShortcut($taskLink)
      $taskShortcut.TargetPath = $taskExecutable
      $taskShortcut.WorkingDirectory = $taskInstallDir
      $taskShortcut.Arguments = ''
      $taskShortcut.IconLocation = "$taskExecutable,0"
      $taskShortcut.Save()
    }
  }

  if (-not $NoLaunch) {
    # Notes is the user's interactive app; only the installer runs hidden.
    $taskLaunch = Start-Process -FilePath $taskExecutable -WorkingDirectory $taskInstallDir -WindowStyle Normal -PassThru
    Start-Sleep -Milliseconds 1500
    if ($taskLaunch.HasExited) { throw "Guncel uygulama beklenmedik sekilde kapandi. Yedek: $taskBackupDir" }
    $taskPreviousData = Join-Path $taskBackupDir 'notes-data.json'
    if (Test-Path -LiteralPath $taskPreviousData) {
      $taskVerification = & node (Join-Path $PSScriptRoot 'verify-update-data.cjs') $taskPreviousData (Join-Path $taskDataDir 'notes-data.json')
      if ($LASTEXITCODE -ne 0) { throw "Acilis sonrasi veri dogrulamasi basarisiz. Yedek: $taskBackupDir" }
    }
  }

  [pscustomobject]@{ ok=$true; previousVersion=$taskBefore.version; installedVersion=$taskAfter.version; dataPreserved=$true; installDirectory=$taskInstallDir; backupDirectory=$taskBackupDir; launched=(-not $NoLaunch) } | ConvertTo-Json
} catch {
  if (-not $NoLaunch -and $taskProcesses.Count -gt 0 -and (Test-Path -LiteralPath $taskExecutable)) {
    Start-Process -FilePath $taskExecutable -WorkingDirectory $taskInstallDir -WindowStyle Normal
  }
  throw
} finally {
  Pop-Location
}
