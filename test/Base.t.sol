// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

abstract contract BaseTest is Test {
    ProofOfCall internal poc;
    MockAggregatorV3 internal btc;
    MockAggregatorV3 internal eth;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice"); // publisher
    address internal bob = makeAddr("bob"); // second publisher / bystander

    uint32 internal constant GAP = 1 hours;
    uint16 internal constant BAND = 10; // 0.10 %
    uint64 internal constant H = 4 hours;
    uint256 internal constant T0 = 1_800_000_000;
    bytes32 internal constant SALT = keccak256("salt");
    bytes32 internal constant ID = keccak256("call-1");

    uint8 internal constant UP = 1;
    uint8 internal constant DOWN = 2;

    function setUp() public virtual {
        vm.warp(T0);
        btc = new MockAggregatorV3("BTC / USD");
        eth = new MockAggregatorV3("ETH / USD");
        address[] memory feeds = new address[](2);
        feeds[0] = address(btc);
        feeds[1] = address(eth);
        poc = new ProofOfCall(owner, GAP, BAND, feeds);
        // Some history before any seal.
        btc.pushRound(60_000e8, T0 - 2 hours);
        btc.pushRound(60_100e8, T0 - 1 hours);
        eth.pushRound(3000e8, T0 - 30 minutes);
        vm.warp(T0 + 1 hours);
    }

    // ------------------------------------------------------------------ helpers

    function _revealBy(uint256 sealedAt, uint64 horizon) internal pure returns (uint64) {
        return uint64(sealedAt + horizon + GAP + 1 hours);
    }

    function _commit(address publisher, bytes32 id, address feed, uint8 dir, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        return poc.computeCommitment(publisher, id, feed, dir, salt);
    }

    /// Seal as `publisher` with the default horizon and the shortest allowed reveal window.
    function _seal(address publisher, bytes32 id, address feed, uint8 dir) internal returns (uint256 sealedAt) {
        sealedAt = block.timestamp;
        bytes32 c = _commit(publisher, id, feed, dir, SALT); // computed before the prank
        vm.prank(publisher);
        poc.seal(id, c, H, _revealBy(sealedAt, H));
    }

    function _reveal(address publisher, bytes32 id, address feed, uint8 dir, uint80 entry, uint80 exit)
        internal
        returns (ProofOfCall.Outcome)
    {
        return poc.reveal(publisher, id, feed, dir, SALT, entry, exit);
    }

    /// Standard scenario on BTC: seal now, entry round 10 minutes later at `p0`, exit round
    /// 5 minutes after the horizon at `p1`. Returns (entryRound, exitRound), warped past the horizon.
    function _scenario(uint8 dir, int256 p0, int256 p1) internal returns (uint80 entryRound, uint80 exitRound) {
        uint256 s = _seal(alice, ID, address(btc), dir);
        entryRound = btc.pushRound(p0, s + 10 minutes);
        btc.pushRound((p0 + p1) / 2, s + 2 hours);
        exitRound = btc.pushRound(p1, s + H + 5 minutes);
        vm.warp(s + H + 10 minutes);
    }
}
