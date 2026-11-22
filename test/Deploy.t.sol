// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Check} from "../script/Check.s.sol";
import {DeployConfig} from "../script/DeployConfig.sol";
import {PostDeployCheck} from "../script/PostDeployCheck.sol";

/// @dev Exposes the library rules as external calls so reverts can be asserted.
contract ConfigHarness {
    function checkChain(uint256 chainId, DeployConfig.Config memory c) external pure {
        DeployConfig.checkChain(chainId, c);
    }

    function checkParams(uint256 chainId, DeployConfig.Config memory c) external pure {
        DeployConfig.checkParams(chainId, c);
    }

    function isQieMainnetFeed(address f) external pure returns (bool) {
        return DeployConfig.isQieMainnetFeed(f);
    }

    function checkBuild(bytes memory runtime) external pure {
        DeployConfig.checkBuild(runtime);
    }
}

abstract contract DeployTestBase is Test {
    uint256 internal constant TESTNET = 1983;
    uint256 internal constant MAINNET = 1990;
    // Throwaway test-only key (not a real account). Real keys never appear in this repo.
    uint256 internal constant TEST_PK = 0xA11CE;

    Deploy internal script;
    Check internal checker;
    ConfigHarness internal h;
    address internal owner = makeAddr("owner");
    address internal deployer;

    function setUp() public virtual {
        script = new Deploy();
        checker = new Check();
        h = new ConfigHarness();
        deployer = vm.addr(TEST_PK);
        vm.warp(1_800_000_000);
    }

    function _testnetCfg() internal view returns (DeployConfig.Config memory c) {
        c.expectedChainId = TESTNET;
        c.owner = owner;
        c.maxGap = 6 hours;
        c.flatBandBps = 10;
        c.mockDescriptions = new string[](2);
        c.mockDescriptions[0] = "BTC / USD";
        c.mockDescriptions[1] = "ETH / USD";
    }

    function _officialFeeds() internal pure returns (address[] memory f) {
        f = new address[](7);
        f[0] = 0x9E596d809a20A272c788726f592c0d1629755440;
        f[1] = 0x4bb7012Fbc79fE4Ae9B664228977b442b385500d;
        f[2] = 0x804582B1f8Fea73919e7c737115009f668f97528;
        f[3] = 0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21;
        f[4] = 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17;
        f[5] = 0x9aD0199a67588ee293187d26bA1BE61cb07A214c;
        f[6] = 0x775A56117Fdb8b31877E75Ceeb68C96765b031e6;
    }

    function _mainnetCfg() internal pure returns (DeployConfig.Config memory c) {
        c.expectedChainId = MAINNET;
        c.mainnetGo = true;
        c.owner = address(0x020A);
        c.maxGap = 6 hours;
        c.flatBandBps = 10;
        c.feeds = _officialFeeds();
        c.expectedDeployer = address(0xDE9);
    }

    /// @dev The two feeds the hackathon mainnet deployment allowlists.
    function _btcEth() internal pure returns (address[] memory f) {
        f = new address[](2);
        f[0] = DeployConfig.QIE_MAINNET_BTC_USD;
        f[1] = DeployConfig.QIE_MAINNET_ETH_USD;
    }
}

contract DeployConfigTest is DeployTestBase {
    function test_boundsMirrorTheContract() public {
        ProofOfCall poc = new ProofOfCall(owner, 1 hours, 10, new address[](0));
        assertEq(DeployConfig.MIN_MAX_GAP, poc.MIN_MAX_GAP());
        assertEq(DeployConfig.MAX_MAX_GAP, poc.MAX_MAX_GAP());
        assertEq(DeployConfig.MAX_FLAT_BAND_BPS, poc.MAX_FLAT_BAND_BPS());
        assertEq(DeployConfig.MAX_FEEDS_PER_TX, poc.MAX_FEEDS_PER_TX());
        assertEq(DeployConfig.FEED_DECIMALS, new MockAggregatorV3("X").decimals());
    }

    function test_chain_testnetAllowed() public view {
        h.checkChain(TESTNET, _testnetCfg());
    }

    function test_chain_revert_mismatch() public {
        DeployConfig.Config memory c = _testnetCfg();
        vm.expectRevert("DEPLOY: chain id mismatch (POC_EXPECTED_CHAIN_ID vs RPC)");
        h.checkChain(MAINNET, c);
    }

    function testFuzz_chain_revert_anyOtherChain(uint256 chainId) public {
        vm.assume(chainId != TESTNET && chainId != MAINNET);
        DeployConfig.Config memory c = _mainnetCfg();
        c.expectedChainId = chainId;
        vm.expectRevert("DEPLOY: unsupported chain (only QIE testnet 1983, or mainnet 1990 with POC_MAINNET_GO=yes)");
        h.checkChain(chainId, c);
    }

    function test_chain_revert_localAnvilAndOtherEvm() public {
        uint256[4] memory ids = [uint256(31_337), 1, 133, 177];
        for (uint256 i = 0; i < ids.length; ++i) {
            DeployConfig.Config memory c = _testnetCfg();
            c.expectedChainId = ids[i];
            vm.expectRevert(
                "DEPLOY: unsupported chain (only QIE testnet 1983, or mainnet 1990 with POC_MAINNET_GO=yes)"
            );
            h.checkChain(ids[i], c);
        }
    }

    function test_chain_revert_mainnetWithoutFlag() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.mainnetGo = false;
        vm.expectRevert("DEPLOY: mainnet refused (needs POC_MAINNET_GO=yes)");
        h.checkChain(MAINNET, c);
    }

    function test_chain_revert_mainnetInCi() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.inCi = true;
        vm.expectRevert("DEPLOY: mainnet refused in CI");
        h.checkChain(MAINNET, c);
    }

    function test_chain_revert_mainnetWithEnvKey() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.envKey = true;
        vm.expectRevert("DEPLOY: mainnet refused with an env private key (use a keystore or hardware wallet)");
        h.checkChain(MAINNET, c);
    }

    function test_chain_mainnetAllGuardsPassed() public view {
        h.checkChain(MAINNET, _mainnetCfg());
        h.checkParams(MAINNET, _mainnetCfg());
    }

    function test_params_revert_zeroOwner() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.owner = address(0);
        vm.expectRevert("DEPLOY: POC_OWNER missing or zero");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_maxGapOutOfRange() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.maxGap = 59;
        vm.expectRevert("DEPLOY: POC_MAX_GAP out of range");
        h.checkParams(TESTNET, c);
        c.maxGap = 7 days + 1;
        vm.expectRevert("DEPLOY: POC_MAX_GAP out of range");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_flatBandTooWide() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.flatBandBps = 1001;
        vm.expectRevert("DEPLOY: POC_FLAT_BAND_BPS too wide");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_testnetNoMocks() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.mockDescriptions = new string[](0);
        vm.expectRevert("DEPLOY: testnet needs at least one mock feed");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_testnetTooManyMocks() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.mockDescriptions = new string[](9);
        vm.expectRevert("DEPLOY: too many mock feeds");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_testnetEmptyDescription() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.mockDescriptions[1] = "";
        vm.expectRevert("DEPLOY: empty mock description");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_testnetWithRealFeeds() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.feeds = _officialFeeds();
        vm.expectRevert("DEPLOY: POC_FEEDS is mainnet only (testnet has no QIE Oracle)");
        h.checkParams(TESTNET, c);
    }

    function test_params_revert_mainnetMock() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.mockDescriptions = new string[](1);
        c.mockDescriptions[0] = "BTC / USD";
        vm.expectRevert("DEPLOY: mock feeds are never deployed on mainnet");
        h.checkParams(MAINNET, c);
    }

    function test_params_revert_mainnetNoFeeds() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.feeds = new address[](0);
        vm.expectRevert("DEPLOY: mainnet needs POC_FEEDS");
        h.checkParams(MAINNET, c);
    }

    function test_params_revert_mainnetNonQieFeed() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.feeds[3] = makeAddr("lookalike");
        vm.expectRevert("DEPLOY: feed is not an official QIE Oracle feed");
        h.checkParams(MAINNET, c);
    }

    function test_params_revert_mainnetDuplicateFeed() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.feeds[6] = c.feeds[0];
        vm.expectRevert("DEPLOY: duplicate feed");
        h.checkParams(MAINNET, c);
    }

    function testFuzz_isQieMainnetFeed_onlyTheSeven(address f) public view {
        address[] memory off = _officialFeeds();
        bool listed;
        for (uint256 i = 0; i < off.length; ++i) {
            if (off[i] == f) listed = true;
        }
        assertEq(h.isQieMainnetFeed(f), listed);
    }

    function test_chain_revert_buildOverride() public {
        DeployConfig.Config memory c = _testnetCfg();
        c.buildOverride = true;
        vm.expectRevert("DEPLOY: FOUNDRY_*/DAPP_* override set; unset it so foundry.toml decides the build");
        h.checkChain(TESTNET, c);
        c = _mainnetCfg();
        c.buildOverride = true;
        vm.expectRevert("DEPLOY: FOUNDRY_*/DAPP_* override set; unset it so foundry.toml decides the build");
        h.checkChain(MAINNET, c);
    }

    function test_params_revert_mainnetNoExpectedDeployer() public {
        DeployConfig.Config memory c = _mainnetCfg();
        c.expectedDeployer = address(0);
        vm.expectRevert("DEPLOY: mainnet needs POC_EXPECTED_DEPLOYER");
        h.checkParams(MAINNET, c);
    }

    function test_params_mainnetBtcEthOnly() public view {
        DeployConfig.Config memory c = _mainnetCfg();
        c.feeds = _btcEth();
        h.checkParams(MAINNET, c);
        assertTrue(h.isQieMainnetFeed(DeployConfig.QIE_MAINNET_BTC_USD));
        assertTrue(h.isQieMainnetFeed(DeployConfig.QIE_MAINNET_ETH_USD));
    }

    function test_checkBuild_acceptsTheParisBuild() public view {
        h.checkBuild(type(ProofOfCall).runtimeCode);
    }

    function test_checkBuild_skipsPushDataAndMetadata() public view {
        // PUSH1 0x5f, PUSH2 0x5e5d, STOP; then 2 metadata bytes holding Cancun opcode values, then the length 0x0002.
        h.checkBuild(hex"605f615e5d00" hex"5e5f" hex"0002");
    }

    function test_checkBuild_revert_push0() public {
        vm.expectRevert("DEPLOY: PUSH0 in bytecode; build is not evm_version paris");
        h.checkBuild(hex"5f00" hex"aabb" hex"0002");
    }

    function test_checkBuild_revert_transientStorage() public {
        vm.expectRevert("DEPLOY: TLOAD/TSTORE in bytecode (Cancun; not on QIE)");
        h.checkBuild(hex"60015c00" hex"aabb" hex"0002");
        vm.expectRevert("DEPLOY: TLOAD/TSTORE in bytecode (Cancun; not on QIE)");
        h.checkBuild(hex"600160015d00" hex"aabb" hex"0002");
    }

    function test_checkBuild_revert_mcopy() public {
        vm.expectRevert("DEPLOY: MCOPY in bytecode (Cancun; not on QIE)");
        h.checkBuild(hex"5e" hex"aabb" hex"0002");
    }

    function test_checkBuild_revert_blobOpcodes() public {
        vm.expectRevert("DEPLOY: BLOBHASH/BLOBBASEFEE in bytecode (Cancun; not on QIE)");
        h.checkBuild(hex"49" hex"aabb" hex"0002");
        vm.expectRevert("DEPLOY: BLOBHASH/BLOBBASEFEE in bytecode (Cancun; not on QIE)");
        h.checkBuild(hex"4a" hex"aabb" hex"0002");
    }

    function test_checkBuild_revert_malformed() public {
        vm.expectRevert("DEPLOY: empty runtime code");
        h.checkBuild(hex"0002");
        vm.expectRevert("DEPLOY: runtime code has no CBOR metadata");
        h.checkBuild(hex"00ffff");
    }
}

contract DeployScriptTest is DeployTestBase {
    function test_deploy_testnet_deploysAndReadsBack() public {
        vm.chainId(TESTNET);
        DeployConfig.Config memory c = _testnetCfg();
        c.expectedDeployer = deployer;
        (ProofOfCall poc, MockAggregatorV3[] memory mocks) = script.deploy(c, TEST_PK);

        assertEq(poc.owner(), owner);
        assertEq(poc.pendingOwner(), address(0));
        assertEq(poc.defaultMaxGap(), 6 hours);
        assertEq(poc.defaultFlatBandBps(), 10);
        assertEq(mocks.length, 2);
        assertEq(mocks[0].description(), "BTC / USD");
        assertEq(mocks[1].description(), "ETH / USD");
        for (uint256 i = 0; i < mocks.length; ++i) {
            assertEq(mocks[i].admin(), deployer, "mock admin is the deployer");
            assertTrue(poc.isFeedAllowedAt(address(mocks[i]), block.timestamp));
        }
        // Owner can differ from the deployer: the deployer keeps no rights on ProofOfCall.
        assertTrue(poc.owner() != deployer);
    }

    function test_deploy_revert_unsupportedChain() public {
        vm.chainId(31_337);
        DeployConfig.Config memory c = _testnetCfg();
        c.expectedChainId = 31_337;
        vm.expectRevert("DEPLOY: unsupported chain (only QIE testnet 1983, or mainnet 1990 with POC_MAINNET_GO=yes)");
        script.deploy(c, TEST_PK);
    }

    function test_deploy_revert_rpcIsNotTheExpectedChain() public {
        vm.chainId(MAINNET);
        vm.expectRevert("DEPLOY: chain id mismatch (POC_EXPECTED_CHAIN_ID vs RPC)");
        script.deploy(_testnetCfg(), TEST_PK);
    }

    function test_deploy_revert_mainnetWithEnvKeyEvenWithFlag() public {
        vm.chainId(MAINNET);
        vm.expectRevert("DEPLOY: mainnet refused with an env private key (use a keystore or hardware wallet)");
        script.deploy(_mainnetCfg(), TEST_PK);
    }

    function test_deploy_revert_mainnetWithoutFlag() public {
        vm.chainId(MAINNET);
        DeployConfig.Config memory c = _mainnetCfg();
        c.mainnetGo = false;
        vm.expectRevert("DEPLOY: mainnet refused (needs POC_MAINNET_GO=yes)");
        script.deploy(c, 0);
    }

    function test_deploy_revert_mainnetFeedsWithoutCode() public {
        // Local EVM has no code at the QIE Oracle addresses: refuse before any broadcast.
        vm.chainId(MAINNET);
        DeployConfig.Config memory c = _mainnetCfg();
        c.expectedDeployer = deployer;
        vm.prank(deployer);
        vm.expectRevert("DEPLOY: feed has no code on this chain");
        script.deploy(c, 0);
    }

    function test_deploy_revert_mainnetBuildOverride() public {
        vm.chainId(MAINNET);
        DeployConfig.Config memory c = _mainnetCfg();
        c.expectedDeployer = deployer;
        c.buildOverride = true;
        vm.prank(deployer);
        vm.expectRevert("DEPLOY: FOUNDRY_*/DAPP_* override set; unset it so foundry.toml decides the build");
        script.deploy(c, 0);
    }

    function test_deploy_revert_mainnetWrongSigner() public {
        vm.chainId(MAINNET);
        DeployConfig.Config memory c = _mainnetCfg();
        c.expectedDeployer = makeAddr("someone-else");
        vm.prank(deployer);
        vm.expectRevert("DEPLOY: signer is not POC_EXPECTED_DEPLOYER");
        script.deploy(c, 0);
    }

    /// @dev Offline mainnet dry run: chain id 1990, feed code etched at the official QIE Oracle addresses
    ///      (decimals 8), keystore-style signer (no env key), BTC / USDT + ETH / USDT only. Exercises every
    ///      mainnet guard, the deployment itself and the read-back, without any network.
    function test_deploy_mainnet_etchedFeeds_deploysAndReadsBack() public {
        address[] memory feeds = _btcEth();
        for (uint256 i = 0; i < feeds.length; ++i) {
            vm.etch(feeds[i], address(new MockAggregatorV3("feed")).code);
        }
        vm.chainId(MAINNET);
        DeployConfig.Config memory c = _mainnetCfg();
        c.feeds = feeds;
        // No prank (broadcasting refuses it): the test contract is the caller, like --account/--ledger in a real run.
        c.expectedDeployer = address(this);
        c.owner = owner;

        (ProofOfCall poc, MockAggregatorV3[] memory mocks) = script.deploy(c, 0);

        assertEq(mocks.length, 0, "no mock on mainnet");
        assertEq(poc.owner(), owner);
        assertEq(poc.pendingOwner(), address(0));
        assertEq(poc.defaultMaxGap(), 6 hours);
        assertEq(poc.defaultFlatBandBps(), 10);
        for (uint256 i = 0; i < feeds.length; ++i) {
            assertTrue(poc.isFeedAllowedAt(feeds[i], block.timestamp));
        }
        checker.check(
            MAINNET,
            PostDeployCheck.Expect({
                poc: address(poc), owner: owner, maxGap: 6 hours, flatBandBps: 10, feeds: feeds, mockAdmin: address(0)
            })
        );
    }

    function test_deploy_revert_wrongDeployer() public {
        vm.chainId(TESTNET);
        DeployConfig.Config memory c = _testnetCfg();
        c.expectedDeployer = makeAddr("someone-else");
        vm.expectRevert("DEPLOY: signer is not POC_EXPECTED_DEPLOYER");
        script.deploy(c, TEST_PK);
    }

    function test_deploy_revert_noSigner() public {
        vm.chainId(TESTNET);
        DeployConfig.Config memory c = _testnetCfg();
        vm.prank(DEFAULT_SENDER);
        vm.expectRevert("DEPLOY: no signer (use --account, --ledger or DEPLOYER_PRIVATE_KEY)");
        script.deploy(c, 0);
    }

    function test_deploy_revert_badParamsBeforeAnyDeployment() public {
        vm.chainId(TESTNET);
        DeployConfig.Config memory c = _testnetCfg();
        c.maxGap = 0;
        uint64 nonceBefore = vm.getNonce(deployer);
        vm.expectRevert("DEPLOY: POC_MAX_GAP out of range");
        script.deploy(c, TEST_PK);
        assertEq(vm.getNonce(deployer), nonceBefore);
    }
}

contract CheckScriptTest is DeployTestBase {
    ProofOfCall internal poc;
    address[] internal feeds;

    function setUp() public override {
        super.setUp();
        vm.chainId(TESTNET);
        (ProofOfCall p, MockAggregatorV3[] memory mocks) = script.deploy(_testnetCfg(), TEST_PK);
        poc = p;
        for (uint256 i = 0; i < mocks.length; ++i) {
            feeds.push(address(mocks[i]));
        }
    }

    function _expect() internal view returns (PostDeployCheck.Expect memory e) {
        e = PostDeployCheck.Expect({
            poc: address(poc), owner: owner, maxGap: 6 hours, flatBandBps: 10, feeds: feeds, mockAdmin: deployer
        });
    }

    function test_check_passes() public view {
        checker.check(TESTNET, _expect());
    }

    function test_check_revert_chainMismatch() public {
        vm.expectRevert("CHECK: chain id mismatch (POC_EXPECTED_CHAIN_ID vs RPC)");
        checker.check(MAINNET, _expect());
    }

    function test_check_revert_notQie() public {
        vm.chainId(1);
        vm.expectRevert("CHECK: not a QIE chain");
        checker.check(1, _expect());
    }

    function test_check_revert_noCode() public {
        PostDeployCheck.Expect memory e = _expect();
        e.poc = makeAddr("empty");
        vm.expectRevert("CHECK: no contract code at the ProofOfCall address");
        checker.check(TESTNET, e);
    }

    function test_check_revert_wrongOwner() public {
        PostDeployCheck.Expect memory e = _expect();
        e.owner = deployer;
        vm.expectRevert("CHECK: owner mismatch");
        checker.check(TESTNET, e);
    }

    function test_check_revert_pendingOwner() public {
        vm.prank(owner);
        poc.transferOwnership(makeAddr("next"));
        vm.expectRevert("CHECK: a pending owner is set");
        checker.check(TESTNET, _expect());
    }

    function test_check_revert_wrongDefaults() public {
        PostDeployCheck.Expect memory e = _expect();
        e.maxGap = 1 hours;
        vm.expectRevert("CHECK: defaultMaxGap mismatch");
        checker.check(TESTNET, e);
        e = _expect();
        e.flatBandBps = 11;
        vm.expectRevert("CHECK: defaultFlatBandBps mismatch");
        checker.check(TESTNET, e);
    }

    function test_check_revert_feedNotListed() public {
        PostDeployCheck.Expect memory e = _expect();
        e.feeds[1] = address(new MockAggregatorV3("SOL / USD"));
        vm.expectRevert("CHECK: feed not on the allowlist");
        checker.check(TESTNET, e);
    }

    function test_check_revert_feedRetired() public {
        vm.prank(owner);
        poc.retireFeed(feeds[0]);
        vm.expectRevert("CHECK: feed not on the allowlist");
        checker.check(TESTNET, _expect());
    }

    function test_check_revert_noFeeds() public {
        PostDeployCheck.Expect memory e = _expect();
        e.feeds = new address[](0);
        vm.expectRevert("CHECK: no feeds to check");
        checker.check(TESTNET, e);
    }

    function test_check_revert_mockAdminMismatch() public {
        PostDeployCheck.Expect memory e = _expect();
        e.mockAdmin = owner;
        vm.expectRevert("CHECK: mock admin mismatch");
        checker.check(TESTNET, e);
    }

    function test_check_revert_mockOnMainnet() public {
        vm.chainId(MAINNET);
        vm.expectRevert("CHECK: non-QIE feed on mainnet");
        checker.check(MAINNET, _expect());
    }
}

/// @dev The only test that touches process env (vm.setEnv is global), with names only this test uses.
contract DeployEnvTest is DeployTestBase {
    function test_loadConfig_readsEnv() public {
        vm.setEnv("POC_EXPECTED_CHAIN_ID", "1983");
        vm.setEnv("POC_MAINNET_GO", "YES"); // only the exact lowercase "yes" counts
        vm.setEnv("POC_OWNER", vm.toString(owner));
        vm.setEnv("POC_EXPECTED_DEPLOYER", vm.toString(deployer));
        vm.setEnv("POC_MAX_GAP", "21600");
        vm.setEnv("POC_FLAT_BAND_BPS", "10");
        vm.setEnv("POC_MOCK_FEEDS", "BTC / USD,ETH / USD");
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(TEST_PK)));
        (DeployConfig.Config memory c, uint256 pk) = script.loadConfig();
        assertEq(c.expectedChainId, 1983);
        assertFalse(c.mainnetGo);
        assertEq(c.owner, owner);
        assertEq(c.expectedDeployer, deployer);
        assertEq(c.maxGap, 21_600);
        assertEq(c.flatBandBps, 10);
        assertEq(c.mockDescriptions.length, 2);
        assertEq(c.mockDescriptions[1], "ETH / USD");
        assertEq(c.feeds.length, 0);
        assertEq(pk, TEST_PK);
        assertTrue(c.envKey);

        vm.setEnv("POC_MAINNET_GO", "yes");
        (c,) = script.loadConfig();
        assertTrue(c.mainnetGo);

        assertFalse(c.buildOverride);
        vm.setEnv("FOUNDRY_EVM_VERSION", "cancun");
        (c,) = script.loadConfig();
        assertTrue(c.buildOverride);
        vm.setEnv("FOUNDRY_EVM_VERSION", "");
        (c,) = script.loadConfig();
        assertFalse(c.buildOverride);

        vm.setEnv("POC_MAX_GAP", "4294967296");
        vm.expectRevert("DEPLOY: POC_MAX_GAP out of range");
        script.loadConfig();
    }
}
