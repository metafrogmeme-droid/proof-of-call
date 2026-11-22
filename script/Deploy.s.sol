// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {DeployConfig} from "./DeployConfig.sol";
import {PostDeployCheck} from "./PostDeployCheck.sol";

/// @title Deploy
/// @notice Deploys MockAggregatorV3 feed(s) and ProofOfCall on QIE testnet (chain 1983).
///         Any other chain is refused; QIE mainnet (1990) only with POC_MAINNET_GO=yes, outside CI, with a
///         keystore or hardware wallet, and only with official QIE Oracle feeds (never a mock).
///         Run it through script/deploy.sh, which checks eth_chainId and simulates before any broadcast.
/// @dev    Keys: Foundry keystore (--account) or hardware wallet (--ledger) recommended. DEPLOYER_PRIVATE_KEY
///         from the shell env is accepted on testnet only. Keys are never read from or written to files here.
contract Deploy is Script {
    function run() external returns (ProofOfCall poc, MockAggregatorV3[] memory mocks) {
        (DeployConfig.Config memory c, uint256 pk) = loadConfig();
        return deploy(c, pk);
    }

    /// @notice Reads the configuration from the environment (see .env.example). Never logs the key.
    function loadConfig() public view returns (DeployConfig.Config memory c, uint256 pk) {
        c.expectedChainId = vm.envUint("POC_EXPECTED_CHAIN_ID");
        c.mainnetGo = keccak256(bytes(vm.envOr("POC_MAINNET_GO", string("")))) == keccak256("yes");
        c.inCi = bytes(vm.envOr("CI", string(""))).length != 0;
        pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        c.envKey = pk != 0;
        c.owner = vm.envAddress("POC_OWNER");
        c.expectedDeployer = vm.envOr("POC_EXPECTED_DEPLOYER", address(0));
        uint256 gap = vm.envUint("POC_MAX_GAP");
        require(gap <= type(uint32).max, "DEPLOY: POC_MAX_GAP out of range");
        c.maxGap = uint32(gap);
        uint256 band = vm.envUint("POC_FLAT_BAND_BPS");
        require(band <= type(uint16).max, "DEPLOY: POC_FLAT_BAND_BPS too wide");
        c.flatBandBps = uint16(band);
        c.mockDescriptions = vm.envOr("POC_MOCK_FEEDS", ",", new string[](0));
        c.feeds = vm.envOr("POC_FEEDS", ",", new address[](0));
        c.buildOverride = buildOverrideSet();
    }

    /// @notice True if any Foundry/dapptools variable that changes the compiled bytecode or the sender is set.
    ///         script/deploy.sh and script/deploy-mainnet.ps1 refuse every FOUNDRY_*/DAPP_* variable; this list is
    ///         the backstop when forge is run by hand. FOUNDRY_PROFILE is not listed: foundry.toml's profiles only
    ///         change fuzz and invariant settings.
    function buildOverrideSet() public view returns (bool) {
        string[16] memory names = [
            "FOUNDRY_EVM_VERSION",
            "FOUNDRY_SOLC",
            "FOUNDRY_SOLC_VERSION",
            "FOUNDRY_OPTIMIZER",
            "FOUNDRY_OPTIMIZER_RUNS",
            "FOUNDRY_VIA_IR",
            "FOUNDRY_BYTECODE_HASH",
            "FOUNDRY_CBOR_METADATA",
            "FOUNDRY_SRC",
            "FOUNDRY_LIBS",
            "FOUNDRY_REMAPPINGS",
            "FOUNDRY_LIBRARIES",
            "FOUNDRY_SENDER",
            "DAPP_SOLC_VERSION",
            "DAPP_BUILD_OPTIMIZE",
            "DAPP_BUILD_OPTIMIZE_RUNS"
        ];
        for (uint256 i = 0; i < names.length; ++i) {
            if (bytes(vm.envOr(names[i], string(""))).length != 0) return true;
        }
        return false;
    }

    /// @notice All guards, then the deployment, then a read-back of what was deployed.
    /// @param pk Private key from the env (testnet only), or 0 to use the --account / --ledger signer.
    function deploy(DeployConfig.Config memory c, uint256 pk)
        public
        returns (ProofOfCall poc, MockAggregatorV3[] memory mocks)
    {
        uint256 chainId = block.chainid;
        c.envKey = c.envKey || pk != 0;
        DeployConfig.checkChain(chainId, c);
        DeployConfig.checkParams(chainId, c);

        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        require(deployer != DEFAULT_SENDER, "DEPLOY: no signer (use --account, --ledger or DEPLOYER_PRIVATE_KEY)");
        if (c.expectedDeployer != address(0)) {
            require(deployer == c.expectedDeployer, "DEPLOY: signer is not POC_EXPECTED_DEPLOYER");
        }
        if (chainId == DeployConfig.QIE_MAINNET) {
            for (uint256 i = 0; i < c.feeds.length; ++i) {
                require(c.feeds[i].code.length != 0, "DEPLOY: feed has no code on this chain");
            }
        }
        DeployConfig.checkBuild(type(ProofOfCall).runtimeCode);

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();

        address[] memory feeds;
        if (chainId == DeployConfig.QIE_TESTNET) {
            mocks = new MockAggregatorV3[](c.mockDescriptions.length);
            feeds = new address[](mocks.length);
            for (uint256 i = 0; i < mocks.length; ++i) {
                mocks[i] = new MockAggregatorV3(c.mockDescriptions[i]);
                feeds[i] = address(mocks[i]);
            }
        } else {
            feeds = c.feeds;
        }
        poc = new ProofOfCall(c.owner, c.maxGap, c.flatBandBps, feeds);

        vm.stopBroadcast();

        PostDeployCheck.verify(
            PostDeployCheck.Expect({
                poc: address(poc),
                owner: c.owner,
                maxGap: c.maxGap,
                flatBandBps: c.flatBandBps,
                feeds: feeds,
                mockAdmin: chainId == DeployConfig.QIE_TESTNET ? deployer : address(0)
            })
        );

        string memory ex = DeployConfig.explorer(chainId);
        console2.log("chain id        ", chainId);
        console2.log("deployer        ", deployer);
        console2.log("owner           ", c.owner);
        console2.log("ProofOfCall     ", address(poc));
        console2.log("  explorer      ", string.concat(ex, "/address/", vm.toString(address(poc))));
        for (uint256 i = 0; i < mocks.length; ++i) {
            console2.log("MockAggregatorV3", address(mocks[i]), c.mockDescriptions[i]);
        }
        console2.log("POC_CHECK_FEEDS ", _join(feeds));
    }

    function _join(address[] memory a) internal pure returns (string memory s) {
        for (uint256 i = 0; i < a.length; ++i) {
            s = i == 0 ? vm.toString(a[i]) : string.concat(s, ",", vm.toString(a[i]));
        }
    }
}
