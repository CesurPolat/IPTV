param(
    [ValidateSet('all', 'api', 'client')][string]$Target = 'all',
    [string]$Config = 'deploy.local.json',
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

function Escape-Curl([string]$Value) {
    if ($Value -match "[\r\n\x00]") { throw 'FTP settings must not contain line breaks or null characters.' }
    return $Value.Replace('\', '\\').Replace('"', '\"')
}

function Get-RemotePath([string]$Directory, [string]$Name) {
    $path = $Directory.TrimEnd('/') + '/' + $Name.Replace('\', '/')
    if (-not $path.StartsWith('/') -or $path -match '[\r\n\x00"]' -or $path.Split('/') -contains '..') {
        throw 'remoteDir must be an absolute FTP path without parent traversal, quotes or line breaks.'
    }
    return $path
}

function Invoke-Ftp([string]$RemotePath, [string[]]$ExtraArguments) {
    $encoded = (($RemotePath.TrimStart('/') -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    # %2f selects an absolute path inside the FTP account's filesystem.
    $scheme = if ($settings.protocol -eq 'ftps-implicit') { 'ftps' } else { 'ftp' }
    $url = '{0}://{1}:{2}/%2f{3}' -f $scheme, $settings.host, $settings.port, $encoded
    $curlConfig = 'user = "' + (Escape-Curl ($settings.username + ':' + $script:ftpPassword)) + '"'
    $arguments = @('--disable', '--config', '-', '--silent', '--show-error', '--fail', '--connect-timeout', '30', '--max-time', '1800', '--globoff', '--url', $url)
    if ($settings.protocol -eq 'ftps') { $arguments += '--ssl-reqd' }
    # Feed credentials through stdin, keeping them out of process arguments and logs.
    $curlConfig | & curl.exe @arguments @ExtraArguments
    if ($LASTEXITCODE -ne 0) { throw "FTP operation failed (curl exit $LASTEXITCODE)." }
}

function Send-File([string]$LocalPath, [string]$RemotePath) {
    Invoke-Ftp $RemotePath @('--ftp-create-dirs', '--upload-file', $LocalPath)
}

function Rename-RemoteFile([string]$Directory, [string]$From, [string]$To) {
    # Explicit CWD also works for directory listings, where curl pre-transfer (+) commands may be skipped.
    Invoke-Ftp (Get-RemotePath $Directory '') @('--quote', ('CWD ' + $Directory.TrimEnd('/') + '/'), '--quote', "RNFR $From", '--quote', "RNTO $To", '--list-only') | Out-Null
}

function Complete-ClientUpload([string]$ZipName) {
    $directory = $settings.client.remoteDir
    $listing = @(Invoke-Ftp (Get-RemotePath $directory '') @('--list-only'))
    $names = @($listing | ForEach-Object { ($_.Trim().Replace('\', '/') -split '/')[-1] })
    $backup = $null
    if ($names -contains $ZipName) {
        # IIS FTP can reject RNTO when the destination already exists (550).
        $backup = $ZipName + '.' + [Guid]::NewGuid().ToString('N') + '.previous'
        Rename-RemoteFile $directory $ZipName $backup
    }
    try {
        Rename-RemoteFile $directory ($ZipName + '.uploading') $ZipName
    }
    catch {
        $renameError = $_
        if ($null -ne $backup) {
            try { Rename-RemoteFile $directory $backup $ZipName }
            catch { Write-Warning "Could not restore previous ZIP. Restore $backup to $ZipName in $directory manually." }
        }
        throw $renameError
    }
    if ($null -ne $backup) {
        try { Invoke-Ftp (Get-RemotePath $directory '') @('--quote', ('CWD ' + $directory.TrimEnd('/') + '/'), '--quote', "DELE $backup", '--list-only') | Out-Null }
        catch { Write-Warning "New ZIP is live, but temporary backup $backup could not be deleted." }
    }
}

function Write-State($Hashes, [string]$Destination) {
    $temp = $Destination + '.tmp'
    $Hashes | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Destination -Force
}

function Deploy-Api {
    $api = $settings.api
    $remoteDir = Get-RemotePath $api.remoteDir ''
    $publishDir = Join-Path $output ('api-' + [Guid]::NewGuid().ToString('N'))
    Invoke-Checked 'dotnet' @('publish', 'apps/server/IPTVAPI/IPTVAPI.csproj', '--configuration', 'Release', '--output', $publishDir)

    $identity = "$($settings.protocol)|$($settings.host)|$($settings.port)|$($settings.username)|$remoteDir"
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $key = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    $statePath = Join-Path $output "api-$key.json"
    $previous = @{}
    if ((Test-Path -LiteralPath $statePath) -and -not $Force) {
        $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($property in $saved.PSObject.Properties) { $previous[$property.Name] = $property.Value }
    }
    $hashes = @{}
    $changed = @()
    foreach ($file in (Get-ChildItem -LiteralPath $publishDir -File -Recurse)) {
        $relative = $file.FullName.Substring($publishDir.Length + 1).Replace('\', '/')
        if ($relative -eq 'app_offline.htm') { throw 'Publish output unexpectedly contains app_offline.htm.' }
        $excluded = $false
        foreach ($pattern in $api.exclude) { if ($relative -like $pattern) { $excluded = $true; break } }
        if ($excluded) { continue }
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if ($previous[$relative] -ne $hashes[$relative]) { $changed += @{ Local = $file.FullName; Remote = $relative } }
    }
    Write-Host "API: $($changed.Count) changed / $($hashes.Count) deployable files. Publish: $publishDir"
    foreach ($file in $changed) { Write-Host "  API -> $($file.Remote)" }
    if ($DryRun -or $changed.Count -eq 0) { return }

    $offlinePath = Get-RemotePath $api.remoteDir 'app_offline.htm'
    if ($api.iis) {
        $offlineFile = Join-Path $output 'app_offline.htm'
        '<html><body>Application update in progress.</body></html>' | Set-Content -LiteralPath $offlineFile -Encoding UTF8
        Send-File $offlineFile $offlinePath
        Start-Sleep -Seconds $api.offlineWaitSeconds
    }
    try {
        foreach ($file in $changed) { Send-File $file.Local (Get-RemotePath $api.remoteDir $file.Remote) }
        if ($api.iis) { Invoke-Ftp $remoteDir @('--quote', ('CWD ' + $remoteDir), '--quote', 'DELE app_offline.htm', '--list-only') | Out-Null }
        Write-State $hashes $statePath
    }
    catch {
        if ($api.iis) { Write-Warning "API may be offline. Fix the error and rerun this command. If needed, manually remove $offlinePath after restoring a working publish." }
        throw
    }
}

function Deploy-Client {
    Invoke-Checked 'npm.cmd' @('exec', '--', 'turbo', 'run', 'build', '--filter=@iptv/client...')
    $environment = Get-Content 'apps/client/src/environments/environment.ts' -Raw
    $versionMatch = [regex]::Match($environment, "version\s*:\s*['`"](\d+\.\d+\.\d+)['`"]")
    if (-not $versionMatch.Success) { throw 'Client production environment must have a major.minor.patch version.' }
    $zipName = $versionMatch.Groups[1].Value.Replace('.', '_') + '.zip'
    $browser = Join-Path $root 'apps/client/dist/iptv/browser'
    if (-not (Test-Path -LiteralPath (Join-Path $browser 'index.html'))) { throw 'Client browser/index.html was not built.' }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipPath = Join-Path $output $zipName
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
    # Explicit forward slashes also work with Android ZIP readers on older .NET Framework.
    $archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in (Get-ChildItem -LiteralPath $browser -File -Recurse -Force)) {
            $entry = $file.FullName.Substring($browser.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally { $archive.Dispose() }
    $destination = Get-RemotePath $settings.client.remoteDir $zipName
    Write-Host "Client: $zipPath -> $destination"
    if ($DryRun) { return }
    # A partial upload is not advertised as a downloadable .zip.
    $staging = $destination + '.uploading'
    Send-File $zipPath $staging
    Complete-ClientUpload $zipName
}

if (-not (Test-Path -LiteralPath $Config)) { throw "Copy deploy.example.json to $Config and enter the FTP settings first." }
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
if ($settings.protocol -notin @('ftp', 'ftps', 'ftps-implicit')) { throw 'protocol must be ftp, ftps or ftps-implicit.' }
if ($settings.host -notmatch '^[a-zA-Z0-9.-]+$' -or [int]$settings.port -lt 1 -or [int]$settings.port -gt 65535) { throw 'Invalid FTP host or port.' }
if ([string]::IsNullOrWhiteSpace($settings.username)) { throw 'FTP username is required.' }
if ($Target -in @('all', 'api')) {
    if ([string]::IsNullOrWhiteSpace($settings.api.remoteDir)) { throw 'api.remoteDir is required.' }
    Get-RemotePath $settings.api.remoteDir '' | Out-Null
    if ($settings.api.iis -isnot [bool]) { throw 'api.iis must be true or false.' }
    if ($settings.api.iis -and ([int]$settings.api.offlineWaitSeconds -lt 0 -or [int]$settings.api.offlineWaitSeconds -gt 300)) { throw 'api.offlineWaitSeconds must be between 0 and 300.' }
}
if ($Target -in @('all', 'client')) {
    if ([string]::IsNullOrWhiteSpace($settings.client.remoteDir)) { throw 'client.remoteDir is required.' }
    Get-RemotePath $settings.client.remoteDir '' | Out-Null
}
Get-Command curl.exe -ErrorAction Stop | Out-Null
$output = Join-Path $root 'dist/deploy'
New-Item -ItemType Directory -Path $output -Force | Out-Null
# Prevent simultaneous invocations from racing the hash state and IIS offline marker.
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $output 'deploy.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if (-not $DryRun) {
        $script:ftpPassword = $env:IPTV_FTP_PASSWORD
        if ([string]::IsNullOrEmpty($script:ftpPassword)) {
            $script:ftpPassword = $settings.password
        }
        if ([string]::IsNullOrEmpty($script:ftpPassword)) {
            $secret = Read-Host 'FTP password' -AsSecureString
            $script:ftpPassword = [Net.NetworkCredential]::new('', $secret).Password
        }
    }
    if ($Target -in @('all', 'api')) { Deploy-Api }
    if ($Target -in @('all', 'client')) { Deploy-Client }
    Write-Host 'Deploy completed.'
}
finally {
    $script:ftpPassword = $null
    if ($null -ne $lock) { $lock.Dispose() }
}
