// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ProofOfCall} from "../src/ProofOfCall.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {DeployConfig} from "./DeployConfig.sol";

/// @title PostDeployCheck
/// @notice Read-only checks that a deployed ProofOfCall has exactly the expected owner, defaults and feeds.
///         Used at the end of Deploy.s.sol and by Check.s.sol against a live chain. Reverts on any mismatch.
library PostDeployCheck {
    struct Expect {
        address poc;
        address owner;
        uint32 maxGap;
        uint16 flatBandBps;
        address[] feeds;
        address mockAdmin; // testnet: expected admin of every mock feed; 0 = not checked
    }

    function verify(Expect memory e) internal view {
        require(e.poc.code.length != 0, "CHECK: no contract code at the ProofOfCall address");
        ProofOfCall poc = ProofOfCall(e.poc);
        require(poc.owner() == e.owner, "CHECK: owner mismatch");
        require(poc.pendingOwner() == address(0), "CHECK: a pending owner is set");
        require(poc.defaultMaxGap() == e.maxGap, "CHECK: defaultMaxGap mismatch");
        require(poc.defaultFlatBandBps() == e.flatBandBps, "CHECK: defaultFlatBandBps mismatch");
        require(e.feeds.length != 0, "CHECK: no feeds to check");
        for (uint256 i = 0; i < e.feeds.length; ++i) {
            address f = e.feeds[i];
            ProofOfCall.FeedState memory s = poc.feedState(f);
            require(s.addedAt != 0 && s.retiredAt == 0, "CHECK: feed not on the allowlist");
            require(poc.isFeedAllowedAt(f, block.timestamp), "CHECK: feed not allowed now");
            require(f.code.length != 0, "CHECK: feed has no code");
            require(IAggregatorV3(f).decimals() == DeployConfig.FEED_DECIMALS, "CHECK: feed decimals != 8");
            if (block.chainid == DeployConfig.QIE_MAINNET) {
                require(DeployConfig.isQieMainnetFeed(f), "CHECK: non-QIE feed on mainnet");
            } else if (e.mockAdmin != address(0)) {
                require(MockAggregatorV3(f).admin() == e.mockAdmin, "CHECK: mock admin mismatch");
            }
        }
    }
}
