// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

/// @dev Drives random seal / feed-update / reveal / expire / time sequences across three publishers.
contract Handler is Test {
    ProofOfCall public immutable poc;
    MockAggregatorV3 public immutable feed;

    address[3] internal publishers = [address(0xA11CE), address(0xB0B), address(0xCA401)];
    bytes32 internal constant SALT = keccak256("inv-salt");

    struct Ghost {
        address publisher;
        bytes32 id;
        uint8 dir;
    }

    Ghost[] public ghosts;
    mapping(address => uint256) public ghostSealed;
    mapping(address => uint256) public ghostSettled;
    uint256 public settleEvents;

    constructor(ProofOfCall poc_) {
        poc = poc_;
        feed = new MockAggregatorV3("BTC / USD"); // the handler administers its own feed
        feed.pushRound(60_000e8, block.timestamp);
    }

    function ghostCount() external view returns (uint256) {
        return ghosts.length;
    }

    function publisherAt(uint256 i) external view returns (address) {
        return publishers[i];
    }

    function seal(uint256 who, uint8 dir, uint64 horizon) external {
        address p = publishers[who % 3];
        dir = uint8(bound(dir, 1, 2));
        horizon = uint64(bound(horizon, 5 minutes, 12 hours));
        bytes32 id = keccak256(abi.encode(ghosts.length));
        bytes32 c = poc.computeCommitment(p, id, address(feed), dir, SALT);
        uint64 rb = uint64(block.timestamp + horizon + poc.defaultMaxGap() + 1 hours);
        vm.prank(p);
        poc.seal(id, c, horizon, rb);
        ghosts.push(Ghost(p, id, dir));
        ghostSealed[p]++;
    }

    function tick(uint256 dt, int256 price, bool update) external {
        dt = bound(dt, 1, 3 hours);
        vm.warp(block.timestamp + dt);
        if (update) feed.pushRound(bound(price, 1, 1e14), block.timestamp);
    }

    function revealOne(uint256 idx) external {
        if (ghosts.length == 0) return;
        Ghost memory g = ghosts[idx % ghosts.length];
        ProofOfCall.Call memory c = poc.getCall(g.publisher, g.id);
        if (c.outcome != ProofOfCall.Outcome.Open) return;
        (uint80 e, bool okE) = _find(c.sealedAt);
        (uint80 x, bool okX) = _find(uint256(c.sealedAt) + c.horizon);
        if (!okE || !okX) return;
        try poc.reveal(g.publisher, g.id, address(feed), g.dir, SALT, e, x) {
            ghostSettled[g.publisher]++;
            settleEvents++;
        } catch {}
    }

    function expireOne(uint256 idx) external {
        if (ghosts.length == 0) return;
        Ghost memory g = ghosts[idx % ghosts.length];
        try poc.expire(g.publisher, g.id) {
            ghostSettled[g.publisher]++;
            settleEvents++;
        } catch {}
    }

    /// First round with updatedAt >= t, else the latest round (a stall proof candidate).
    function _find(uint256 t) internal view returns (uint80, bool) {
        uint80 latest = feed.latestRound();
        if (latest == 0) return (0, false);
        for (uint80 r = 1; r <= latest; ++r) {
            (,,, uint256 u,) = feed.getRoundData(r);
            if (u >= t) return (r, true);
        }
        return (latest, true);
    }
}

contract ProofOfCallInvariantTest is Test {
    ProofOfCall internal poc;
    MockAggregatorV3 internal feed;
    Handler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        poc = new ProofOfCall(address(this), 1 hours, 10, new address[](0));
        handler = new Handler(poc);
        feed = handler.feed();
        address[] memory feeds = new address[](1);
        feeds[0] = address(feed);
        poc.addFeeds(feeds);
        vm.warp(block.timestamp + 1); // seals must come after the feed was listed

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = Handler.seal.selector;
        selectors[1] = Handler.tick.selector;
        selectors[2] = Handler.revealOne.selector;
        selectors[3] = Handler.expireOne.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// Every sealed call is either open or in exactly one outcome bucket.
    function invariant_countersAddUp() public view {
        uint256 open;
        uint256 n = handler.ghostCount();
        for (uint256 i = 0; i < n; ++i) {
            (address p, bytes32 id,) = handler.ghosts(i);
            if (poc.getCall(p, id).outcome == ProofOfCall.Outcome.Open) open++;
        }
        uint256 totalSealed;
        uint256 settled;
        for (uint256 i = 0; i < 3; ++i) {
            ProofOfCall.Scorecard memory c = poc.scorecard(handler.publisherAt(i));
            totalSealed += c.sealedCalls;
            settled += uint256(c.hits) + c.misses + c.flats + c.voids;
            assertLe(c.expiries, c.misses);
            assertEq(c.sealedCalls, handler.ghostSealed(handler.publisherAt(i)));
            assertEq(uint256(c.hits) + c.misses + c.flats + c.voids, handler.ghostSettled(handler.publisherAt(i)));
        }
        assertEq(totalSealed, n);
        assertEq(totalSealed, open + settled);
    }

    /// Settling happens at most once per call (no double counting).
    function invariant_settledAtMostOnce() public view {
        assertLe(handler.settleEvents(), handler.ghostCount());
    }

    function invariant_holdsNoValue() public view {
        assertEq(address(poc).balance, 0);
    }
}
