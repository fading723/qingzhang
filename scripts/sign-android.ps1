[CmdletBinding()]
param(
  [switch]$InitializeKey,
  [string]$InputApk = 'artifacts/qingzhang-1.0.0-android-preview.apk',
  [string]$OutputApk = 'artifacts/qingzhang-1.0.0-android-arm64.apk'
)

$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Resolve-ProjectPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath((Join-Path $workspacePath $Path))
  if (-not $resolved.StartsWith($workspacePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Signing paths must remain within the project directory.'
  }
  $cursor = $resolved
  while ($cursor.Length -ge $workspacePath.Length) {
    $item = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Signing paths must not contain a junction or symbolic link.'
    }
    if ($cursor -eq $workspacePath) { break }
    $cursor = Split-Path $cursor -Parent
  }
  return $resolved
}

$inputPath = Resolve-ProjectPath $InputApk
$outputPath = Resolve-ProjectPath $OutputApk
$artifactsDirectory = Resolve-ProjectPath 'artifacts'
if (-not $outputPath.StartsWith($artifactsDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($outputPath) -ne '.apk') {
  throw 'Release output must be an .apk file inside artifacts/.'
}
if ($inputPath -eq $outputPath) { throw 'Use a separate output path; never overwrite the build input.' }
if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) { throw 'Build the Android APK before signing it.' }
$signingDirectory = Resolve-ProjectPath '.tools/signing'
$keyPath = Resolve-ProjectPath '.tools/signing/qingzhang-release.keystore'
$configPath = Resolve-ProjectPath '.tools/signing/credentials.json'
$certificatePath = Resolve-ProjectPath '.tools/signing/qingzhang-release.cer'
$candidateKey = Resolve-ProjectPath '.tools/signing/qingzhang-release.candidate.keystore'
$candidateConfig = Resolve-ProjectPath '.tools/signing/credentials.candidate.json'
$candidateApk = Resolve-ProjectPath ($OutputApk + '.candidate.apk')
if ($candidateApk -eq $inputPath) { throw 'The signing candidate must not be the input APK.' }
$candidateHash = Resolve-ProjectPath ($OutputApk + '.candidate.apk.sha256')
$candidateVerification = Resolve-ProjectPath ($OutputApk + '.candidate.apk.verification.txt')
$outputHash = Resolve-ProjectPath ($OutputApk + '.sha256')
$outputVerification = Resolve-ProjectPath ($OutputApk + '.verification.txt')
$jdkPath = Resolve-ProjectPath '.tools/jdk/jdk-17.0.20.1+1'
$keytool = Join-Path $jdkPath 'bin/keytool.exe'
$buildTools = Resolve-ProjectPath '.tools/android-sdk/build-tools/37.0.0'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$aapt = Join-Path $buildTools 'aapt.exe'
$zipalign = Join-Path $buildTools 'zipalign.exe'
foreach ($tool in @($keytool, $apksigner, $aapt, $zipalign)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Run build-android.ps1 to prepare the project toolchain.' }
}

$previousJavaHome = $env:JAVA_HOME
$previousPassword = $env:QINGZHANG_SIGNING_PASSWORD
$signingConfig = $null
function Invoke-KeyTool([string[]]$ToolArguments) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $toolOutput = & $keytool @ToolArguments 2>&1
    $toolExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($toolExitCode -ne 0) { throw "Signing key operation failed (exit $toolExitCode)." }
}
function Protect-SigningDirectory {
  # The folder contains both a private key and its password; keep its ACL private too.
  # Restrict only the DACL. Avoid requesting SACL privileges that normal Windows users lack.
  $signingAcl = [IO.Directory]::GetAccessControl($signingDirectory, [Security.AccessControl.AccessControlSections]::Access)
  $signingAcl.SetAccessRuleProtection($true, $false)
  $currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($existingRule in $signingAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
    $signingAcl.RemoveAccessRuleSpecific($existingRule)
  }
  $allowedSids = @($currentUserSid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  foreach ($sid in $allowedSids) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $signingAcl.AddAccessRule($rule)
  }
  [IO.Directory]::SetAccessControl($signingDirectory, $signingAcl)
  # Restored files can carry explicit broad ACL entries that do not inherit the folder's changes.
  foreach ($secretPath in @($keyPath, $configPath)) {
    if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) { continue }
    $fileAcl = [IO.File]::GetAccessControl($secretPath, [Security.AccessControl.AccessControlSections]::Access)
    $fileAcl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in $fileAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
      $fileAcl.RemoveAccessRuleSpecific($existingRule)
    }
    foreach ($sid in $allowedSids) {
      $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    }
    [IO.File]::SetAccessControl($secretPath, $fileAcl)
  }
}
try {
  $env:JAVA_HOME = $jdkPath
  if ($InitializeKey) {
    if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $configPath)) {
      throw 'Signing identity already exists. Omit -InitializeKey to reuse it.'
    }
    if ((Test-Path -LiteralPath $candidateKey) -or (Test-Path -LiteralPath $candidateConfig)) {
      throw 'An incomplete initialization exists in .tools/signing; inspect it before retrying.'
    }
    New-Item -ItemType Directory -Force -Path $signingDirectory | Out-Null
    Protect-SigningDirectory
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $env:QINGZHANG_SIGNING_PASSWORD = [Convert]::ToBase64String($random)
    [Array]::Clear($random, 0, $random.Length)
    Invoke-KeyTool @('-genkeypair', '-keystore', $candidateKey, '-storetype', 'PKCS12', '-storepass:env', 'QINGZHANG_SIGNING_PASSWORD', '-keypass:env', 'QINGZHANG_SIGNING_PASSWORD', '-alias', 'qingzhang-release', '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10000', '-dname', 'CN=Qingzhang, OU=Android, O=Qingzhang', '-noprompt')
    Invoke-KeyTool @('-exportcert', '-keystore', $candidateKey, '-storepass:env', 'QINGZHANG_SIGNING_PASSWORD', '-alias', 'qingzhang-release', '-file', $certificatePath)
    $signingConfig = [ordered]@{
      formatVersion = 1
      keyAlias = 'qingzhang-release'
      storePassword = $env:QINGZHANG_SIGNING_PASSWORD
      certificateSha256 = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [IO.File]::WriteAllText($candidateConfig, ($signingConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $candidateKey -Destination $keyPath
    Move-Item -LiteralPath $candidateConfig -Destination $configPath
    Protect-SigningDirectory
    Write-Host 'Created project signing identity in .tools/signing. Back up this directory privately.'
  } else {
    if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $configPath)) {
      throw 'Signing identity is missing. Restore the original .tools/signing backup; use -InitializeKey only for a new application identity.'
    }
    Protect-SigningDirectory
    try { $signingConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
    catch { throw 'Cannot read the signing credentials configuration; restore the private backup.' }
  }
  if ($signingConfig.formatVersion -ne 1 -or $signingConfig.keyAlias -ne 'qingzhang-release' -or
      $signingConfig.storePassword.Length -lt 24 -or $signingConfig.certificateSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid signing credentials configuration.'
  }
  $env:QINGZHANG_SIGNING_PASSWORD = $signingConfig.storePassword
  New-Item -ItemType Directory -Force -Path (Split-Path $outputPath -Parent) | Out-Null
  # apksigner replaces existing signatures by default; passwords are never CLI values.
  & $apksigner sign --ks $keyPath --ks-key-alias $signingConfig.keyAlias --ks-pass env:QINGZHANG_SIGNING_PASSWORD --key-pass env:QINGZHANG_SIGNING_PASSWORD --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false --debuggable-apk-permitted false --out $candidateApk $inputPath
  if ($LASTEXITCODE -ne 0) { throw 'APK release signing failed.' }
  $signature = & $apksigner verify --verbose --print-certs $candidateApk
  if ($LASTEXITCODE -ne 0) { throw 'Signed APK verification failed.' }
  $signatureText = $signature -join "`n"
  if ($signatureText -notmatch 'Number of signers: 1(?:\r?\n|$)' -or
      $signatureText -notmatch 'Verified using v2 scheme[^\r\n]*: true' -or
      $signatureText -notmatch 'Verified using v3 scheme[^\r\n]*: true') {
    throw 'Expected one signer and valid v2/v3 signatures.'
  }
  # SDK 37 labels v3 certificates "V3.0 Signer:"; older tools use "Signer #1".
  $digests = @([regex]::Matches($signatureText, 'certificate SHA-256 digest: ([a-fA-F0-9]{64})') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Select-Object -Unique)
  if ($digests.Count -ne 1 -or $digests[0] -ne $signingConfig.certificateSha256 -or $signatureText -match 'Android Debug') {
    throw 'APK signer does not match the saved project signing identity.'
  }
  $digest = $digests[0]
  # aapt's Windows argument parser cannot reliably open a non-ASCII absolute path.
  # Keep its input relative to the workspace; Java signing tools accept the absolute paths.
  Push-Location $workspacePath
  try {
    $nativeCandidate = $candidateApk.Substring($workspacePath.Length + 1)
    & $zipalign -c -P 16 4 $nativeCandidate
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    $badging = & $aapt dump badging $nativeCandidate
    if ($LASTEXITCODE -ne 0 -or -not ($badging -match "package: name='com\.qingzhang\.app'")) { throw 'Wrong APK package.' }
  } finally { Pop-Location }
  if ($badging -match '^application-debuggable') { throw 'Release APK must not be debuggable.' }
  if (-not ($badging -match "^native-code: 'arm64-v8a'$")) { throw 'This release asset expects only ARM64 libraries.' }
  foreach ($permission in @('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW')) {
    if ($badging -match ('uses-permission[^\n]*android\.permission\.' + $permission + "'")) { throw "Unexpected APK permission: $permission" }
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($candidateApk)
  try {
    $bundle = $archive.GetEntry('assets/index.android.bundle')
    if (-not $bundle) { throw 'The signed APK has no standalone bundle.' }
    $stream = $bundle.Open()
    try {
      $magic = New-Object byte[] 8
      if ($stream.Read($magic, 0, 8) -ne 8 -or [BitConverter]::ToString($magic) -ne 'C6-1F-BC-03-C1-03-19-1F') { throw 'Expected Hermes bytecode.' }
    } finally { $stream.Dispose() }
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -match '\.(?:keystore|jks|p12|p8|pem|key|sqlite|sqlite3|db|log)$|(?:^|/)(?:credentials\.json|\.env|qingzhang-backup[^/]*\.json)$') {
        throw 'Private or runtime data was found in the APK.'
      }
    }
  } finally { $archive.Dispose() }
  $hash = (Get-FileHash -LiteralPath $candidateApk -Algorithm SHA256).Hash.ToLowerInvariant()
  $assetName = [IO.Path]::GetFileName($outputPath)
  $hash + '  ' + $assetName | Set-Content -LiteralPath $candidateHash -Encoding ascii
  @('Release signing: dedicated project certificate', "Certificate SHA256: $digest", 'Number of signers: 1', 'APK v2 / v3 signatures: verified', '16 KB native page alignment: verified', 'Hermes bytecode: verified', 'Private signing files and runtime databases: absent', 'Unneeded storage and overlay permissions: absent', 'Release debuggable flag: absent', "SHA256: $hash") + @($badging | Where-Object { $_ -match '^(package:|sdkVersion:|targetSdkVersion:|native-code:)' }) | Set-Content -LiteralPath $candidateVerification -Encoding utf8
  Move-Item -LiteralPath $candidateApk -Destination $outputPath -Force
  Move-Item -LiteralPath $candidateHash -Destination $outputHash -Force
  Move-Item -LiteralPath $candidateVerification -Destination $outputVerification -Force
  Write-Host "Release APK: $OutputApk"
  Write-Host "SHA256: $hash"
  Write-Host "Signing certificate SHA256: $digest"
} finally {
  $env:JAVA_HOME = $previousJavaHome
  $env:QINGZHANG_SIGNING_PASSWORD = $previousPassword
  $signingConfig = $null
}
