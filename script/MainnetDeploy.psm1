#Requires -Version 5.1
<#
.SYNOPSIS
    Helpers behind script/deploy-mainnet.ps1: deploys ProofOfCall to QIE mainnet (chain 1990) from the owner's
    machine, with the official QIE Oracle feeds from deployments/qie-mainnet-1990.config.json.

.DESCRIPTION
    Works in Windows PowerShell 5.1 and PowerShell 7. Never reads, prints or stores a private key, mnemonic or
    password: signing happens inside forge (Foundry keystore password prompt or Ledger). The Solidity guards in
    script/Deploy.s.sol and script/DeployConfig.sol run again inside forge, so this module is a first line only.
#>
Set-StrictMode -Version Latest

$script:MainnetChainId = '1990'
$script:ZeroAddress = '0x0000000000000000000000000000000000000000'
$script:DeployEnvNames = @(
    'POC_EXPECTED_CHAIN_ID', 'POC_MAINNET_GO', 'POC_OWNER', 'POC_EXPECTED_DEPLOYER', 'POC_MAX_GAP',
    'POC_FLAT_BAND_BPS', 'POC_FEEDS', 'POC_MOCK_FEEDS', 'POC_ADDRESS', 'POC_CHECK_FEEDS', 'POC_MOCK_ADMIN'
)
$script:RehearsalBalanceWei = '0x56BC75E2D63100000' # 100 QIE, local anvil fork only

function Write-PocInfo {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Message)
    Write-Information -MessageData $Message -InformationAction Continue
}

function Test-PocAddress {
    <# True for a 0x-prefixed 20-byte hex address that is not the zero address. #>
    param([AllowEmptyString()][string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $false }
    return ($Value -match '^0x[0-9a-fA-F]{40}$') -and ($Value -ne $script:ZeroAddress)
}

function Invoke-PocNative {
    <# Runs a tool and returns its standard output as one trimmed string. Throws on a non-zero exit code. #>
    param(
        [Parameter(Mandatory = $true)][string]$Tool,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Tool @Arguments
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) { throw "$Tool $($Arguments | Select-Object -First 1) failed with exit code $code" }
    return ((@($output) | ForEach-Object { "$_" }) -join "`n").Trim()
}

function Invoke-PocInteractive {
    <# Runs a tool attached to the console (keystore password prompt, live output). Throws on a non-zero exit code. #>
    param(
        [Parameter(Mandatory = $true)][string]$Tool,
        [string[]]$Arguments = @()
    )
    & $Tool @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Tool $($Arguments | Select-Object -First 1) failed with exit code $LASTEXITCODE" }
}

function Read-PocConfirmation {
    param([Parameter(Mandatory = $true)][string]$Prompt)
    return (Read-Host -Prompt $Prompt)
}

function Assert-PocTool {
    <# Throws unless forge and cast are on PATH. #>
    foreach ($name in @('forge', 'cast')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
            throw "$name not found on PATH. Install Foundry v1.8.6 first (docs/MAINNET.md, step 1)."
        }
    }
}

function Assert-PocCleanEnvironment {
    <#
        Refuses to run when the environment could change the build, leak or bypass a secret, or mix in testnet
        settings: FOUNDRY_*/DAPP_* variables, key/mnemonic/password variables (names only, values never read),
        CI, or a .env file in the repo (forge would load it).
    #>
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $names = @(Get-ChildItem Env: | ForEach-Object { $_.Name })
    $build = @($names | Where-Object { $_ -match '^(FOUNDRY|DAPP)_' })
    if ($build.Count -gt 0) {
        throw "Unset these variables first (they override foundry.toml): $($build -join ', ')"
    }
    $secret = @($names | Where-Object { $_ -match '(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|PASSWORD)' })
    if ($secret.Count -gt 0) {
        throw "Unset these variables first (keys and passwords never go in the environment; values not shown): $($secret -join ', ')"
    }
    if ($names -contains 'CI') {
        throw 'Mainnet deploy refused in CI.'
    }
    if (Test-Path -LiteralPath (Join-Path $RepoRoot '.env')) {
        throw 'A .env file is in the repo folder. Move it out for the mainnet run (forge would load it).'
    }
}

function Get-PocMainnetConfig {
    <# Reads deployments/qie-mainnet-1990.config.json and refuses feeds that are not verified. #>
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "Config not found: $Path" }
    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ("$($config.chainId)" -ne $script:MainnetChainId) { throw "Config chainId is $($config.chainId), expected 1990." }
    if ($config.feedVerification.status -ne 'verified') {
        throw 'Feed addresses in the config are not verified yet (feedVerification.status). See docs/MAINNET.md.'
    }
    $feeds = @($config.feeds)
    if ($feeds.Count -lt 1) { throw 'Config has no feeds.' }
    foreach ($feed in $feeds) {
        if (-not (Test-PocAddress -Value $feed.address)) { throw "Config feed $($feed.pair) has an invalid address." }
    }
    return $config
}

function Get-PocSignerArgument {
    <# forge arguments for the chosen signer. Exactly one of -Account, -Ledger, -Unlocked. #>
    param(
        [AllowEmptyString()][string]$Account,
        [switch]$Ledger,
        [switch]$Unlocked,
        [Parameter(Mandatory = $true)][string]$Sender
    )
    $chosen = @(@([bool]$Account, [bool]$Ledger, [bool]$Unlocked) | Where-Object { $_ }).Count
    if ($chosen -ne 1) {
        throw 'Choose exactly one signer: -Account <keystore name> or -Ledger (or -Rehearsal on a local anvil fork).'
    }
    if ($Account) {
        if ($Account -notmatch '^[A-Za-z0-9._-]{1,64}$') { throw 'Keystore account name may only use letters, digits, . _ -' }
        return @('--account', $Account, '--sender', $Sender)
    }
    if ($Ledger) { return @('--ledger', '--sender', $Sender) }
    return @('--unlocked', '--sender', $Sender)
}

function Push-PocDeployEnv {
    <# Sets the POC_* variables for this process only. Pop-PocDeployEnv removes them again. #>
    param([Parameter(Mandatory = $true)][hashtable]$Values)
    foreach ($key in $Values.Keys) {
        if ($script:DeployEnvNames -notcontains $key) { throw "Unexpected variable $key" }
        [Environment]::SetEnvironmentVariable($key, [string]$Values[$key], 'Process')
    }
}

function Pop-PocDeployEnv {
    foreach ($name in $script:DeployEnvNames) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
}

function Get-PocBroadcastRun {
    <#
        Reads forge's broadcast record of this run and returns the ProofOfCall creation (address, tx hash, block).
        Refuses a record older than this run, so a stale rehearsal can never be recorded as the mainnet deploy.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][datetime]$NotBefore
    )
    if (-not (Test-Path -LiteralPath $Path)) { throw "Broadcast record not found: $Path" }
    $item = Get-Item -LiteralPath $Path
    # 2 s of slack for file systems that store coarse timestamps.
    if ($item.LastWriteTimeUtc -lt $NotBefore.ToUniversalTime().AddSeconds(-2)) { throw "Broadcast record $Path is older than this run." }
    $run = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $creates = @($run.transactions | Where-Object { $_.contractName -eq 'ProofOfCall' -and $_.transactionType -eq 'CREATE' })
    if ($creates.Count -ne 1) { throw "Expected exactly one ProofOfCall creation in $Path, found $($creates.Count)." }
    $tx = $creates[0]
    $receipt = @($run.receipts | Where-Object { $_.transactionHash -eq $tx.hash })
    if ($receipt.Count -ne 1) { throw "No receipt for $($tx.hash) in $Path." }
    if ("$($receipt[0].status)" -ne '0x1' -and "$($receipt[0].status)" -ne '1') { throw "Deploy transaction $($tx.hash) failed." }
    $blockText = "$($receipt[0].blockNumber)"
    if ($blockText.StartsWith('0x')) { $block = [Convert]::ToInt64($blockText.Substring(2), 16) } else { $block = [int64]$blockText }
    $commit = ''
    if ($run.PSObject.Properties.Name -contains 'commit' -and $run.commit) { $commit = "$($run.commit)" }
    return [pscustomobject]@{
        Address = [string]$tx.contractAddress
        TxHash  = [string]$tx.hash
        Block   = $block
        Commit  = $commit
    }
}

function Write-PocDeploymentRecord {
    <# Writes deployments/qie-mainnet-1990.json (same shape as the testnet record). Never overwrites. #>
    param(
        [Parameter(Mandatory = $true)][string]$OutFile,
        [Parameter(Mandatory = $true)]$Run,
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$Owner,
        [Parameter(Mandatory = $true)][string]$Deployer,
        [Parameter(Mandatory = $true)][int]$MaxGap,
        [Parameter(Mandatory = $true)][int]$FlatBandBps
    )
    if (Test-Path -LiteralPath $OutFile) { throw "$OutFile already exists; not overwriting." }
    $feedAddresses = @($Config.feeds | ForEach-Object { [string]$_.address })
    $record = [ordered]@{
        network          = 'QIE mainnet'
        chainId          = 1990
        explorer         = [string]$Config.explorer
        rpc              = [string]$Config.rpc
        sourceCommit     = $Run.Commit
        compiler         = [ordered]@{ solc = '0.8.28'; evmVersion = 'paris'; optimizer = $true; optimizerRuns = 200 }
        deployer         = $Deployer
        deployedAt       = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        contracts        = [ordered]@{
            ProofOfCall = [ordered]@{
                address         = $Run.Address
                tx              = $Run.TxHash
                block           = $Run.Block
                constructorArgs = [ordered]@{
                    initialOwner = $Owner
                    maxGap       = $MaxGap
                    flatBandBps  = $FlatBandBps
                    feeds        = $feedAddresses
                }
                owner           = $Owner
                pendingOwner    = $script:ZeroAddress
            }
        }
        feeds            = @($Config.feeds | ForEach-Object { [ordered]@{ asset = $_.asset; pair = $_.pair; address = $_.address } })
        explorerVerified = $false
    }
    $json = $record | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($OutFile, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
}

function Invoke-PocMainnetDeploy {
    <#
    .SYNOPSIS
        Preflight, simulation, typed confirmation, broadcast, read-back check and deployment record.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Owner,
        [Parameter(Mandatory = $true)][string]$Deployer,
        [Parameter(Mandatory = $true)][int]$MaxGap,
        [int]$FlatBandBps = 10,
        [string]$Account = '',
        [switch]$Ledger,
        [switch]$Rehearsal,
        [switch]$Broadcast,
        [string]$RpcUrl = 'https://rpc1mainnet.qie.digital/',
        [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
    )

    # 1. Inputs and environment, before any network call.
    if (-not (Test-PocAddress -Value $Owner)) { throw '-Owner must be a 0x address (not zero).' }
    if (-not (Test-PocAddress -Value $Deployer)) { throw '-Deployer must be a 0x address (not zero).' }
    if ($MaxGap -lt 60 -or $MaxGap -gt 604800) { throw '-MaxGap must be 60..604800 seconds.' }
    if ($FlatBandBps -lt 0 -or $FlatBandBps -gt 1000) { throw '-FlatBandBps must be 0..1000.' }
    $signer = Get-PocSignerArgument -Account $Account -Ledger:$Ledger -Unlocked:$Rehearsal -Sender $Deployer
    Assert-PocCleanEnvironment -RepoRoot $RepoRoot
    $config = Get-PocMainnetConfig -Path (Join-Path $RepoRoot 'deployments/qie-mainnet-1990.config.json')
    $recordFile = Join-Path $RepoRoot 'deployments/qie-mainnet-1990.json'
    if ($Broadcast -and -not $Rehearsal -and (Test-Path -LiteralPath $recordFile)) {
        throw "$recordFile already exists: ProofOfCall is already deployed on mainnet. Nothing sent."
    }
    if ($Rehearsal) {
        if ($RpcUrl -notmatch '^http://(127\.0\.0\.1|localhost):[0-9]{1,5}/?$') {
            throw '-Rehearsal only runs against a local anvil fork (http://127.0.0.1:<port>).'
        }
    }
    elseif ($RpcUrl -notmatch '^https://') {
        throw '-RpcUrl must be https:// for mainnet (use -Rehearsal for a local fork).'
    }
    Assert-PocTool

    # 2. The chain must really be QIE mainnet (a fork keeps chain id 1990).
    $forgeVersion = (Invoke-PocNative -Tool 'forge' -Arguments @('--version')) -split "`n" | Select-Object -First 1
    Write-PocInfo "forge      $forgeVersion"
    if ($forgeVersion -notmatch '1\.8\.6') { Write-Warning 'Foundry is not v1.8.6 (the version CI uses). Continue only if you know why.' }
    if ($Rehearsal) {
        $client = Invoke-PocNative -Tool 'cast' -Arguments @('client', '--rpc-url', $RpcUrl)
        if ($client -notmatch 'anvil') { throw "-Rehearsal needs anvil at $RpcUrl (got: $client)." }
    }
    $chainId = Invoke-PocNative -Tool 'cast' -Arguments @('chain-id', '--rpc-url', $RpcUrl)
    if ($chainId -ne $script:MainnetChainId) { throw "RPC chain id is $chainId, expected 1990. Nothing sent." }

    # 3. Feeds: code present, 8 decimals.
    $feedList = @($config.feeds | ForEach-Object { [string]$_.address })
    foreach ($feed in @($config.feeds)) {
        $code = Invoke-PocNative -Tool 'cast' -Arguments @('code', $feed.address, '--rpc-url', $RpcUrl)
        if ($code -eq '0x' -or [string]::IsNullOrEmpty($code)) { throw "Feed $($feed.pair) $($feed.address) has no code on this chain." }
        $decimals = Invoke-PocNative -Tool 'cast' -Arguments @('call', $feed.address, 'decimals()(uint8)', '--rpc-url', $RpcUrl)
        if ($decimals -ne '8') { throw "Feed $($feed.pair) reports $decimals decimals, expected 8." }
    }

    # 4. Deployer balance (a rehearsal funds the deployer on the local fork only).
    if ($Rehearsal) {
        Invoke-PocNative -Tool 'cast' -Arguments @('rpc', 'anvil_setBalance', $Deployer, $script:RehearsalBalanceWei, '--rpc-url', $RpcUrl) | Out-Null
    }
    $balance = Invoke-PocNative -Tool 'cast' -Arguments @('balance', $Deployer, '--ether', '--rpc-url', $RpcUrl)
    if ($balance -match '^0(\.0+)?$') { throw "Deployer $Deployer has no QIE for gas. Fund it first (docs/MAINNET.md)." }

    if ($Rehearsal) { $mode = 'REHEARSAL on a local fork (nothing reaches mainnet)' } else { $mode = 'QIE MAINNET' }
    if ($Ledger) { $signerText = 'Ledger' } elseif ($Rehearsal) { $signerText = 'anvil unlocked (fork only)' } else { $signerText = "keystore '$Account'" }
    Write-PocInfo "mode       $mode"
    Write-PocInfo "rpc        $RpcUrl (chain $chainId)"
    Write-PocInfo "owner      $Owner"
    Write-PocInfo "deployer   $Deployer via $signerText, balance $balance QIE"
    Write-PocInfo "maxGap     $MaxGap s, flatBand $FlatBandBps bps"
    foreach ($feed in @($config.feeds)) { Write-PocInfo "feed       $($feed.pair) $($feed.address)" }

    $forgeArgs = @('script', 'script/Deploy.s.sol:Deploy', '--rpc-url', $RpcUrl) + $signer
    Push-Location -LiteralPath $RepoRoot
    try {
        Push-PocDeployEnv -Values @{
            POC_EXPECTED_CHAIN_ID = $script:MainnetChainId
            POC_MAINNET_GO        = 'yes'
            POC_OWNER             = $Owner
            POC_EXPECTED_DEPLOYER = $Deployer
            POC_MAX_GAP           = "$MaxGap"
            POC_FLAT_BAND_BPS     = "$FlatBandBps"
            POC_FEEDS             = ($feedList -join ',')
        }

        # 5. Simulation (sends nothing).
        Write-PocInfo '== simulation (nothing is sent)'
        Invoke-PocInteractive -Tool 'forge' -Arguments $forgeArgs
        if (-not $Broadcast) {
            Write-PocInfo '== dry run only. Re-run with -Broadcast to send.'
            return
        }

        # 6. Typed confirmation, then broadcast.
        $answer = Read-PocConfirmation -Prompt "Type 1990 to broadcast ($mode)"
        if ($answer -ne $script:MainnetChainId) { throw 'Not confirmed. Nothing sent.' }
        $started = Get-Date
        Write-PocInfo '== broadcast'
        Invoke-PocInteractive -Tool 'forge' -Arguments ($forgeArgs + @('--broadcast', '--slow'))

        # 7. Read back what was deployed, from the chain.
        $run = Get-PocBroadcastRun -Path (Join-Path $RepoRoot 'broadcast/Deploy.s.sol/1990/run-latest.json') -NotBefore $started
        $deployedCode = Invoke-PocNative -Tool 'cast' -Arguments @('code', $run.Address, '--rpc-url', $RpcUrl)
        if ($deployedCode -eq '0x' -or [string]::IsNullOrEmpty($deployedCode)) { throw "No code at $($run.Address) on $RpcUrl." }
        Push-PocDeployEnv -Values @{ POC_ADDRESS = $run.Address; POC_CHECK_FEEDS = ($feedList -join ',') }
        Write-PocInfo '== read-back check'
        Invoke-PocInteractive -Tool 'forge' -Arguments @('script', 'script/Check.s.sol:Check', '--rpc-url', $RpcUrl)

        Write-PocInfo "ProofOfCall $($run.Address) (tx $($run.TxHash), block $($run.Block))"
        if ($Rehearsal) {
            Write-PocInfo '== rehearsal done. No deployment record written.'
            return
        }
        Write-PocDeploymentRecord -OutFile $recordFile -Run $run -Config $config -Owner $Owner -Deployer $Deployer `
            -MaxGap $MaxGap -FlatBandBps $FlatBandBps
        Write-PocInfo "Explorer: $($config.explorer)/address/$($run.Address)"
        Write-PocInfo "Record:   $recordFile (commit it, see docs/MAINNET.md step 8)"
    }
    finally {
        Pop-PocDeployEnv
        Pop-Location
    }
}

Export-ModuleMember -Function Test-PocAddress, Invoke-PocNative, Invoke-PocInteractive, Read-PocConfirmation, `
    Assert-PocTool, Assert-PocCleanEnvironment, Get-PocMainnetConfig, Get-PocSignerArgument, Push-PocDeployEnv, `
    Pop-PocDeployEnv, Get-PocBroadcastRun, Write-PocDeploymentRecord, Invoke-PocMainnetDeploy
