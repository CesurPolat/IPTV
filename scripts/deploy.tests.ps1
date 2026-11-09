$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'deploy.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object {
    Invoke-Expression $_.Extent.Text
}

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    if ($Program -eq 'dotnet') {
        $destination = $Arguments[-1]
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Copy-Item -Path (Join-Path $fixture '*') -Destination $destination -Recurse
    }
}
function Invoke-Ftp([string]$RemotePath, [string[]]$ExtraArguments) {
    $script:operations.Add(@{ Path = $RemotePath; Args = $ExtraArguments })
    if ($script:failUpload -and $RemotePath.EndsWith('api.dll')) { throw 'Simulated upload failure' }
    if ($ExtraArguments.Count -eq 1 -and $ExtraArguments[0] -eq '--list-only') { return $script:remoteNames }
    if ($script:failRename -and $ExtraArguments -contains 'RNFR 0_8_1.zip.uploading') { throw 'Simulated rename failure' }
}

$testRoot = Join-Path $root ('dist/deploy-test-' + [Guid]::NewGuid().ToString('N'))
$output = Join-Path $testRoot 'output'
$fixture = Join-Path $testRoot 'fixture'
New-Item -ItemType Directory -Path $output, $fixture -Force | Out-Null
$settings = @{
    host = 'ftp.test'; port = 21; protocol = 'ftp'; username = 'test'
    api = @{ remoteDir = '/api'; iis = $true; offlineWaitSeconds = 0; exclude = @('appsettings.json') }
    client = @{ remoteDir = '/versions' }
}
$Force = $false
$DryRun = $false
$script:operations = [Collections.Generic.List[object]]::new()
$script:failUpload = $false
$script:remoteNames = @()
$script:failRename = $false
'v1' | Set-Content (Join-Path $fixture 'api.dll')
'dependency' | Set-Content (Join-Path $fixture 'dependency.dll')
'secret' | Set-Content (Join-Path $fixture 'appsettings.json')

Deploy-Api
Assert ($operations.Count -eq 4) 'First deploy must send offline marker, two files, then remove marker.'
Assert (($operations | Where-Object { $_.Path -like '*appsettings.json' }).Count -eq 0) 'Excluded settings were uploaded.'
$operations.Clear()
Deploy-Api
Assert ($operations.Count -eq 0) 'Unchanged deploy must not connect or take IIS offline.'
'v2' | Set-Content (Join-Path $fixture 'api.dll')
Deploy-Api
Assert ($operations.Count -eq 3) 'One changed file must cause exactly one file upload plus offline handling.'
$operations.Clear()
$state = @(Get-ChildItem $output -Filter 'api-*.json')[0]
$previousState = Get-Content $state.FullName -Raw
'v3' | Set-Content (Join-Path $fixture 'api.dll')
$script:failUpload = $true
$failed = $false
try { Deploy-Api } catch { $failed = $true }
Assert $failed 'Upload failure was swallowed.'
Assert ((Get-Content $state.FullName -Raw) -eq $previousState) 'Failed upload committed hash state.'
Assert (($operations | Where-Object { $_.Args -contains 'DELE app_offline.htm' }).Count -eq 0) 'Failed upload brought an incomplete API online.'
$script:failUpload = $false
$operations.Clear()
Deploy-Api
Assert ($operations.Count -eq 3) 'Retry must upload the failed change.'
$operations.Clear()
$Force = $true
Deploy-Api
Assert ($operations.Count -eq 4) 'Force must reupload unchanged files.'
$Force = $false
$operations.Clear()
$DryRun = $true
'v4' | Set-Content (Join-Path $fixture 'api.dll')
Deploy-Api
Assert ($operations.Count -eq 0) 'Dry run connected to FTP.'
$invalidPathRejected = $false
try { Get-RemotePath '/api/../other' 'file' } catch { $invalidPathRejected = $true }
Assert $invalidPathRejected 'Parent traversal was accepted.'
Assert ((Escape-Curl 'a\b"c') -eq 'a\\b\"c') 'Credential config escaping failed.'

# Build a small independent client fixture to verify ZIP layout and final rename.
$root = Join-Path $testRoot 'client-repository'
New-Item -ItemType Directory -Path "$root/apps/client/src/environments", "$root/apps/client/dist/iptv/browser/assets" -Force | Out-Null
"export const environment = { version: '0.8.1' };" | Set-Content "$root/apps/client/src/environments/environment.ts"
'<html>test</html>' | Set-Content "$root/apps/client/dist/iptv/browser/index.html"
'asset' | Set-Content "$root/apps/client/dist/iptv/browser/assets/test.txt"
Push-Location $root
try {
    $DryRun = $false
    Deploy-Client
    Assert ($operations[0].Path -eq '/versions/0_8_1.zip.uploading') 'Client upload was not staged.'
    Assert ($operations[2].Args -contains 'RNTO 0_8_1.zip') 'Client final ZIP rename after CWD missing.'
    $operations.Clear()
    $script:remoteNames = @('0_8_1.zip', '0_8_1.zip.uploading')
    Complete-ClientUpload '0_8_1.zip'
    Assert ($operations[1].Args -contains 'RNFR 0_8_1.zip') 'Existing ZIP must be moved aside before replacement.'
    Assert ($operations[2].Args -contains 'RNFR 0_8_1.zip.uploading') 'Staged ZIP must replace the old ZIP.'
    Assert ($operations[3].Args[3] -like 'DELE 0_8_1.zip.*.previous') 'Successful replacement must remove its backup.'
    $operations.Clear()
    $script:failRename = $true
    $failed = $false
    try { Complete-ClientUpload '0_8_1.zip' } catch { $failed = $true }
    Assert $failed 'Rename failure must propagate.'
    Assert ($operations[3].Args[3] -like 'RNFR 0_8_1.zip.*.previous') 'Failed replacement must restore the old ZIP.'
    Assert ($operations[3].Args -contains 'RNTO 0_8_1.zip') 'Rollback must restore the original ZIP name.'
    Assert ($operations.Count -eq 4) 'Failed replacement must not delete its backup.'
    $script:failRename = $false
    $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $output '0_8_1.zip'))
    try {
        Assert (@($zip.Entries | Where-Object { $_.FullName -eq 'index.html' }).Count -eq 1) 'ZIP index.html must be at root.'
        Assert (@($zip.Entries | Where-Object { $_.FullName -eq 'assets/test.txt' }).Count -eq 1) 'ZIP nested assets must use portable forward slashes.'
    } finally { $zip.Dispose() }
} finally { Pop-Location }
Write-Host 'All deployment behavior tests passed.'
