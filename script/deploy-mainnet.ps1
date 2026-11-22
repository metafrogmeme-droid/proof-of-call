#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy ProofOfCall to QIE mainnet (chain 1990) with the official QIE Oracle BTC / USD and ETH / USD feeds.
    The owner runs this from his own machine. Full runbook: docs/MAINNET.md.

.DESCRIPTION
    Without -Broadcast it only checks and simulates; nothing is sent. With -Broadcast it simulates, asks you to type
    1990, broadcasts, reads the deployment back from the chain (script/Check.s.sol) and writes
    deployments/qie-mainnet-1990.json. Keys never pass through this script: forge asks for the keystore password
    (or uses the Ledger) itself.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\script\deploy-mainnet.ps1 `
        -Owner 0x020A4366595292aa16184536bAB2E9949d0D925F -Deployer 0xYourDeployer -Account qie-mainnet-deployer -MaxGap 21600

.EXAMPLE
    # Rehearsal against a local anvil fork of mainnet (start: anvil --fork-url https://rpc1mainnet.qie.digital/ --auto-impersonate)
    powershell -NoProfile -ExecutionPolicy Bypass -File .\script\deploy-mainnet.ps1 `
        -Owner 0x020A4366595292aa16184536bAB2E9949d0D925F -Deployer 0xYourDeployer -MaxGap 21600 `
        -Rehearsal -RpcUrl http://127.0.0.1:8545 -Broadcast
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
    [string]$RpcUrl = 'https://rpc1mainnet.qie.digital/'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MainnetDeploy.psm1') -Force
$deployArgs = @{
    Owner       = $Owner
    Deployer    = $Deployer
    MaxGap      = $MaxGap
    FlatBandBps = $FlatBandBps
    Account     = $Account
    Ledger      = $Ledger
    Rehearsal   = $Rehearsal
    Broadcast   = $Broadcast
    RpcUrl      = $RpcUrl
    RepoRoot    = (Split-Path -Parent $PSScriptRoot)
}
Invoke-PocMainnetDeploy @deployArgs
