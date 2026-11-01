[CmdletBinding()]
param([string]$Ref = 'HEAD')

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$commit = & git -C $workspace rev-parse --verify --end-of-options ($Ref + '^{commit}')
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40,64}$') {
  throw 'Choose a committed Git revision to package.'
}
$packageText = & git -C $workspace show ($commit + ':package.json')
if ($LASTEXITCODE -ne 0) { throw 'The selected commit has no package.json.' }
$version = ($packageText -join "`n" | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }

$artifactDirectory = Join-Path $workspace 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$destination = Join-Path $artifactDirectory ("qingzhang-$version-source.zip")
$candidate = $destination + '.candidate'

# Archive only the reviewed Git tree, never local logs, signing keys, or untracked backups.
& git -C $workspace archive --format=zip ("--prefix=qingzhang-$version/") ("--output=$candidate") $commit
if ($LASTEXITCODE -ne 0) { throw 'Git source archive failed; the previous archive was left intact.' }
Move-Item -LiteralPath $candidate -Destination $destination -Force
Get-Item -LiteralPath $destination | Select-Object FullName, Length
Write-Output "Source commit: $commit"
