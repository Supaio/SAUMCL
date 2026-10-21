param(
  [Parameter(Mandatory)][string]$LauncherPath,
  [string]$MinecraftVersion = '26.3'
)

$ErrorActionPreference = 'Stop'
# This test hides Java executables only on a disposable GitHub-hosted runner.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Installation smoke tests require a disposable GitHub-hosted Windows runner'
}

$workspaceRoot = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$sourceLauncher = (Resolve-Path -LiteralPath $LauncherPath).Path
if (-not $sourceLauncher.StartsWith($workspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Launcher must be inside the checkout' }
$testRoot = Join-Path $env:RUNNER_TEMP ('saumcl-install-' + [Guid]::NewGuid().ToString('N'))
$appDirectory = Join-Path $testRoot 'app'
$gameDirectory = Join-Path $testRoot 'game'
$cacheDirectory = Join-Path $testRoot 'cache'
$runtimeDirectory = Join-Path $env:APPDATA 'io.github.supaio.saumcl\runtime\java-25'
$reportPath = Join-Path $workspaceRoot 'artifacts\installation-smoke.json'
if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'io.github.supaio.saumcl')) { throw 'Runner already has SAUMCL application data' }
New-Item -ItemType Directory -Path $appDirectory,$gameDirectory,$cacheDirectory -Force | Out-Null
$launcherExe = Join-Path $appDirectory 'SAUMCL-install-test.exe'
Copy-Item -LiteralPath $sourceLauncher -Destination $launcherExe

$configuration = @{
  runCount = 2
  lastRunExitedNormally = $true
  general = @{ general = @{ language = 'en' }; functionality = @{ autoDownloadJava = $true; discoverPage = 'off' } }
  download = @{ source = @{ strategy = 'official' }; transmission = @{ autoConcurrent = $false; concurrentCount = 32 }; cache = @{ directory = $cacheDirectory } }
  intelligence = @{ mcpServer = @{ launcher = @{ enabled = $true; port = 18970 } } }
  localGameDirectories = @(@{ name = 'INSTALL_SMOKE'; dir = $gameDirectory })
}
$configuration | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $appDirectory 'sjmcl.conf.json') -Encoding utf8NoBOM

function Find-JavaExecutables {
  $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($javaPath in @(& where.exe java 2>$null)) { if ($javaPath) { $null = $paths.Add($javaPath) } }
  $homes = [Collections.Generic.List[string]]::new()
  $vendors = @('Java','BellSoft','AdoptOpenJDK','SapMachine','Amazon Corretto','Zulu','Microsoft','Eclipse Foundation','Eclipse Adoptium','Semeru')
  $roots = @((Join-Path $env:USERPROFILE '.jdks'))
  foreach ($drive in Get-PSDrive -PSProvider FileSystem) {
    foreach ($vendor in $vendors) {
      $roots += Join-Path $drive.Root ('Program Files\' + $vendor)
      $roots += Join-Path $drive.Root ('Program Files (x86)\' + $vendor)
    }
    $roots += Join-Path $drive.Root 'Java'
  }
  foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root) { foreach ($homeEntry in Get-ChildItem -LiteralPath $root -Directory) { $homes.Add($homeEntry.FullName) } }
  }
  foreach ($registryPath in @('SOFTWARE\JavaSoft\JDK','SOFTWARE\JavaSoft\JRE','SOFTWARE\JavaSoft\Java Development Kit','SOFTWARE\JavaSoft\Java Runtime Environment')) {
    $base = 'HKLM:\' + $registryPath
    if (Test-Path -LiteralPath $base) {
      foreach ($key in Get-ChildItem -LiteralPath $base | Where-Object { $_.PSChildName -match '^\d' }) {
        $javaHome = (Get-ItemProperty -LiteralPath $key.PSPath -Name JavaHome -ErrorAction SilentlyContinue).JavaHome
        if ($javaHome) { $homes.Add($javaHome) }
      }
    }
  }
  foreach ($javaHome in $homes) {
    $javaPath = Join-Path $javaHome 'bin\java.exe'
    if (Test-Path -LiteralPath $javaPath -PathType Leaf) { $null = $paths.Add($javaPath) }
  }
  $resolved = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($javaPath in $paths) {
    $item = Get-Item -LiteralPath $javaPath
    $target = $item.ResolveLinkTarget($true)
    if ($null -ne $target) { $item = $target }
    if (Test-Path -LiteralPath $item.FullName -PathType Leaf) { $null = $resolved.Add($item.FullName) }
  }
  return @($resolved)
}

$allowedRoots = @($env:RUNNER_TOOL_CACHE,$env:AGENT_TOOLSDIRECTORY,$env:ProgramFiles,${env:ProgramFiles(x86)},(Join-Path $env:USERPROFILE '.jdks')) | Where-Object { $_ }
foreach ($drive in Get-PSDrive -PSProvider FileSystem) { $allowedRoots += Join-Path $drive.Root 'Java' }
$hiddenJava = [Collections.Generic.List[object]]::new()
$launcherProcess = $null
$originalPath = $env:PATH
try {
  foreach ($javaPath in Find-JavaExecutables) {
    $javaPath = [IO.Path]::GetFullPath($javaPath)
    $allowed = $false
    foreach ($root in $allowedRoots) { if ($javaPath.StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { $allowed = $true } }
    if (-not $allowed -or [IO.Path]::GetFileName($javaPath) -ne 'java.exe') { throw 'Java candidate is outside known runner Java locations' }
    $backupName = 'java.exe.saumcl-install-test'
    Rename-Item -LiteralPath $javaPath -NewName $backupName
    $hiddenJava.Add(@{ Original=$javaPath; Backup=(Join-Path ([IO.Path]::GetDirectoryName($javaPath)) $backupName) })
  }
  $env:PATH = (($env:PATH -split ';') | Where-Object { $_ -notmatch '(?i)java|jdk|jre|temurin|zulu|corretto' }) -join ';'
  Write-Output ('Temporarily hid {0} Java executable(s) on the disposable runner' -f $hiddenJava.Count)
  if (@(Get-ChildItem -LiteralPath $gameDirectory -Force).Count -ne 0 -or @(Get-ChildItem -LiteralPath $cacheDirectory -Force).Count -ne 0) { throw 'Game directory and download cache must start empty' }
  $launcherProcess = Start-Process -FilePath $launcherExe -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru
  & node (Join-Path $PSScriptRoot 'installation-smoke.mjs') $gameDirectory $runtimeDirectory $MinecraftVersion $reportPath
  if ($LASTEXITCODE -ne 0) { throw 'Clean installation smoke test failed; see the sanitized report' }
} finally {
  if ($null -ne $launcherProcess -and -not $launcherProcess.HasExited) {
    $null = $launcherProcess.CloseMainWindow()
    if (-not $launcherProcess.WaitForExit(5000)) { Stop-Process -Id $launcherProcess.Id -Force }
  }
  $env:PATH = $originalPath
  foreach ($entry in $hiddenJava) {
    if (Test-Path -LiteralPath $entry.Backup) { Rename-Item -LiteralPath $entry.Backup -NewName ([IO.Path]::GetFileName($entry.Original)) }
  }
}
