[CmdletBinding()]
param(
  [switch]$PrepareOnly,
  [switch]$SkipSdkInstall,
  [switch]$SkipPrebuild,
  [switch]$VerifyOnly,
  [switch]$AcceptAndroidLicenses,
  [ValidatePattern('^(arm64-v8a|armeabi-v7a|x86_64)(,(arm64-v8a|armeabi-v7a|x86_64))*$')]
  [string]$Architectures = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsPath = Join-Path $workspacePath '.tools'

function Assert-WorkspacePath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($workspacePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing filesystem operation outside the project: $resolved"
  }
  $cursor = $resolved
  while ($cursor.Length -ge $workspacePath.Length) {
    $existing = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
    if ($existing -and ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "Refusing a tools path containing a junction or symlink: $cursor"
    }
    if ($cursor -eq $workspacePath) { break }
    $cursor = Split-Path $cursor -Parent
  }
  return $resolved
}

Assert-WorkspacePath $toolsPath | Out-Null
New-Item -ItemType Directory -Force -Path $toolsPath | Out-Null

function Ensure-Zip([string]$Path, [string]$Url, [string]$ExpectedHash, [string]$Algorithm = 'SHA256') {
  $safePath = Assert-WorkspacePath $Path
  if ((Test-Path -LiteralPath $safePath) -and (Get-FileHash -LiteralPath $safePath -Algorithm $Algorithm).Hash -eq $ExpectedHash) { return }
  $downloadPath = Assert-WorkspacePath ($safePath + '.download')
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    Write-Host "Downloading $Url"
    & curl.exe --fail --location --continue-at - --retry 5 --retry-all-errors --connect-timeout 30 --max-time 1800 --speed-time 30 --speed-limit 1024 --output $downloadPath $Url
    if ($LASTEXITCODE -ne 0) {
      if ($attempt -eq 0 -and $LASTEXITCODE -in @(22, 33) -and (Test-Path -LiteralPath $downloadPath)) {
        Remove-Item -LiteralPath $downloadPath -Force
        continue
      }
      throw "Download failed: $Url"
    }
    if ((Get-FileHash -LiteralPath $downloadPath -Algorithm $Algorithm).Hash -ne $ExpectedHash) {
      Remove-Item -LiteralPath $downloadPath -Force
      if ($attempt -eq 0) { continue }
      throw "$Algorithm mismatch: $downloadPath"
    }
    Move-Item -LiteralPath $downloadPath -Destination $safePath -Force
    return
  }
}

function Invoke-NativeLogged([string]$Executable, [string[]]$Arguments, [string]$LogPath, [string]$StandardInput = '') {
  # Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords.
  # Ordinary warnings must not terminate a successful native command.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    if ($StandardInput) {
      $StandardInput | & $Executable @Arguments 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $LogPath -ErrorAction Stop
    } else {
      & $Executable @Arguments 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $LogPath -ErrorAction Stop
    }
    $nativeExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($nativeExitCode -ne 0) { throw "Native command failed ($nativeExitCode); see $LogPath" }
}

$jdkHash = 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0'
$cliHash = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
$gradleHash = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb'
$jdkBase = Join-Path $toolsPath 'jdk'
$jdkExpectedPath = Assert-WorkspacePath (Join-Path $jdkBase 'jdk-17.0.20.1+1')
$jdkRequired = @('bin/java.exe', 'bin/javac.exe', 'lib/modules', 'release')
$jdkReady = @($jdkRequired | Where-Object { -not (Test-Path (Join-Path $jdkExpectedPath $_)) }).Count -eq 0
if (-not $jdkReady) {
  $jdkZip = Join-Path $toolsPath 'jdk.zip'
  Ensure-Zip $jdkZip 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip' $jdkHash
  Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkBase -Force
  if (@($jdkRequired | Where-Object { -not (Test-Path (Join-Path $jdkExpectedPath $_)) }).Count -gt 0) { throw 'JDK extraction is incomplete' }
}
$jdkFolder = Get-Item -LiteralPath $jdkExpectedPath
if (-not ((Get-Content (Join-Path $jdkExpectedPath 'release')) -match '^JAVA_VERSION="17\.0\.20\.1"$')) { throw 'Unexpected JDK version in the local tools cache' }

$sdkRoot = Join-Path $toolsPath 'android-sdk'
$cliRoot = Join-Path $sdkRoot 'cmdline-tools'
if (-not (Test-Path (Join-Path $cliRoot 'latest/bin/sdkmanager.bat')) -or -not (Test-Path (Join-Path $cliRoot 'latest/lib/sdkmanager-classpath.jar'))) {
  $cliZip = Join-Path $toolsPath 'android-cli.zip'
  Ensure-Zip $cliZip 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' $cliHash
  New-Item -ItemType Directory -Force -Path $cliRoot | Out-Null
  Expand-Archive -LiteralPath $cliZip -DestinationPath $cliRoot -Force
  $cliSource = Assert-WorkspacePath (Join-Path $cliRoot 'cmdline-tools')
  $cliTarget = Assert-WorkspacePath (Join-Path $cliRoot 'latest')
  if (Test-Path -LiteralPath $cliTarget) { Remove-Item -LiteralPath $cliTarget -Recurse -Force }
  Move-Item -LiteralPath $cliSource -Destination $cliTarget
}

$gradleBase = Join-Path $toolsPath 'gradle'
$gradleBin = Join-Path $gradleBase 'gradle-9.4.1/bin/gradle.bat'
if (-not (Test-Path -LiteralPath $gradleBin) -or -not (Test-Path (Join-Path $gradleBase 'gradle-9.4.1/lib/gradle-launcher-9.4.1.jar'))) {
  $gradleZip = Join-Path $toolsPath 'gradle-9.4.1-bin.zip'
  $mirrorZip = Join-Path $toolsPath 'gradle-9.4.1-mirror.zip'
  if ((Test-Path -LiteralPath $mirrorZip) -and (Get-FileHash -LiteralPath $mirrorZip -Algorithm SHA256).Hash -eq $gradleHash) { $gradleZip = $mirrorZip }
  else { Ensure-Zip $gradleZip 'https://downloads.gradle.org/distributions/gradle-9.4.1-bin.zip' $gradleHash }
  Expand-Archive -LiteralPath $gradleZip -DestinationPath $gradleBase -Force
}

$environmentNames = @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_USER_HOME', 'GRADLE_USER_HOME', 'PATH', 'CI', 'NODE_ENV', 'QINGZHANG_PHYSICAL_ROOT', 'QINGZHANG_BUILD_ROOT', 'QINGZHANG_AUTOLINK_WRAPPER')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$drive = $null
$pushedLocation = $false
try {
  # Android's native toolchain behaves poorly with non-ASCII and very long Windows paths.
  # Use a temporary, unused drive letter without relocating the repository.
  foreach ($letter in @('Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z')) {
    if (-not (Test-Path ($letter + ':\'))) {
      & subst.exe ($letter + ':') $workspacePath
      if ($LASTEXITCODE -eq 0) { $drive = $letter + ':'; break }
    }
  }
  if (-not $drive) { throw 'No unused drive letter is available for the Android build' }
  $buildRoot = $drive + '\'
  Push-Location $buildRoot
  $pushedLocation = $true
  $env:JAVA_HOME = Join-Path $buildRoot ('.tools/jdk/' + $jdkFolder.Name)
  $env:ANDROID_HOME = Join-Path $buildRoot '.tools/android-sdk'
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:ANDROID_USER_HOME = Join-Path $buildRoot '.tools/android-user'
  $env:GRADLE_USER_HOME = Join-Path $buildRoot '.tools/gradle-cache'
  $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + (Join-Path $env:ANDROID_HOME 'platform-tools') + ';' + $env:PATH
  $env:CI = '1'
  $env:NODE_ENV = 'production'
  $env:QINGZHANG_PHYSICAL_ROOT = $workspacePath
  $env:QINGZHANG_BUILD_ROOT = $buildRoot
  $env:QINGZHANG_AUTOLINK_WRAPPER = Join-Path $buildRoot 'scripts/autolinking-build.cjs'

  if (-not $VerifyOnly) {
  # Expo 58's find-up loop omits the drive root itself. A subst workspace lives
  # at that root, so inspect it once before terminating the upward search.
  # The edit is limited to the installed runtime dependency and reapplied after npm ci.
  $loopPatches = @(
    @{ Path = 'commands/autolinkingOptions.js'; Initial = 'root' },
    @{ Path = 'exports.js'; Initial = 'cwd' }
  )
  foreach ($loopPatch in $loopPatches) {
    $autolinkingPath = Join-Path $buildRoot ('node_modules/expo-modules-autolinking/build/' + $loopPatch.Path)
    $autolinkingText = [IO.File]::ReadAllText($autolinkingPath)
    $oldLoop = 'for(let dir = ' + $loopPatch.Initial + '; _path().default.dirname(dir) !== dir; dir = _path().default.dirname(dir))'
    $newLoop = 'for(let dir = ' + $loopPatch.Initial + '; dir; dir = _path().default.dirname(dir) === dir ? "" : _path().default.dirname(dir))'
    if ($autolinkingText.Contains($oldLoop)) {
      [IO.File]::WriteAllText($autolinkingPath, $autolinkingText.Replace($oldLoop, $newLoop), [Text.UTF8Encoding]::new($false))
    } elseif (-not $autolinkingText.Contains($newLoop)) {
      Write-Host 'Expo autolinking has changed; using its installed drive-root behavior.'
    }
  }
  $builderPath = Join-Path $buildRoot 'node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin-shared/src/main/kotlin/expo/modules/plugin/AutolinkingCommandBuilder.kt'
  $builderText = [IO.File]::ReadAllText($builderPath)
  $originalEntry = "require('expo/bin/autolinking')"
  $wrappedEntry = "require(process.env.QINGZHANG_AUTOLINK_WRAPPER || 'expo/bin/autolinking')"
  if ($builderText.Contains($originalEntry)) {
    [IO.File]::WriteAllText($builderPath, $builderText.Replace($originalEntry, $wrappedEntry), [Text.UTF8Encoding]::new($false))
  } elseif (-not $builderText.Contains($wrappedEntry)) { throw 'The Expo autolinking builder changed; review the local path adapter.' }

  $sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools/latest/bin/sdkmanager.bat'
  if (-not $SkipSdkInstall) {
    if (-not $AcceptAndroidLicenses) { throw 'Pass -AcceptAndroidLicenses after reviewing the Android SDK license terms linked in docs/ANDROID_BUILD.md.' }
    $ndkTarget = Assert-WorkspacePath (Join-Path $sdkRoot 'ndk/27.1.12297006')
    if (-not (Test-Path (Join-Path $ndkTarget 'source.properties'))) {
      $ndkZip = Join-Path $toolsPath 'android-ndk-r27b-windows.zip'
      # The Android repository publishes SHA1 for this exact NDK archive.
      Ensure-Zip $ndkZip 'https://dl.google.com/android/repository/android-ndk-r27b-windows.zip' '3bb7efc850cd0af7707854b7e0d5c3b6a7153703' 'SHA1'
      $ndkStaging = Assert-WorkspacePath (Join-Path $toolsPath 'ndk-unpack')
      Expand-Archive -LiteralPath $ndkZip -DestinationPath $ndkStaging -Force
      $ndkSource = Assert-WorkspacePath (Join-Path $ndkStaging 'android-ndk-r27b')
      if (Test-Path -LiteralPath $ndkTarget) { Remove-Item -LiteralPath $ndkTarget -Recurse -Force }
      New-Item -ItemType Directory -Force -Path (Split-Path $ndkTarget -Parent) | Out-Null
      Move-Item -LiteralPath $ndkSource -Destination $ndkTarget
    }
    Invoke-NativeLogged -Executable $sdkManager -Arguments @("--sdk_root=$env:ANDROID_HOME", 'platform-tools', 'platforms;android-37.0', 'build-tools;37.0.0', 'build-tools;36.0.0', 'cmake;3.30.5', 'cmake;3.22.1') -LogPath (Join-Path $buildRoot '.tools/android-sdk-install.log') -StandardInput (('y' + [Environment]::NewLine) * 100)
  }
  if ($PrepareOnly) { Write-Host 'Android toolchain is ready.'; return }
  if (-not $SkipPrebuild) {
    & npx.cmd expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo Android prebuild failed' }
  }
  $sdkProperty = $env:ANDROID_HOME.Replace('\', '\\').Replace(':', '\:')
  [IO.File]::WriteAllText((Join-Path $buildRoot 'android/local.properties'), "sdk.dir=$sdkProperty`n", [Text.UTF8Encoding]::new($false))
  $appGradlePath = Join-Path $buildRoot 'android/app/build.gradle'
  $appGradleText = [IO.File]::ReadAllText($appGradlePath)
  $originalAppGradleText = $appGradleText
  $appGradleText = $appGradleText.Replace('-DCMAKE_OBJECT_PATH_MAX=128', '-DCMAKE_OBJECT_PATH_MAX=200')
  if (-not $appGradleText.Contains('// Qingzhang Windows object path limit')) {
    $appGradleText += @'

// Qingzhang Windows object path limit: hash long codegen object directories.
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=200"
            }
        }
    }
}
'@
  }
  if (-not $appGradleText.Contains('// Qingzhang Windows short native staging')) {
    $appGradleText += @'

// Qingzhang Windows short native staging.
android {
    externalNativeBuild {
        cmake {
            buildStagingDirectory file("../../.tools/cxx")
        }
    }
}
'@
  }
  if ($appGradleText -ne $originalAppGradleText) { [IO.File]::WriteAllText($appGradlePath, $appGradleText, [Text.UTF8Encoding]::new($false)) }
  $autolinkingCache = Assert-WorkspacePath (Join-Path $workspacePath 'android/build/generated/autolinking/autolinking.json')
  if (Test-Path -LiteralPath $autolinkingCache) { Remove-Item -LiteralPath $autolinkingCache -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $buildRoot 'artifacts') | Out-Null
  $mappedGradle = Join-Path $buildRoot '.tools/gradle/gradle-9.4.1/bin/gradle.bat'
  Invoke-NativeLogged -Executable $mappedGradle -Arguments @('--project-dir', 'android', ':app:assembleRelease', '--no-daemon', '--console=plain', '--max-workers=4', "-PreactNativeArchitectures=$Architectures", '-Pandroid.overridePathCheck=true', '-Pandroid.enableMinifyInReleaseBuilds=false', '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8') -LogPath (Join-Path $buildRoot 'artifacts/android-build.log')
  }
  $apk = Join-Path $buildRoot 'android/app/build/outputs/apk/release/app-release.apk'
  if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle completed without producing the expected APK' }
  $output = Join-Path $buildRoot 'artifacts/qingzhang-1.0.0-android-preview.apk'
  $candidate = Join-Path $buildRoot 'artifacts/qingzhang-1.0.0-android-preview.candidate.apk'
  Copy-Item -LiteralPath $apk -Destination $candidate -Force
  & (Join-Path $env:ANDROID_HOME 'build-tools/37.0.0/apksigner.bat') verify --verbose $candidate
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($candidate)
  try {
    $bundle = $archive.GetEntry('assets/index.android.bundle')
    if (-not $bundle -or $bundle.Length -lt 1000) { throw 'APK is missing its standalone JavaScript bundle' }
    foreach ($entryName in @('AndroidManifest.xml', 'classes.dex')) {
      if (-not $archive.GetEntry($entryName)) { throw "APK is missing $entryName" }
    }
    $bundleBytes = $bundle.Length
    $bundleStream = $bundle.Open()
    try {
      $magic = New-Object byte[] 8
      if ($bundleStream.Read($magic, 0, 8) -ne 8 -or [BitConverter]::ToString($magic) -ne 'C6-1F-BC-03-C1-03-19-1F') { throw 'APK JavaScript bundle is not Hermes bytecode' }
    } finally { $bundleStream.Dispose() }
    $nativeEntries = @($archive.Entries | Where-Object { $_.FullName -like 'lib/*/*.so' }).Count
    if ($nativeEntries -eq 0) { throw 'APK is missing its native libraries' }
    $fontEntries = @($archive.Entries | Where-Object { $_.FullName -match '\.ttf$' }).Count
    if ($fontEntries -eq 0) { throw 'APK is missing its icon font' }
  } finally { $archive.Dispose() }
  $aapt = Join-Path $env:ANDROID_HOME 'build-tools/37.0.0/aapt.exe'
  $badging = & $aapt dump badging $candidate
  if ($LASTEXITCODE -ne 0 -or -not ($badging -match "package: name='com\.qingzhang\.app'")) { throw 'APK package identity verification failed' }
  if ($badging -match '^application-debuggable') { throw 'Unexpected debuggable flag in the release APK' }
  foreach ($forbiddenPermission in @('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW')) {
    if ($badging -match ('uses-permission[^\n]*android\.permission\.' + $forbiddenPermission + "'")) {
      throw "Unexpected permission in the APK: $forbiddenPermission"
    }
  }
  $manifestTree = & $aapt dump xmltree $candidate 'AndroidManifest.xml'
  if ($LASTEXITCODE -ne 0 -or -not ($manifestTree -match 'android:allowBackup.*=\(type 0x12\)0x0\s*$')) { throw 'APK backup exclusion verification failed' }
  # AAPT optimizes resource filenames; resolve XML paths through its resource table.
  $resourceTable = & (Join-Path $env:ANDROID_HOME 'build-tools/37.0.0/aapt2.exe') dump resources $candidate
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read APK resource table' }
  $resourceText = $resourceTable -join "`n"
  $backupDefinitions = @(
    @{ Name = 'qingzhang_backup_rules'; Attribute = 'fullBackupContent'; Sections = @('full-backup-content') },
    @{ Name = 'qingzhang_extraction_rules'; Attribute = 'dataExtractionRules'; Sections = @('cloud-backup', 'device-transfer') }
  )
  foreach ($definition in $backupDefinitions) {
    $resourceMatch = [regex]::Match($resourceText, '(?m)^\s*resource (0x[0-9a-f]+) xml/' + $definition.Name + '\s*\n\s*\(\) \(file\) (res/\S+\.xml) type=XML\s*$')
    if (-not $resourceMatch.Success) { throw "APK backup resource is missing: $($definition.Name)" }
    $resourceId = $resourceMatch.Groups[1].Value
    $resourceFile = $resourceMatch.Groups[2].Value
    if (-not ($manifestTree -match ('android:' + $definition.Attribute + '\([^)]*\)=@' + $resourceId + '\s*$'))) { throw "APK manifest does not reference $($definition.Name)" }
    $ruleTree = & $aapt dump xmltree $candidate $resourceFile
    if ($LASTEXITCODE -ne 0) { throw "Cannot read APK backup XML: $resourceFile" }
    $ruleText = $ruleTree -join "`n"
    foreach ($section in $definition.Sections) {
      $sectionMatch = [regex]::Match($ruleText, '(?ms)^(?<indent> *)E: ' + $section + ' \(line=\d+\)\n(?<body>.*?)(?=^\k<indent>E: |\z)')
      if (-not $sectionMatch.Success) { throw "APK backup section is missing: $section" }
      $body = $sectionMatch.Groups['body'].Value
      if ($body -match 'E: include ') { throw "Unexpected inclusion in APK backup section: $section" }
      foreach ($domain in @('root', 'file', 'database', 'sharedpref', 'external')) {
        $excludePattern = 'E: exclude \(line=\d+\)\s+A: domain="' + $domain + '"[^\n]*\n\s+A: path="\."'
        if (-not [regex]::IsMatch($body, $excludePattern)) { throw "APK backup exclusion missing: $section/$domain" }
      }
    }
  }
  $verification = @("Standalone Hermes bundle: $bundleBytes bytes; bytecode magic verified", "Native libraries: $nativeEntries", "Embedded icon fonts: $fontEntries", 'Signature: verified', 'android:allowBackup=false: verified', 'Backup XML: legacy/cloud/device-transfer exclude root,file,database,sharedpref,external', 'Release debuggable flag: absent', 'Unneeded storage and overlay permissions: absent') + @($badging | Where-Object { $_ -match '^(package:|sdkVersion:|targetSdkVersion:|application-label:|native-code:)' })
  $hash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  ($verification + "SHA256: $hash") | Set-Content -LiteralPath ($candidate + '.verification.txt') -Encoding utf8
  $hash | Set-Content -LiteralPath ($candidate + '.sha256') -Encoding ascii
  # A failed signature/content check leaves the previously verified APK intact.
  Move-Item -LiteralPath $candidate -Destination $output -Force
  Move-Item -LiteralPath ($candidate + '.sha256') -Destination ($output + '.sha256') -Force
  Move-Item -LiteralPath ($candidate + '.verification.txt') -Destination (Join-Path $buildRoot 'artifacts/apk-verification.txt') -Force
  Write-Host "APK ready: $workspacePath\artifacts\qingzhang-1.0.0-android-preview.apk"
  Write-Host 'Preview only: release bundle, local debug signature, not an app-store signing key.'
}
finally {
  if ($pushedLocation) { Pop-Location }
  if ($drive) { & subst.exe $drive /D }
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
}
