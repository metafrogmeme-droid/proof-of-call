// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title DeployConfig
/// @notice Pure rules shared by the deploy and check scripts: which chains are allowed, what a valid
///         configuration looks like, and the official QIE Oracle feeds. No state, no keys.
library DeployConfig {
    /// @dev QIE testnet, docs.qie.digital "Access Mainnet or Testnet"; eth_chainId 0x7bf.
    uint256 internal constant QIE_TESTNET = 1983;
    /// @dev QIE mainnet, same page; eth_chainId 0x7c6.
    uint256 internal constant QIE_MAINNET = 1990;

    uint256 internal constant MAX_MOCKS = 8;
    uint8 internal constant FEED_DECIMALS = 8;

    // Mirrors of the ProofOfCall bounds (Solidity cannot read another contract's constants here).
    // test/Deploy.t.sol asserts they stay equal to the contract's values.
    uint32 internal constant MIN_MAX_GAP = 1 minutes;
    uint32 internal constant MAX_MAX_GAP = 7 days;
    uint16 internal constant MAX_FLAT_BAND_BPS = 1000;
    uint256 internal constant MAX_FEEDS_PER_TX = 32;

    struct Config {
        uint256 expectedChainId; // POC_EXPECTED_CHAIN_ID, must equal block.chainid
        bool mainnetGo; // POC_MAINNET_GO == "yes"
        bool inCi; // CI is set to anything
        bool envKey; // DEPLOYER_PRIVATE_KEY was used (testnet only)
        address owner; // POC_OWNER
        address expectedDeployer; // POC_EXPECTED_DEPLOYER, optional (0 = not checked)
        uint32 maxGap; // POC_MAX_GAP (seconds)
        uint16 flatBandBps; // POC_FLAT_BAND_BPS
        string[] mockDescriptions; // POC_MOCK_FEEDS, testnet only
        address[] feeds; // POC_FEEDS, mainnet only (official QIE Oracle feeds)
    }

    /// @notice Reverts unless `chainId` is QIE testnet, or QIE mainnet with every mainnet guard passed.
    function checkChain(uint256 chainId, Config memory c) internal pure {
        require(c.expectedChainId == chainId, "DEPLOY: chain id mismatch (POC_EXPECTED_CHAIN_ID vs RPC)");
        if (chainId == QIE_TESTNET) return;
        if (chainId == QIE_MAINNET) {
            require(c.mainnetGo, "DEPLOY: mainnet refused (needs POC_MAINNET_GO=yes)");
            require(!c.inCi, "DEPLOY: mainnet refused in CI");
            require(!c.envKey, "DEPLOY: mainnet refused with an env private key (use a keystore or hardware wallet)");
            return;
        }
        revert("DEPLOY: unsupported chain (only QIE testnet 1983, or mainnet 1990 with POC_MAINNET_GO=yes)");
    }

    /// @notice Reverts on any configuration the contract would reject, or that is unsafe for the chain.
    function checkParams(uint256 chainId, Config memory c) internal pure {
        require(c.owner != address(0), "DEPLOY: POC_OWNER missing or zero");
        require(c.maxGap >= MIN_MAX_GAP && c.maxGap <= MAX_MAX_GAP, "DEPLOY: POC_MAX_GAP out of range");
        require(c.flatBandBps <= MAX_FLAT_BAND_BPS, "DEPLOY: POC_FLAT_BAND_BPS too wide");
        if (chainId == QIE_TESTNET) {
            require(c.mockDescriptions.length >= 1, "DEPLOY: testnet needs at least one mock feed");
            require(c.mockDescriptions.length <= MAX_MOCKS, "DEPLOY: too many mock feeds");
            require(c.feeds.length == 0, "DEPLOY: POC_FEEDS is mainnet only (testnet has no QIE Oracle)");
            for (uint256 i = 0; i < c.mockDescriptions.length; ++i) {
                require(bytes(c.mockDescriptions[i]).length != 0, "DEPLOY: empty mock description");
            }
        } else {
            require(c.mockDescriptions.length == 0, "DEPLOY: mock feeds are never deployed on mainnet");
            require(c.feeds.length >= 1, "DEPLOY: mainnet needs POC_FEEDS");
            require(c.feeds.length <= MAX_FEEDS_PER_TX, "DEPLOY: too many feeds");
            for (uint256 i = 0; i < c.feeds.length; ++i) {
                require(isQieMainnetFeed(c.feeds[i]), "DEPLOY: feed is not an official QIE Oracle feed");
                for (uint256 j = 0; j < i; ++j) {
                    require(c.feeds[i] != c.feeds[j], "DEPLOY: duplicate feed");
                }
            }
        }
    }

    /// @notice The official QIE Oracle feeds on QIE mainnet (docs.qie.digital, "Table of Assets -> Contract Mapping").
    function isQieMainnetFeed(address feed) internal pure returns (bool) {
        return feed == 0x9E596d809a20A272c788726f592c0d1629755440 // BTC
            || feed == 0x4bb7012Fbc79fE4Ae9B664228977b442b385500d // ETH
            || feed == 0x804582B1f8Fea73919e7c737115009f668f97528 // XRP
            || feed == 0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21 // SOL
            || feed == 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17 // QIE
            || feed == 0x9aD0199a67588ee293187d26bA1BE61cb07A214c // XAUt
            || feed == 0x775A56117Fdb8b31877E75Ceeb68C96765b031e6; // BNB
    }

    function explorer(uint256 chainId) internal pure returns (string memory) {
        if (chainId == QIE_TESTNET) return "https://testnet.qie.digital";
        if (chainId == QIE_MAINNET) return "https://mainnet.qie.digital";
        return "";
    }
}
