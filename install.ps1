param(
 [string]$ProfilePath = (Join-Path $HOME '.dsh/profiles/desktop'),
 [string]$EnginePath = (Join-Path $PSScriptRoot '.engine'),
 [switch]$Rollback,
 [int]$FailAfterStep = 0
)
$ErrorActionPreference='Stop'
$profileDir=[IO.Path]::GetFullPath($ProfilePath)
$repo=[IO.Path]::GetFullPath($EnginePath)
$plugin=[IO.Path]::GetFullPath($PSScriptRoot)
$manifestPath=Join-Path $profileDir 'package.json'
$journalPath=Join-Path $profileDir 'collaborative-install-transaction.json'
function UndoInstall($journal) {
 if([IO.Path]::GetFullPath($journal.profile) -ne $profileDir){throw 'Recovery profile mismatch'}
 foreach($entry in $journal.links){
  $target=[IO.Path]::GetFullPath($entry.path)
  if((Split-Path $target -Parent) -ne (Join-Path $profileDir 'node_modules') -or (Split-Path $target -Leaf) -notin @('billion-context','dsh-collaborative-compaction')){throw 'Invalid recovery target'}
  if($entry.keep){continue}
  if(Test-Path -LiteralPath $target){
   $item=Get-Item -LiteralPath $target
   if($item.LinkType -and [IO.Path]::GetFullPath(@($item.Target)[0]) -eq [IO.Path]::GetFullPath($entry.source)){Remove-Item -LiteralPath $target -Force}
   elseif(Test-Path -LiteralPath $entry.backup){throw 'Unexpected installed directory; recovery stopped'}
  }
  if(Test-Path -LiteralPath $entry.backup){Move-Item -LiteralPath $entry.backup -Destination $target}
 }
 foreach($entry in $journal.files){Copy-Item -LiteralPath $entry.backup -Destination $entry.path -Force}
 Remove-Item -LiteralPath $journalPath -Force
 Write-Output 'Installation rolled back; previous packages and configuration restored.'
}
if(Test-Path -LiteralPath $journalPath){
 if(!$Rollback){throw 'An interrupted installation needs recovery: run install.ps1 -Rollback with the same ProfilePath first'}
 UndoInstall (Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json -AsHashtable)
 return
}
if($Rollback){Write-Output 'No incomplete installation';return}
if(!(Test-Path -LiteralPath (Join-Path $plugin 'node_modules/js-tiktoken'))){throw 'Run npm ci --ignore-scripts in the plugin directory first'}
if(!(Test-Path -LiteralPath (Join-Path $repo 'dist/external-summary-settings.js'))){throw 'Rebuild the patched engine: the settings validator is missing'}
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
$journal=@{profile=$profileDir;files=@();links=@();state='pending'}
$i=0
foreach($file in @($manifestPath)+@($changes.Keys)){
 $saved=Join-Path $backup ("file-$i.backup");Copy-Item -LiteralPath $file -Destination $saved
 $journal.files+=@{path=$file;backup=$saved};$i++
}
foreach($name in $links.Keys){
 $destination=Join-Path $profileDir ('node_modules/'+$name)
 $keep=(Test-Path -LiteralPath $destination) -and [bool](Get-Item -LiteralPath $destination).LinkType
 $journal.links+=@{path=$destination;source=$links[$name];backup=(Join-Path $backup $name);keep=$keep}
}
[IO.File]::WriteAllText($journalPath,($journal | ConvertTo-Json -Depth 20))
$step=0
try {
 foreach($entry in $journal.links){
  if($entry.keep){continue}
  if(Test-Path -LiteralPath $entry.path){Move-Item -LiteralPath $entry.path -Destination $entry.backup}
  New-Item -ItemType Junction -Path $entry.path -Target $entry.source | Out-Null
  $step++;if($FailAfterStep -eq $step){throw 'Injected installation failure'}
 }
 [IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 50))
 $step++;if($FailAfterStep -eq $step){throw 'Injected configuration failure'}
 foreach($file in $changes.Keys){[IO.File]::WriteAllText($file,$changes[$file])}
 $journal.state='complete';[IO.File]::WriteAllText((Join-Path $backup 'transaction.json'),($journal | ConvertTo-Json -Depth 20))
 Remove-Item -LiteralPath $journalPath -Force
} catch {
 $failure=$_
 try{UndoInstall $journal}catch{Write-Warning 'Automatic rollback incomplete. Keep backups and rerun install.ps1 -Rollback.'}
 throw $failure
}
Write-Output "Installed. Backup: $backup. Restart DSH, then enable the plugin in settings."
