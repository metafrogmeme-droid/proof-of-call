// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";
import {DeployConfig} from "./DeployConfig.sol";
import {PostDeployCheck} from "./PostDeployCheck.sol";

/// @title Check
/// @notice Read-only post-deploy check: reads owner, defaults and the feed allowlist back from a live
///         ProofOfCall and reverts on any mismatch. Never broadcasts and needs no key.
///         forge script script/Check.s.sol:Check --rpc-url "$QIE_RPC_URL"
contract Check is Script {
    function run() external view {
        uint256 expected = vm.envUint("POC_EXPECTED_CHAIN_ID");
        check(
            expected,
            PostDeployCheck.Expect({
                poc: vm.envAddress("POC_ADDRESS"),
                owner: vm.envAddress("POC_OWNER"),
                maxGap: _u32(vm.envUint("POC_MAX_GAP")),
                flatBandBps: _u16(vm.envUint("POC_FLAT_BAND_BPS")),
                feeds: vm.envAddress("POC_CHECK_FEEDS", ","),
                mockAdmin: vm.envOr("POC_MOCK_ADMIN", address(0))
            })
        );
    }

    function check(uint256 expectedChainId, PostDeployCheck.Expect memory e) public view {
        require(block.chainid == expectedChainId, "CHECK: chain id mismatch (POC_EXPECTED_CHAIN_ID vs RPC)");
        require(
            block.chainid == DeployConfig.QIE_TESTNET || block.chainid == DeployConfig.QIE_MAINNET,
            "CHECK: not a QIE chain"
        );
        PostDeployCheck.verify(e);
        ProofOfCall poc = ProofOfCall(e.poc);
        console2.log("OK  chain id    ", block.chainid);
        console2.log("OK  ProofOfCall ", e.poc);
        console2.log("OK  owner       ", poc.owner());
        console2.log("OK  maxGap (s)  ", uint256(poc.defaultMaxGap()));
        console2.log("OK  flatBandBps ", uint256(poc.defaultFlatBandBps()));
        console2.log("OK  feeds       ", e.feeds.length);
    }

    function _u32(uint256 v) internal pure returns (uint32) {
        require(v <= type(uint32).max, "CHECK: POC_MAX_GAP out of range");
        return uint32(v);
    }

    function _u16(uint256 v) internal pure returns (uint16) {
        require(v <= type(uint16).max, "CHECK: POC_FLAT_BAND_BPS out of range");
        return uint16(v);
    }
}
