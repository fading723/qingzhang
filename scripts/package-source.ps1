$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactDirectory = Join-Path $workspace 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$destination = Join-Path $artifactDirectory 'qingzhang-1.0.0-source.zip'
$sourcePaths = @(
  'App.tsx', 'index.ts', 'app.config.ts', 'metro.config.js', 'eas.json',
  'package.json', 'package-lock.json', 'tsconfig.json', 'README.md',
  '.gitignore', '.prettierrc.json', '.prettierignore',
  'src', 'assets', 'plugins', 'scripts', 'tests', 'docs', 'examples'
)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
$archive = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($source in $sourcePaths) {
    $absolute = Join-Path $workspace $source
    if (-not (Test-Path -LiteralPath $absolute)) { continue }
    $item = Get-Item -LiteralPath $absolute
    $files = if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $absolute -Recurse -File -Force } else { @($item) }
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($workspace.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
} finally { $archive.Dispose() }
Get-Item -LiteralPath $destination | Select-Object FullName, Length
