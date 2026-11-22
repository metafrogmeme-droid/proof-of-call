#Requires -Version 5.1
# Pester 5 tests for script/MainnetDeploy.psm1. No network, no forge, no keys: every tool call is mocked.

BeforeAll {
    $Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    Import-Module (Join-Path (Join-Path $Repo 'script') 'MainnetDeploy.psm1') -Force

    $Owner = '0x020A4366595292aa16184536bAB2E9949d0D925F'
    $Deployer = '0x00000000000000000000000000000000000000D1'
    $Btc = '0x9E596d809a20A272c788726f592c0d1629755440'
    $Eth = '0x4bb7012Fbc79fE4Ae9B664228977b442b385500d'
    $PocAddress = '0x1111111111111111111111111111111111111111'

    function New-TestRepo {
        param([string]$Status = 'verified', [int]$ChainId = 1990, [string]$BtcAddress = $Btc)
        $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path (Join-Path $root 'deployments') -Force | Out-Null
        $config = [ordered]@{
            network          = 'QIE mainnet'
            chainId          = $ChainId
            rpc              = 'https://rpc1mainnet.qie.digital/'
            explorer         = 'https://mainnet.qie.digital'
            feeds            = @(
                [ordered]@{ asset = 'BTC'; pair = 'BTC / USDT'; address = $BtcAddress; decimals = 8 },
                [ordered]@{ asset = 'ETH'; pair = 'ETH / USDT'; address = $Eth; decimals = 8 }
            )
            feedVerification = [ordered]@{ status = $Status }
        }
        $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'deployments/qie-mainnet-1990.config.json')
        return $root
    }

    function Get-RunJson {
        param([string]$Status = '0x1', [int]$Creates = 1)
        $txs = @()
        for ($i = 0; $i -lt $Creates; $i++) {
            $txs += [ordered]@{ hash = '0xabc'; transactionType = 'CREATE'; contractName = 'ProofOfCall'; contractAddress = $PocAddress }
        }
        $run = [ordered]@{
            transactions = $txs
            receipts     = @([ordered]@{ transactionHash = '0xabc'; status = $Status; blockNumber = '0x10' })
            commit       = 'deadbee'
        }
        return ($run | ConvertTo-Json -Depth 5)
    }

    function Set-NativeMock {
        # Mock bodies run in the module's scope, so they read their answers from one global table.
        param([string]$ChainId = '1990', [string]$Code = '0x6080', [string]$Decimals = '8', [string]$Balance = '1.000000000000000000', [string]$Client = 'anvil/v1.8.6')
        $global:PocTest = @{
            ChainId = $ChainId; Code = $Code; Decimals = $Decimals; Balance = $Balance; Client = $Client
            RunJson = (Get-RunJson)
        }
        Mock Assert-PocTool -ModuleName MainnetDeploy {}
        Mock Assert-PocCleanEnvironment -ModuleName MainnetDeploy {}
        Mock Invoke-PocNative -ModuleName MainnetDeploy {
            switch ($Arguments[0]) {
                '--version' { return 'forge Version: 1.8.6-v1.8.6' }
                'chain-id' { return $global:PocTest.ChainId }
                'code' { return $global:PocTest.Code }
                'call' { return $global:PocTest.Decimals }
                'balance' { return $global:PocTest.Balance }
                'client' { return $global:PocTest.Client }
                'rpc' { return 'null' }
                default { throw "unexpected tool call: $($Arguments -join ' ')" }
            }
        }
        Mock Invoke-PocInteractive -ModuleName MainnetDeploy {
            $here = (Get-Location).Path
            $line = '{0}|go={1}|feeds={2}|addr={3}' -f ($Arguments -join ' '), $env:POC_MAINNET_GO, $env:POC_FEEDS, $env:POC_ADDRESS
            Add-Content -LiteralPath (Join-Path $here 'interactive.log') -Value $line
            if ($Arguments -contains '--broadcast') {
                $dir = Join-Path $here 'broadcast/Deploy.s.sol/1990'
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
                Set-Content -LiteralPath (Join-Path $dir 'run-latest.json') -Value $global:PocTest.RunJson
            }
        }
        Mock Read-PocConfirmation -ModuleName MainnetDeploy { '1990' }
    }

    function Get-InteractiveLog {
        param([string]$Root)
        $log = Join-Path $Root 'interactive.log'
        if (-not (Test-Path -LiteralPath $log)) { return @() }
        return @(Get-Content -LiteralPath $log)
    }

    $Base = @{ Owner = $Owner; Deployer = $Deployer; MaxGap = 21600; Account = 'qie-mainnet-deployer' }
}

AfterAll {
    Remove-Variable -Name PocTest -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Test-PocAddress' {
    It 'accepts a checksummed or lowercase address' {
        Test-PocAddress -Value $Owner | Should -BeTrue
        Test-PocAddress -Value $Owner.ToLower() | Should -BeTrue
    }
    It 'rejects zero, short, unprefixed and empty values' {
        Test-PocAddress -Value '0x0000000000000000000000000000000000000000' | Should -BeFalse
        Test-PocAddress -Value '0x1234' | Should -BeFalse
        Test-PocAddress -Value '020A4366595292aa16184536bAB2E9949d0D925F' | Should -BeFalse
        Test-PocAddress -Value '' | Should -BeFalse
    }
}

Describe 'Get-PocSignerArgument' {
    It 'builds keystore arguments' {
        (Get-PocSignerArgument -Account 'qie-mainnet-deployer' -Sender $Deployer) -join ' ' |
            Should -Be "--account qie-mainnet-deployer --sender $($Deployer)"
    }
    It 'builds Ledger and unlocked arguments' {
        (Get-PocSignerArgument -Ledger -Sender $Deployer) -join ' ' | Should -Be "--ledger --sender $($Deployer)"
        (Get-PocSignerArgument -Unlocked -Sender $Deployer) -join ' ' | Should -Be "--unlocked --sender $($Deployer)"
    }
    It 'needs exactly one signer' {
        { Get-PocSignerArgument -Sender $Deployer } | Should -Throw -ExpectedMessage '*exactly one signer*'
        { Get-PocSignerArgument -Account 'a' -Ledger -Sender $Deployer } | Should -Throw -ExpectedMessage '*exactly one signer*'
    }
    It 'rejects odd keystore names' {
        { Get-PocSignerArgument -Account 'a b;rm' -Sender $Deployer } | Should -Throw -ExpectedMessage '*letters, digits*'
    }
}

Describe 'Assert-PocCleanEnvironment' {
    BeforeEach {
        $SavedCi = $env:CI
        Remove-Item Env:CI -ErrorAction SilentlyContinue
        $Clean = New-TestRepo
    }
    AfterEach {
        if ($null -ne $SavedCi) { $env:CI = $SavedCi }
        Remove-Item Env:FOUNDRY_EVM_VERSION, Env:DEPLOYER_PRIVATE_KEY, Env:ETH_PASSWORD, Env:CAST_PASSWORD -ErrorAction SilentlyContinue
    }
    It 'passes in a clean environment' {
        { Assert-PocCleanEnvironment -RepoRoot $Clean } | Should -Not -Throw
    }
    It 'refuses FOUNDRY_* overrides' {
        $env:FOUNDRY_EVM_VERSION = 'cancun'
        { Assert-PocCleanEnvironment -RepoRoot $Clean } | Should -Throw -ExpectedMessage '*FOUNDRY_EVM_VERSION*'
    }
    It 'refuses a key variable and never shows its value' {
        $env:DEPLOYER_PRIVATE_KEY = 'not-a-real-value-123'
        try {
            Assert-PocCleanEnvironment -RepoRoot $Clean
            throw 'expected a refusal'
        }
        catch {
            $_.Exception.Message | Should -BeLike '*DEPLOYER_PRIVATE_KEY*'
            $_.Exception.Message | Should -Not -BeLike '*not-a-real-value-123*'
        }
    }
    It 'refuses the keystore password variables Foundry reads' {
        $env:ETH_PASSWORD = 'x'
        { Assert-PocCleanEnvironment -RepoRoot $Clean } | Should -Throw -ExpectedMessage '*ETH_PASSWORD*'
        Remove-Item Env:ETH_PASSWORD
        $env:CAST_PASSWORD = 'x'
        { Assert-PocCleanEnvironment -RepoRoot $Clean } | Should -Throw -ExpectedMessage '*CAST_PASSWORD*'
    }
    It 'refuses CI' {
        $env:CI = 'true'
        { Assert-PocCleanEnvironment -RepoRoot $Clean } | Should -Throw -ExpectedMessage '*CI*'
    }
    It 'refuses a .env file in the repo' {
        Set-Content -LiteralPath (Join-Path $Clean '.env') -Value '# empty'
        { Assert-PocCleanEnvironment -RepoRoot $Clean } | Should -Throw -ExpectedMessage '*.env*'
    }
}

Describe 'Get-PocMainnetConfig' {
    It 'returns the feeds of a verified config' {
        $root = New-TestRepo
        $config = Get-PocMainnetConfig -Path (Join-Path $root 'deployments/qie-mainnet-1990.config.json')
        @($config.feeds).Count | Should -Be 2
        $config.feeds[0].address | Should -Be $Btc
    }
    It 'refuses unverified feeds' {
        $root = New-TestRepo -Status 'pending'
        { Get-PocMainnetConfig -Path (Join-Path $root 'deployments/qie-mainnet-1990.config.json') } | Should -Throw -ExpectedMessage '*not verified*'
    }
    It 'refuses another chain and bad addresses' {
        $root = New-TestRepo -ChainId 1983
        { Get-PocMainnetConfig -Path (Join-Path $root 'deployments/qie-mainnet-1990.config.json') } | Should -Throw -ExpectedMessage '*expected 1990*'
        $root = New-TestRepo -BtcAddress '0x1234'
        { Get-PocMainnetConfig -Path (Join-Path $root 'deployments/qie-mainnet-1990.config.json') } | Should -Throw -ExpectedMessage '*invalid address*'
    }
    It 'committed config lists exactly the BTC and ETH feeds that DeployConfig.sol names' {
        $config = Get-Content -LiteralPath (Join-Path $Repo 'deployments/qie-mainnet-1990.config.json') -Raw | ConvertFrom-Json
        $sol = Get-Content -LiteralPath (Join-Path $Repo 'script/DeployConfig.sol') -Raw
        $btc = [regex]::Match($sol, 'QIE_MAINNET_BTC_USD = (0x[0-9a-fA-F]{40})').Groups[1].Value
        $eth = [regex]::Match($sol, 'QIE_MAINNET_ETH_USD = (0x[0-9a-fA-F]{40})').Groups[1].Value
        $config.chainId | Should -Be 1990
        @($config.feeds).Count | Should -Be 2
        ($config.feeds | Where-Object { $_.asset -eq 'BTC' }).address | Should -BeExactly $btc
        ($config.feeds | Where-Object { $_.asset -eq 'ETH' }).address | Should -BeExactly $eth
    }
    It 'committed config is verified, with the on-chain labels and the evidence recorded next to the status' {
        $config = Get-Content -LiteralPath (Join-Path $Repo 'deployments/qie-mainnet-1990.config.json') -Raw | ConvertFrom-Json
        ($config.feeds | Where-Object { $_.asset -eq 'BTC' }).pair | Should -BeExactly 'BTC / USDT'
        ($config.feeds | Where-Object { $_.asset -eq 'ETH' }).pair | Should -BeExactly 'ETH / USDT'
        $v = $config.feedVerification
        $v.status | Should -BeExactly 'verified'
        $v.checkedAt | Should -Not -BeNullOrEmpty
        $v.block | Should -Be 12088889
        $v.chainId | Should -Be 1990
        $v.rpc | Should -BeExactly 'https://rpc1mainnet.qie.digital/'
        $v.docs | Should -BeLike 'https://docs.qie.digital/*'
        $v.onChain.BTC.description | Should -BeExactly 'BTC / USDT'
        $v.onChain.ETH.description | Should -BeExactly 'ETH / USDT'
        $v.onChain.BTC.address | Should -BeExactly ($config.feeds | Where-Object { $_.asset -eq 'BTC' }).address
        $v.onChain.ETH.address | Should -BeExactly ($config.feeds | Where-Object { $_.asset -eq 'ETH' }).address
        $config.params.maxGap | Should -BeNullOrEmpty
        Get-PocMainnetConfig -Path (Join-Path $Repo 'deployments/qie-mainnet-1990.config.json') | Should -Not -BeNullOrEmpty
    }
}

Describe 'Get-PocBroadcastRun' {
    BeforeEach {
        $RunFile = Join-Path $TestDrive 'run-latest.json'
    }
    It 'returns the ProofOfCall creation' {
        Set-Content -LiteralPath $RunFile -Value (Get-RunJson)
        $run = Get-PocBroadcastRun -Path $RunFile -NotBefore (Get-Date).AddMinutes(-1)
        $run.Address | Should -Be $PocAddress
        $run.TxHash | Should -Be '0xabc'
        $run.Block | Should -Be 16
        $run.Commit | Should -Be 'deadbee'
    }
    It 'refuses a record older than this run' {
        Set-Content -LiteralPath $RunFile -Value (Get-RunJson)
        { Get-PocBroadcastRun -Path $RunFile -NotBefore (Get-Date).AddMinutes(5) } | Should -Throw -ExpectedMessage '*older than this run*'
    }
    It 'refuses a failed deploy and an ambiguous record' {
        Set-Content -LiteralPath $RunFile -Value (Get-RunJson -Status '0x0')
        { Get-PocBroadcastRun -Path $RunFile -NotBefore (Get-Date).AddMinutes(-1) } | Should -Throw -ExpectedMessage '*failed*'
        Set-Content -LiteralPath $RunFile -Value (Get-RunJson -Creates 2)
        { Get-PocBroadcastRun -Path $RunFile -NotBefore (Get-Date).AddMinutes(-1) } | Should -Throw -ExpectedMessage '*exactly one*'
    }
}

Describe 'Write-PocDeploymentRecord' {
    It 'writes the record without a BOM and never overwrites it' {
        $root = New-TestRepo
        $config = Get-PocMainnetConfig -Path (Join-Path $root 'deployments/qie-mainnet-1990.config.json')
        $run = [pscustomobject]@{ Address = $PocAddress; TxHash = '0xabc'; Block = 16; Commit = 'deadbee' }
        $out = Join-Path $root 'deployments/qie-mainnet-1990.json'
        Write-PocDeploymentRecord -OutFile $out -Run $run -Config $config -Owner $Owner -Deployer $Deployer -MaxGap 21600 -FlatBandBps 10
        $bytes = [System.IO.File]::ReadAllBytes($out)
        $bytes[0] | Should -Be ([byte][char]'{')
        $record = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
        $record.chainId | Should -Be 1990
        $record.contracts.ProofOfCall.address | Should -Be $PocAddress
        $record.contracts.ProofOfCall.constructorArgs.maxGap | Should -Be 21600
        @($record.contracts.ProofOfCall.constructorArgs.feeds).Count | Should -Be 2
        $record.explorerVerified | Should -BeFalse
        { Write-PocDeploymentRecord -OutFile $out -Run $run -Config $config -Owner $Owner -Deployer $Deployer -MaxGap 21600 -FlatBandBps 10 } |
            Should -Throw -ExpectedMessage '*already exists*'
    }
}

Describe 'Invoke-PocMainnetDeploy' {
    It 'dry run: checks, simulates once with the keystore signer, sends nothing, cleans the environment' {
        Set-NativeMock
        $root = New-TestRepo
        Invoke-PocMainnetDeploy @Base -RepoRoot $root
        $log = @(Get-InteractiveLog -Root $root)
        $log.Count | Should -Be 1
        $log[0] | Should -BeLike "script script/Deploy.s.sol:Deploy --rpc-url https://rpc1mainnet.qie.digital/ --account qie-mainnet-deployer --sender $($Deployer)|go=yes|feeds=$($Btc),$($Eth)|*"
        $log[0] | Should -Not -BeLike '*--broadcast*'
        Should -Invoke Read-PocConfirmation -ModuleName MainnetDeploy -Times 0 -Exactly
        $env:POC_MAINNET_GO | Should -BeNullOrEmpty
        $env:POC_FEEDS | Should -BeNullOrEmpty
        Test-Path -LiteralPath (Join-Path $root 'deployments/qie-mainnet-1990.json') | Should -BeFalse
    }

    It 'broadcast: simulate, confirm, broadcast, read back, write the record' {
        Set-NativeMock
        $root = New-TestRepo
        Invoke-PocMainnetDeploy @Base -RepoRoot $root -Broadcast
        $log = @(Get-InteractiveLog -Root $root)
        $log.Count | Should -Be 3
        $log[1] | Should -BeLike '*--broadcast --slow|go=yes*'
        $log[2] | Should -BeLike "script script/Check.s.sol:Check --rpc-url https://rpc1mainnet.qie.digital/|go=yes|*|addr=$($PocAddress)"
        $record = Get-Content -LiteralPath (Join-Path $root 'deployments/qie-mainnet-1990.json') -Raw | ConvertFrom-Json
        $record.contracts.ProofOfCall.address | Should -Be $PocAddress
        $record.contracts.ProofOfCall.block | Should -Be 16
        $record.sourceCommit | Should -Be 'deadbee'
        $env:POC_ADDRESS | Should -BeNullOrEmpty
    }

    It 'sends nothing when the confirmation is not 1990' {
        Set-NativeMock
        Mock Read-PocConfirmation -ModuleName MainnetDeploy { '1983' }
        $root = New-TestRepo
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root -Broadcast } | Should -Throw -ExpectedMessage '*Not confirmed*'
        @(Get-InteractiveLog -Root $root).Count | Should -Be 1
        $env:POC_MAINNET_GO | Should -BeNullOrEmpty
    }

    It 'refuses the wrong chain before any forge run' {
        Set-NativeMock -ChainId '1983'
        $root = New-TestRepo
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root } | Should -Throw -ExpectedMessage '*expected 1990*'
        @(Get-InteractiveLog -Root $root).Count | Should -Be 0
    }

    It 'refuses feeds without code or with other decimals' {
        Set-NativeMock -Code '0x'
        $root = New-TestRepo
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root } | Should -Throw -ExpectedMessage '*has no code*'
        Set-NativeMock -Decimals '18'
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root } | Should -Throw -ExpectedMessage '*expected 8*'
    }

    It 'refuses an unfunded deployer' {
        Set-NativeMock -Balance '0.000000000000000000'
        $root = New-TestRepo
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root } | Should -Throw -ExpectedMessage '*no QIE for gas*'
    }

    It 'refuses to deploy twice' {
        Set-NativeMock
        $root = New-TestRepo
        Set-Content -LiteralPath (Join-Path $root 'deployments/qie-mainnet-1990.json') -Value '{}'
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root -Broadcast } | Should -Throw -ExpectedMessage '*already exists*'
        @(Get-InteractiveLog -Root $root).Count | Should -Be 0
    }

    It 'refuses unverified feed addresses' {
        Set-NativeMock
        $root = New-TestRepo -Status 'pending'
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root } | Should -Throw -ExpectedMessage '*not verified*'
    }

    It 'refuses bad inputs before touching the network' {
        Set-NativeMock
        $root = New-TestRepo
        { Invoke-PocMainnetDeploy -Owner '0x0' -Deployer $Deployer -MaxGap 21600 -Account 'a' -RepoRoot $root } | Should -Throw -ExpectedMessage '*-Owner*'
        { Invoke-PocMainnetDeploy -Owner $Owner -Deployer $Deployer -MaxGap 30 -Account 'a' -RepoRoot $root } | Should -Throw -ExpectedMessage '*-MaxGap*'
        { Invoke-PocMainnetDeploy -Owner $Owner -Deployer $Deployer -MaxGap 21600 -FlatBandBps 1001 -Account 'a' -RepoRoot $root } | Should -Throw -ExpectedMessage '*-FlatBandBps*'
        { Invoke-PocMainnetDeploy @Base -RepoRoot $root -RpcUrl 'http://rpc1mainnet.qie.digital/' } | Should -Throw -ExpectedMessage '*https*'
        Should -Invoke Invoke-PocNative -ModuleName MainnetDeploy -Times 0 -Exactly
    }

    It 'uses the Ledger when asked' {
        Set-NativeMock
        $root = New-TestRepo
        Invoke-PocMainnetDeploy -Owner $Owner -Deployer $Deployer -MaxGap 21600 -Ledger -RepoRoot $root
        @(Get-InteractiveLog -Root $root)[0] | Should -BeLike "*--ledger --sender $($Deployer)|*"
    }

    It 'rehearsal: local anvil fork only, unlocked signer, funds the fork, writes no record' {
        Set-NativeMock
        $root = New-TestRepo
        Invoke-PocMainnetDeploy -Owner $Owner -Deployer $Deployer -MaxGap 21600 -Rehearsal -RpcUrl 'http://127.0.0.1:8545' -Broadcast -RepoRoot $root
        $log = @(Get-InteractiveLog -Root $root)
        $log.Count | Should -Be 3
        $log[0] | Should -BeLike "*--unlocked --sender $($Deployer)|*"
        Should -Invoke Invoke-PocNative -ModuleName MainnetDeploy -Times 1 -Exactly -ParameterFilter { $Arguments[0] -eq 'rpc' -and $Arguments[1] -eq 'anvil_setBalance' }
        Test-Path -LiteralPath (Join-Path $root 'deployments/qie-mainnet-1990.json') | Should -BeFalse
    }

    It 'rehearsal refuses a remote RPC and a node that is not anvil' {
        Set-NativeMock -Client 'Geth/v1.13'
        $root = New-TestRepo
        { Invoke-PocMainnetDeploy -Owner $Owner -Deployer $Deployer -MaxGap 21600 -Rehearsal -RpcUrl 'https://rpc1mainnet.qie.digital/' -RepoRoot $root } |
            Should -Throw -ExpectedMessage '*local anvil fork*'
        { Invoke-PocMainnetDeploy -Owner $Owner -Deployer $Deployer -MaxGap 21600 -Rehearsal -RpcUrl 'http://127.0.0.1:8545' -RepoRoot $root } |
            Should -Throw -ExpectedMessage '*needs anvil*'
    }
}
