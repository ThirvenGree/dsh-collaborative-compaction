param(
 [string]$ProfilePath = (Join-Path $HOME '.dsh/profiles/desktop'),
 [string]$EnginePath = (Join-Path $PSScriptRoot '.engine')
)
$ErrorActionPreference='Stop'
$profileDir=[IO.Path]::GetFullPath($ProfilePath)
$repo=[IO.Path]::GetFullPath($EnginePath)
$plugin=[IO.Path]::GetFullPath($PSScriptRoot)
$manifestPath=Join-Path $profileDir 'package.json'
if(!(Test-Path -LiteralPath $manifestPath)){throw 'DSH profile not found'}
if(!(Test-Path -LiteralPath (Join-Path $repo 'dist/index.js'))){throw 'Run prepare-engine.ps1 first'}
$source=Join-Path $repo 'src/collaborative-transaction.ts'
if(!(Test-Path -LiteralPath $source)){throw 'Engine collaborative adapter is missing'}
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
if(!$manifest.dependencies -or !$manifest.dsh.profile){throw 'Unsupported DSH profile manifest'}
$backup=Join-Path (Split-Path $profileDir -Parent) ('compaction-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
# Prepare all text changes before touching the installed files.
$engineLink='link:'+($repo -replace '\\','/')
$pluginLink='link:'+($plugin -replace '\\','/')
$manifest.dependencies['billion-context']=$engineLink
$manifest.dependencies['dsh-collaborative-compaction']=$pluginLink
if($manifest.dsh.profile.bundles -notcontains 'dsh-collaborative-compaction'){$manifest.dsh.profile.bundles+=@('dsh-collaborative-compaction')}
$changes=@{}
foreach($lock in @((Join-Path $profileDir 'pnpm-lock.yaml'),(Join-Path $profileDir 'node_modules/.pnpm/lock.yaml'))){
 if(Test-Path -LiteralPath $lock){
  $value=[IO.File]::ReadAllText($lock)
  $pattern='(?m)^      billion-context:\r?\n        specifier: [^\r\n]+\r?\n        version: [^\r\n]+'
  if(![regex]::IsMatch($value,$pattern)){throw 'Lockfile format changed; nothing installed'}
  $value=[regex]::Replace($value,'(?m)^      dsh-collaborative-compaction:\r?\n        specifier: [^\r\n]+\r?\n        version: [^\r\n]+\r?\n','')
  $replacement="      billion-context:`n        specifier: $engineLink`n        version: $engineLink`n      dsh-collaborative-compaction:`n        specifier: $pluginLink`n        version: $pluginLink"
  $changes[$lock]=[regex]::Replace($value,$pattern,[System.Text.RegularExpressions.MatchEvaluator]{param($match) $replacement})
 }
}
$links=@{'billion-context'=$repo;'dsh-collaborative-compaction'=$plugin}
foreach($name in $links.Keys){
 $destination=Join-Path $profileDir ('node_modules/'+$name)
 if(Test-Path -LiteralPath $destination){
  $item=Get-Item -LiteralPath $destination
  if($item.LinkType -and [IO.Path]::GetFullPath(@($item.Target)[0]) -ne $links[$name]){throw "Existing $name link points elsewhere; nothing installed"}
 }
}
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $manifestPath -Destination $backup
$i=0
foreach($file in $changes.Keys){Copy-Item -LiteralPath $file -Destination (Join-Path $backup ("lock-$i.yaml"));$i++}
foreach($name in $links.Keys){
 $destination=Join-Path $profileDir ('node_modules/'+$name)
 if(Test-Path -LiteralPath $destination){
  $item=Get-Item -LiteralPath $destination
  if($item.LinkType){continue}
  # Absolute destination is derived only from the explicit profile and fixed package names.
  Move-Item -LiteralPath $destination -Destination (Join-Path $backup $name)
 }
 New-Item -ItemType Junction -Path $destination -Target $links[$name] | Out-Null
}
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 50))
foreach($file in $changes.Keys){[IO.File]::WriteAllText($file,$changes[$file])}
Write-Output "Installed. Backup: $backup. Restart DSH, then enable the plugin in settings."
