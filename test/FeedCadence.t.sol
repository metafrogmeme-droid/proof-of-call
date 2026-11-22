// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FeedCadence} from "../script/FeedCadence.s.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {QuirkyFeed} from "./utils/TestFeeds.sol";

contract FeedCadenceTest is Test {
    FeedCadence internal cadence;
    MockAggregatorV3 internal feed;
    uint256 internal constant T0 = 1_800_000_000;

    function setUp() public {
        cadence = new FeedCadence();
        feed = new MockAggregatorV3("BTC / USD");
        vm.warp(T0);
    }

    function _push(uint256 at) internal {
        feed.pushRound(100e8, at);
    }

    function test_measure_regularFeed() public {
        // Updates at T0-6000, -5400 (+600), -4200 (+1200), -600 (+3600), -300 (+300).
        _push(T0 - 6000);
        _push(T0 - 5400);
        _push(T0 - 4200);
        _push(T0 - 600);
        _push(T0 - 300);
        FeedCadence.Stats memory s = cadence.measure(address(feed), 96);
        assertEq(s.decimals, 8);
        assertEq(s.latestRound, 5);
        assertEq(s.sampled, 5);
        assertEq(s.gaps, 4);
        assertEq(s.minGap, 300);
        assertEq(s.maxGap, 3600);
        assertEq(s.medianGap, 900); // (600 + 1200) / 2
        assertEq(s.meanGap, 1425);
        assertEq(s.sinceLatest, 300);
        assertTrue(s.plainIds && s.monotonic && s.answered && s.complete);
        assertEq(s.recommendedMaxGap, 5400); // 1.5 x 3600
    }

    function test_measure_samplesOnlyTheRequestedRecentRounds() public {
        _push(T0 - 100_000); // old big gap, outside the sample
        _push(T0 - 1200);
        _push(T0 - 900);
        _push(T0 - 600);
        FeedCadence.Stats memory s = cadence.measure(address(feed), 3);
        assertEq(s.sampled, 3);
        assertEq(s.maxGap, 300);
        assertEq(s.medianGap, 300);
        assertEq(s.recommendedMaxGap, 1 hours); // floor of 1 h
    }

    function test_measure_currentSilenceCounts() public {
        _push(T0 - 10 hours);
        _push(T0 - 9 hours);
        FeedCadence.Stats memory s = cadence.measure(address(feed), 10);
        assertEq(s.maxGap, 1 hours);
        assertEq(s.sinceLatest, 9 hours);
        assertEq(s.recommendedMaxGap, 13.5 hours);
    }

    function test_measure_emptyFeed() public view {
        FeedCadence.Stats memory s = cadence.measure(address(feed), 10);
        assertEq(s.latestRound, 0);
        assertEq(s.sampled, 0);
        assertFalse(s.complete);
        assertEq(s.recommendedMaxGap, 0);
    }

    function test_measure_flagsPhaseIdsAndCarriedAnswers() public {
        uint80 phased = (uint80(1) << 64) + 2;
        feed.setRound(phased - 1, 1e8, T0 - 600, T0 - 600, phased - 1);
        feed.setRound(phased, 1e8, T0 - 300, T0 - 300, phased - 1); // answered in an earlier round
        FeedCadence.Stats memory s = cadence.measure(address(feed), 2);
        assertFalse(s.plainIds);
        assertFalse(s.answered);
        assertTrue(s.monotonic);
        assertEq(s.maxGap, 300);
    }

    function test_measure_flagsTimeGoingBackwards() public {
        feed.setRound(1, 1e8, T0 - 100, T0 - 100, 1);
        feed.setRound(2, 1e8, T0 - 500, T0 - 500, 2);
        FeedCadence.Stats memory s = cadence.measure(address(feed), 2);
        assertFalse(s.monotonic);
        assertEq(s.gaps, 0);
        assertEq(s.minGap, 0);
    }

    function test_measure_stopsAtAnUnreadableRound() public {
        QuirkyFeed q = new QuirkyFeed();
        q.set(1, 1e8, T0 - 900);
        q.set(2, 1e8, T0 - 600);
        q.set(3, 1e8, T0 - 300);
        q.setRevertOn(1);
        FeedCadence.Stats memory s = cadence.measure(address(q), 3);
        assertEq(s.sampled, 2);
        assertFalse(s.complete);
        assertEq(s.maxGap, 300);
    }

    function test_measure_revert_noCode() public {
        vm.expectRevert("CADENCE: feed has no code on this chain");
        cadence.measure(address(0xBEEF), 2);
    }

    function test_recommendMaxGap_bounds() public view {
        assertEq(cadence.recommendMaxGap(0), 1 hours);
        assertEq(cadence.recommendMaxGap(1), 1 hours);
        assertEq(cadence.recommendMaxGap(2 hours), 3 hours);
        assertEq(cadence.recommendMaxGap(2 hours + 1), 3 hours + 15 minutes);
        assertEq(cadence.recommendMaxGap(6 days), 7 days);
        assertEq(cadence.recommendMaxGap(type(uint256).max), 7 days);
    }

    function testFuzz_recommendMaxGap_withinContractBounds(uint256 g) public view {
        uint32 r = cadence.recommendMaxGap(g);
        assertGe(r, 1 hours);
        assertLe(r, 7 days);
        assertEq(r % 15 minutes, 0);
        if (g <= 4 days) assertGe(uint256(r), g + g / 2);
    }
}
