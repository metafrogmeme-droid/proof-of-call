// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";
import {QuirkyFeed, Sender} from "./utils/TestFeeds.sol";

contract ProofOfCallConstructorTest is BaseTest {
    function _feeds1(address a) internal pure returns (address[] memory f) {
        f = new address[](1);
        f[0] = a;
    }

    function test_constructor_setsState() public view {
        assertEq(poc.owner(), owner);
        assertEq(poc.pendingOwner(), address(0));
        assertEq(poc.defaultMaxGap(), GAP);
        assertEq(poc.defaultFlatBandBps(), BAND);
        assertTrue(poc.isFeedAllowedAt(address(btc), block.timestamp));
        assertTrue(poc.isFeedAllowedAt(address(eth), block.timestamp));
        assertEq(poc.feedState(address(btc)).addedAt, T0);
    }

    function test_constructor_revert_zeroOwner() public {
        vm.expectRevert(bytes("POC: zero owner"));
        new ProofOfCall(address(0), GAP, BAND, new address[](0));
    }

    function test_constructor_revert_maxGapTooLow() public {
        vm.expectRevert(bytes("POC: max gap out of range"));
        new ProofOfCall(owner, 59, BAND, new address[](0));
    }

    function test_constructor_revert_maxGapTooHigh() public {
        vm.expectRevert(bytes("POC: max gap out of range"));
        new ProofOfCall(owner, 7 days + 1, BAND, new address[](0));
    }

    function test_constructor_revert_flatBandTooWide() public {
        vm.expectRevert(bytes("POC: flat band too wide"));
        new ProofOfCall(owner, GAP, 1001, new address[](0));
    }

    function test_constructor_revert_tooManyFeeds() public {
        vm.expectRevert(bytes("POC: too many feeds"));
        new ProofOfCall(owner, GAP, BAND, new address[](33));
    }

    function test_constructor_revert_feedHasNoCode() public {
        vm.expectRevert(bytes("POC: feed has no code"));
        new ProofOfCall(owner, GAP, BAND, _feeds1(makeAddr("eoa")));
    }

    function test_constructor_revert_duplicateFeed() public {
        address[] memory f = new address[](2);
        f[0] = address(btc);
        f[1] = address(btc);
        vm.expectRevert(bytes("POC: feed already listed"));
        new ProofOfCall(owner, GAP, BAND, f);
    }

    function test_constructor_boundsInclusive() public {
        ProofOfCall p = new ProofOfCall(owner, 60, 1000, new address[](32 - 32));
        assertEq(p.defaultMaxGap(), 60);
        p = new ProofOfCall(owner, 7 days, 0, new address[](0));
        assertEq(p.defaultMaxGap(), 7 days);
    }
}

contract ProofOfCallAdminTest is BaseTest {
    function _one(address a) internal pure returns (address[] memory f) {
        f = new address[](1);
        f[0] = a;
    }

    function test_addFeeds() public {
        MockAggregatorV3 sol = new MockAggregatorV3("SOL / USD");
        vm.expectEmit(true, false, false, false, address(poc));
        emit ProofOfCall.FeedAdded(address(sol));
        vm.prank(owner);
        poc.addFeeds(_one(address(sol)));
        assertTrue(poc.isFeedAllowedAt(address(sol), block.timestamp));
        assertFalse(poc.isFeedAllowedAt(address(sol), block.timestamp - 1));
    }

    function test_addFeeds_revert_notOwner() public {
        vm.expectRevert(bytes("POC: not owner"));
        vm.prank(alice);
        poc.addFeeds(_one(address(btc)));
    }

    function test_addFeeds_revert_alreadyListed() public {
        vm.expectRevert(bytes("POC: feed already listed"));
        vm.prank(owner);
        poc.addFeeds(_one(address(btc)));
    }

    function test_addFeeds_revert_tooMany() public {
        vm.expectRevert(bytes("POC: too many feeds"));
        vm.prank(owner);
        poc.addFeeds(new address[](33));
    }

    function test_addFeeds_revert_noCode() public {
        vm.expectRevert(bytes("POC: feed has no code"));
        vm.prank(owner);
        poc.addFeeds(_one(address(0)));
    }

    function test_retireFeed() public {
        vm.expectEmit(true, false, false, false, address(poc));
        emit ProofOfCall.FeedRetired(address(btc));
        vm.prank(owner);
        poc.retireFeed(address(btc));
        assertFalse(poc.isFeedAllowedAt(address(btc), block.timestamp));
        assertTrue(poc.isFeedAllowedAt(address(btc), block.timestamp - 1));
    }

    function test_retireFeed_revert_notOwner() public {
        vm.expectRevert(bytes("POC: not owner"));
        vm.prank(alice);
        poc.retireFeed(address(btc));
    }

    function test_retireFeed_revert_notListed() public {
        vm.expectRevert(bytes("POC: feed not listed"));
        vm.prank(owner);
        poc.retireFeed(makeAddr("x"));
    }

    function test_retireFeed_revert_alreadyRetired() public {
        vm.startPrank(owner);
        poc.retireFeed(address(btc));
        vm.expectRevert(bytes("POC: feed already retired"));
        poc.retireFeed(address(btc));
        vm.stopPrank();
    }

    function test_retiredFeed_cannotBeReAdded() public {
        vm.startPrank(owner);
        poc.retireFeed(address(btc));
        vm.expectRevert(bytes("POC: feed already listed"));
        poc.addFeeds(_one(address(btc)));
        vm.stopPrank();
    }

    function test_setDefaults() public {
        vm.expectEmit(false, false, false, true, address(poc));
        emit ProofOfCall.DefaultsUpdated(2 hours, 25);
        vm.prank(owner);
        poc.setDefaults(2 hours, 25);
        assertEq(poc.defaultMaxGap(), 2 hours);
        assertEq(poc.defaultFlatBandBps(), 25);
    }

    function test_setDefaults_revert_notOwner() public {
        vm.expectRevert(bytes("POC: not owner"));
        vm.prank(alice);
        poc.setDefaults(2 hours, 25);
    }

    function test_setDefaults_revert_bounds() public {
        vm.startPrank(owner);
        vm.expectRevert(bytes("POC: max gap out of range"));
        poc.setDefaults(0, 0);
        vm.expectRevert(bytes("POC: max gap out of range"));
        poc.setDefaults(type(uint32).max, 0);
        vm.expectRevert(bytes("POC: flat band too wide"));
        poc.setDefaults(GAP, type(uint16).max);
        vm.stopPrank();
    }

    function test_setDefaults_doesNotChangeSealedCalls() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        vm.prank(owner);
        poc.setDefaults(7 days, 1000);
        ProofOfCall.Call memory c = poc.getCall(alice, ID);
        assertEq(c.maxGap, GAP);
        assertEq(c.flatBandBps, BAND);
        assertEq(c.sealedAt, s);
    }

    function test_twoStepOwnership() public {
        vm.expectEmit(true, true, false, false, address(poc));
        emit ProofOfCall.OwnershipTransferStarted(owner, bob);
        vm.prank(owner);
        poc.transferOwnership(bob);
        assertEq(poc.owner(), owner);
        assertEq(poc.pendingOwner(), bob);

        vm.expectEmit(true, true, false, false, address(poc));
        emit ProofOfCall.OwnershipTransferred(owner, bob);
        vm.prank(bob);
        poc.acceptOwnership();
        assertEq(poc.owner(), bob);
        assertEq(poc.pendingOwner(), address(0));
    }

    function test_transferOwnership_revert_notOwner() public {
        vm.expectRevert(bytes("POC: not owner"));
        vm.prank(alice);
        poc.transferOwnership(alice);
    }

    function test_acceptOwnership_revert_notPending() public {
        vm.prank(owner);
        poc.transferOwnership(bob);
        vm.expectRevert(bytes("POC: not pending owner"));
        vm.prank(alice);
        poc.acceptOwnership();
    }

    function test_acceptOwnership_revert_nothingPending() public {
        vm.expectRevert(bytes("POC: not pending owner"));
        vm.prank(alice);
        poc.acceptOwnership();
    }

    function test_transferOwnership_cancel() public {
        vm.startPrank(owner);
        poc.transferOwnership(bob);
        poc.transferOwnership(address(0));
        vm.stopPrank();
        vm.expectRevert(bytes("POC: not pending owner"));
        vm.prank(bob);
        poc.acceptOwnership();
    }

    function test_renounceOwnership_freezesAdmin() public {
        vm.startPrank(owner);
        poc.transferOwnership(bob);
        poc.renounceOwnership();
        assertEq(poc.owner(), address(0));
        assertEq(poc.pendingOwner(), address(0));
        vm.expectRevert(bytes("POC: not owner"));
        poc.setDefaults(GAP, BAND);
        vm.stopPrank();
        vm.expectRevert(bytes("POC: not pending owner"));
        vm.prank(bob);
        poc.acceptOwnership();
    }

    function test_renounceOwnership_revert_notOwner() public {
        vm.expectRevert(bytes("POC: not owner"));
        vm.prank(alice);
        poc.renounceOwnership();
    }

    function test_publishingWorksWithoutOwner() public {
        vm.prank(owner);
        poc.renounceOwnership();
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }
}

contract ProofOfCallSealTest is BaseTest {
    function test_seal_storesAndEmits() public {
        bytes32 c = _commit(alice, ID, address(btc), UP, SALT);
        uint64 rb = _revealBy(block.timestamp, H);
        vm.expectEmit(true, true, false, true, address(poc));
        emit ProofOfCall.Sealed(alice, ID, c, uint64(block.timestamp), H, rb, GAP, BAND);
        vm.prank(alice);
        poc.seal(ID, c, H, rb);

        ProofOfCall.Call memory s = poc.getCall(alice, ID);
        assertEq(s.commitment, c);
        assertEq(s.sealedAt, block.timestamp);
        assertEq(s.horizon, H);
        assertEq(s.revealBy, rb);
        assertEq(uint8(s.outcome), uint8(ProofOfCall.Outcome.Open));
        assertEq(s.feed, address(0)); // hidden until reveal
        assertEq(s.direction, 0);
        assertEq(poc.scorecard(alice).sealedCalls, 1);
    }

    function test_seal_revert_zeroCommitment() public {
        vm.expectRevert(bytes("POC: zero commitment"));
        vm.prank(alice);
        poc.seal(ID, bytes32(0), H, _revealBy(block.timestamp, H));
    }

    function test_seal_revert_callExists() public {
        _seal(alice, ID, address(btc), UP);
        vm.expectRevert(bytes("POC: call exists"));
        vm.prank(alice);
        poc.seal(ID, keccak256("other"), H, _revealBy(block.timestamp, H));
    }

    function test_seal_revert_callExistsAfterSettlement() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        _reveal(alice, ID, address(btc), UP, e, x);
        vm.expectRevert(bytes("POC: call exists"));
        vm.prank(alice);
        poc.seal(ID, keccak256("again"), H, _revealBy(block.timestamp, H));
    }

    function test_seal_namespacesArePerPublisher() public {
        _seal(alice, ID, address(btc), UP);
        _seal(bob, ID, address(btc), DOWN);
        assertEq(poc.scorecard(alice).sealedCalls, 1);
        assertEq(poc.scorecard(bob).sealedCalls, 1);
        assertTrue(poc.getCall(alice, ID).commitment != poc.getCall(bob, ID).commitment);
    }

    function test_seal_revert_horizonTooShort() public {
        vm.expectRevert(bytes("POC: horizon out of range"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), 5 minutes - 1, _revealBy(block.timestamp, 5 minutes - 1));
    }

    function test_seal_revert_horizonTooLong() public {
        uint64 h = 366 days + 1;
        vm.expectRevert(bytes("POC: horizon out of range"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), h, _revealBy(block.timestamp, h));
    }

    function test_seal_revert_horizonMaxUint() public {
        vm.expectRevert(bytes("POC: horizon out of range"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), type(uint64).max, type(uint64).max);
    }

    function test_seal_horizonBoundsInclusive() public {
        vm.startPrank(alice);
        poc.seal(keccak256("a"), keccak256("c"), 5 minutes, _revealBy(block.timestamp, 5 minutes));
        poc.seal(keccak256("b"), keccak256("c"), 366 days, _revealBy(block.timestamp, 366 days));
        vm.stopPrank();
        assertEq(poc.scorecard(alice).sealedCalls, 2);
    }

    function test_seal_revert_revealWindowTooShort() public {
        uint64 rb = _revealBy(block.timestamp, H) - 1;
        vm.expectRevert(bytes("POC: reveal window too short"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), H, rb);
    }

    function test_seal_revert_revealByZero() public {
        vm.expectRevert(bytes("POC: reveal window too short"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), H, 0);
    }

    function test_seal_revert_revealWindowTooLong() public {
        uint64 rb = uint64(block.timestamp + H + GAP + 30 days + 1);
        vm.expectRevert(bytes("POC: reveal window too long"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), H, rb);
    }

    function test_seal_revert_revealByMaxUint() public {
        vm.expectRevert(bytes("POC: reveal window too long"));
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), H, type(uint64).max);
    }

    function test_seal_longestWindowAccepted() public {
        uint64 rb = uint64(block.timestamp + H + GAP + 30 days);
        vm.prank(alice);
        poc.seal(ID, keccak256("c"), H, rb);
        assertEq(poc.getCall(alice, ID).revealBy, rb);
    }

    function test_seal_revert_withValue() public {
        vm.deal(alice, 1 ether);
        bytes memory data = abi.encodeCall(ProofOfCall.seal, (ID, keccak256("c"), H, _revealBy(block.timestamp, H)));
        vm.prank(alice);
        (bool ok,) = address(poc).call{value: 1}(data);
        assertFalse(ok);
        assertEq(address(poc).balance, 0);
    }
}

contract ProofOfCallRevealTest is BaseTest {
    function test_reveal_hitUp() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectEmit(true, true, true, true, address(poc));
        emit ProofOfCall.Revealed(
            alice, ID, address(btc), UP, ProofOfCall.Outcome.Hit, ProofOfCall.VoidReason.None, e, x, 60_000e8, 61_000e8
        );
        vm.prank(bob); // anyone holding the opening may reveal
        ProofOfCall.Outcome o = _reveal(alice, ID, address(btc), UP, e, x);
        assertEq(uint8(o), uint8(ProofOfCall.Outcome.Hit));

        ProofOfCall.Call memory c = poc.getCall(alice, ID);
        assertEq(uint8(c.outcome), uint8(ProofOfCall.Outcome.Hit));
        assertEq(c.feed, address(btc));
        assertEq(c.direction, UP);
        assertEq(c.entryRound, e);
        assertEq(c.exitRound, x);
        assertEq(c.entryPrice, 60_000e8);
        assertEq(c.exitPrice, 61_000e8);
        assertEq(poc.scorecard(alice).hits, 1);
        assertEq(poc.scorecard(bob).hits, 0);
    }

    function test_reveal_hitDown() public {
        (uint80 e, uint80 x) = _scenario(DOWN, 60_000e8, 59_000e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), DOWN, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_missUp() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 59_000e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Miss));
        assertEq(poc.scorecard(alice).misses, 1);
    }

    function test_reveal_missDown() public {
        (uint80 e, uint80 x) = _scenario(DOWN, 60_000e8, 61_000e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), DOWN, e, x)), uint8(ProofOfCall.Outcome.Miss));
    }

    function test_reveal_flatInsideBand() public {
        // 10 bps of 60_000 = 60. A move of exactly 60 is FLAT, 60 + 1e-8 is not.
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 60_060e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Flat));
        assertEq(poc.scorecard(alice).flats, 1);
    }

    function test_reveal_flatBoundaryDown() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 59_940e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Flat));
    }

    function test_reveal_justOutsideBand() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 60_060e8 + 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_zeroBand_unchangedIsFlat() public {
        vm.prank(owner);
        poc.setDefaults(GAP, 0);
        (uint80 e, uint80 x) = _scenario(DOWN, 60_000e8, 60_000e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), DOWN, e, x)), uint8(ProofOfCall.Outcome.Flat));
    }

    function test_reveal_zeroBand_tinyMoveScores() public {
        vm.prank(owner);
        poc.setDefaults(GAP, 0);
        (uint80 e, uint80 x) = _scenario(DOWN, 60_000e8, 60_000e8 - 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), DOWN, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_atHorizonExactly() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(1e8, s);
        uint80 x = btc.pushRound(2e8, s + H);
        vm.warp(s + H);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_atDeadlineExactly() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.warp(poc.getCall(alice, ID).revealBy);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_extremePricesNoOverflow() public {
        int256 maxA = poc.MAX_ANSWER();
        (uint80 e, uint80 x) = _scenario(DOWN, maxA, 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), DOWN, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_extremePricesUp() public {
        int256 maxA = poc.MAX_ANSWER();
        (uint80 e, uint80 x) = _scenario(UP, 1, maxA);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_sameRoundForEntryAndExit_isVoidWhenGapTooLarge() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 r = btc.pushRound(61_000e8, s + H); // first update after the seal is at the horizon
        vm.warp(s + H + 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, r, r)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.EntryStalled));
    }

    function test_reveal_sameRoundForEntryAndExit_flatWhenShortHorizon() public {
        bytes32 c = _commit(alice, ID, address(btc), UP, SALT);
        uint256 s = block.timestamp;
        vm.prank(alice);
        poc.seal(ID, c, 5 minutes, _revealBy(s, 5 minutes));
        uint80 r = btc.pushRound(61_000e8, s + 10 minutes);
        vm.warp(s + 10 minutes);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, r, r)), uint8(ProofOfCall.Outcome.Flat));
    }

    // ------------------------------------------------------------- void paths

    function test_reveal_void_entryGapTooLarge() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + GAP + 1);
        uint80 x = btc.pushRound(61_000e8, s + H);
        vm.warp(s + H);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        ProofOfCall.Call memory c = poc.getCall(alice, ID);
        assertEq(uint8(c.voidReason), uint8(ProofOfCall.VoidReason.EntryStalled));
        assertEq(c.entryPrice, 0);
        assertEq(c.exitPrice, 0);
        assertEq(poc.scorecard(alice).voids, 1);
    }

    function test_reveal_entryGapAtLimitIsScored() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + GAP);
        uint80 x = btc.pushRound(61_000e8, s + H + GAP);
        vm.warp(s + H + GAP);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_reveal_void_exitGapTooLarge() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1);
        uint80 x = btc.pushRound(61_000e8, s + H + GAP + 1);
        vm.warp(s + H + GAP + 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.ExitStalled));
    }

    function test_reveal_void_entryStallProof() public {
        // No update at all since the seal: latest round (pre-seal) is a valid stall proof.
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 latest = btc.latestRound();
        vm.warp(s + H + GAP + 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, latest, latest)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.EntryStalled));
    }

    function test_reveal_void_exitStallProof() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1 minutes);
        vm.warp(s + H + GAP + 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, e)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.ExitStalled));
    }

    function test_reveal_revert_stallProofTooEarly() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1 minutes);
        vm.warp(s + H + GAP); // not yet strictly past target + maxGap
        vm.expectRevert(bytes("POC: no round after target yet"));
        _reveal(alice, ID, address(btc), UP, e, e);
    }

    function test_reveal_void_entryZeroAnswer() public {
        (uint80 e, uint80 x) = _scenario(UP, 0, 61_000e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.EntryBadData));
    }

    function test_reveal_void_exitNegativeAnswer() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, -1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.ExitBadData));
    }

    function test_reveal_void_answerAboveMax() public {
        int256 tooBig = poc.MAX_ANSWER() + 1;
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, tooBig);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.ExitBadData));
    }

    function test_reveal_void_answerMinInt() public {
        (uint80 e, uint80 x) = _scenario(UP, type(int256).min, 1e8);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.EntryBadData));
    }

    function test_reveal_void_answeredInEarlierRound() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1 minutes);
        btc.setRound(e + 1, 61_000e8, s + H, s + H, e); // carried-over answer
        vm.warp(s + H + 1);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, e + 1)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.ExitBadData));
    }

    function test_reveal_void_updatedAtInFuture() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1 minutes);
        uint80 x = btc.pushRound(61_000e8, s + H + 30 minutes);
        vm.warp(s + H + 1); // the exit round claims a time that has not happened yet
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Void));
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.ExitBadData));
    }

    function test_reveal_entryVoidTakesPrecedence() public {
        (uint80 e, uint80 x) = _scenario(UP, 0, -5);
        _reveal(alice, ID, address(btc), UP, e, x);
        assertEq(uint8(poc.getCall(alice, ID).voidReason), uint8(ProofOfCall.VoidReason.EntryBadData));
    }

    // --------------------------------------------------------- reverts: call state

    function test_reveal_revert_unknownCall() public {
        vm.expectRevert(bytes("POC: unknown call"));
        _reveal(alice, ID, address(btc), UP, 1, 2);
    }

    function test_reveal_revert_unknownCallOtherPublisher() public {
        _seal(alice, ID, address(btc), UP);
        vm.expectRevert(bytes("POC: unknown call"));
        _reveal(bob, ID, address(btc), UP, 1, 2);
    }

    function test_reveal_revert_doubleReveal() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        _reveal(alice, ID, address(btc), UP, e, x);
        vm.expectRevert(bytes("POC: already settled"));
        _reveal(alice, ID, address(btc), UP, e, x);
        assertEq(poc.scorecard(alice).hits, 1);
    }

    function test_reveal_revert_afterExpire() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.warp(poc.getCall(alice, ID).revealBy + 1);
        poc.expire(alice, ID);
        vm.expectRevert(bytes("POC: already settled"));
        _reveal(alice, ID, address(btc), UP, e, x);
    }

    function test_reveal_revert_early() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1);
        vm.warp(s + H - 1);
        vm.expectRevert(bytes("POC: horizon not reached"));
        _reveal(alice, ID, address(btc), UP, e, e);
    }

    function test_reveal_revert_sameBlockAsSeal() public {
        _seal(alice, ID, address(btc), UP);
        vm.expectRevert(bytes("POC: horizon not reached"));
        _reveal(alice, ID, address(btc), UP, 1, 2);
    }

    function test_reveal_revert_windowClosed() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.warp(poc.getCall(alice, ID).revealBy + 1);
        vm.expectRevert(bytes("POC: reveal window closed"));
        _reveal(alice, ID, address(btc), UP, e, x);
    }

    // --------------------------------------------------------- reverts: opening

    function test_reveal_revert_wrongSalt() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: wrong opening"));
        poc.reveal(alice, ID, address(btc), UP, keccak256("bad"), e, x);
    }

    function test_reveal_revert_wrongDirection() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 59_000e8);
        vm.expectRevert(bytes("POC: wrong opening"));
        _reveal(alice, ID, address(btc), DOWN, e, x); // cannot flip a losing call
    }

    function test_reveal_revert_wrongFeed() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: wrong opening"));
        _reveal(alice, ID, address(eth), UP, e, x);
    }

    function test_reveal_revert_openingForOtherPublisher() public {
        bytes32 c = _commit(bob, ID, address(btc), UP, SALT); // alice copies bob's commitment
        vm.prank(alice);
        poc.seal(ID, c, H, _revealBy(block.timestamp, H));
        vm.warp(block.timestamp + H);
        vm.expectRevert(bytes("POC: wrong opening"));
        _reveal(alice, ID, address(btc), UP, 1, 2);
    }

    function test_reveal_revert_badDirection() public {
        bytes32 c = _commit(alice, ID, address(btc), 3, SALT);
        vm.prank(alice);
        poc.seal(ID, c, H, _revealBy(block.timestamp, H));
        vm.warp(block.timestamp + H);
        vm.expectRevert(bytes("POC: bad direction"));
        _reveal(alice, ID, address(btc), 3, 1, 2);
    }

    function test_reveal_revert_directionZero() public {
        bytes32 c = _commit(alice, ID, address(btc), 0, SALT);
        vm.prank(alice);
        poc.seal(ID, c, H, _revealBy(block.timestamp, H));
        vm.warp(block.timestamp + H);
        vm.expectRevert(bytes("POC: bad direction"));
        _reveal(alice, ID, address(btc), 0, 1, 2);
    }

    // --------------------------------------------------------- reverts: feed allowlist

    function test_reveal_revert_feedNotListed() public {
        MockAggregatorV3 rogue = new MockAggregatorV3("ROGUE");
        _seal(alice, ID, address(rogue), UP);
        vm.warp(block.timestamp + H);
        vm.expectRevert(bytes("POC: feed not allowed"));
        _reveal(alice, ID, address(rogue), UP, 1, 2);
    }

    function test_reveal_revert_feedAddedAfterSeal() public {
        MockAggregatorV3 sol = new MockAggregatorV3("SOL");
        _seal(alice, ID, address(sol), UP);
        vm.warp(block.timestamp + 1);
        address[] memory f = new address[](1);
        f[0] = address(sol);
        vm.prank(owner);
        poc.addFeeds(f);
        vm.warp(block.timestamp + H);
        vm.expectRevert(bytes("POC: feed not allowed"));
        _reveal(alice, ID, address(sol), UP, 1, 2);
    }

    function test_reveal_revert_feedRetiredBeforeSeal() public {
        vm.prank(owner);
        poc.retireFeed(address(btc));
        vm.warp(block.timestamp + 1);
        _seal(alice, ID, address(btc), UP);
        vm.warp(block.timestamp + H);
        vm.expectRevert(bytes("POC: feed not allowed"));
        _reveal(alice, ID, address(btc), UP, 1, 2);
    }

    function test_reveal_feedRetiredAfterSealStillWorks() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        vm.warp(s + 1);
        vm.prank(owner);
        poc.retireFeed(address(btc));
        uint80 e = btc.pushRound(60_000e8, s + 2);
        uint80 x = btc.pushRound(61_000e8, s + H);
        vm.warp(s + H);
        assertEq(uint8(_reveal(alice, ID, address(btc), UP, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    // --------------------------------------------------------- reverts: round proofs

    function test_reveal_revert_zeroRound() public {
        (, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: zero round"));
        _reveal(alice, ID, address(btc), UP, 0, x);
    }

    function test_reveal_revert_roundUnreadable() public {
        (uint80 e,) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: round unreadable"));
        _reveal(alice, ID, address(btc), UP, e, 999);
    }

    function test_reveal_revert_feedReverting() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        btc.setReverting(true);
        vm.expectRevert(bytes("POC: round unreadable"));
        _reveal(alice, ID, address(btc), UP, e, x);
    }

    function test_reveal_revert_entryRoundBeforeCommit() public {
        // Round 2 is from before the seal and is not the latest: rejected (no look-back pricing).
        (, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: round before target"));
        _reveal(alice, ID, address(btc), UP, 2, x);
    }

    function test_reveal_revert_exitRoundBeforeHorizon() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: round before target"));
        _reveal(alice, ID, address(btc), UP, e, x - 1);
    }

    function test_reveal_revert_entryNotFirstAfterSeal() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        vm.expectRevert(bytes("POC: not first round after target"));
        _reveal(alice, ID, address(btc), UP, e + 1, x); // a later, more convenient entry price
    }

    function test_reveal_revert_exitNotFirstAfterHorizon() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        btc.pushRound(70_000e8, block.timestamp);
        vm.expectRevert(bytes("POC: not first round after target"));
        _reveal(alice, ID, address(btc), UP, e, x + 1);
    }

    function test_reveal_revert_noExitRoundYet() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint80 e = btc.pushRound(60_000e8, s + 1);
        vm.warp(s + H + 1);
        vm.expectRevert(bytes("POC: no round after target yet"));
        _reveal(alice, ID, address(btc), UP, e, e);
    }

    function test_reveal_revert_previousRoundMissing() public {
        uint256 s = _seal(alice, ID, address(btc), UP);
        btc.setRound(10, 60_000e8, s + 1, s + 1, 10); // gap in round ids: 3..9 missing
        btc.setRound(11, 61_000e8, s + H, s + H, 11);
        vm.warp(s + H);
        vm.expectRevert(bytes("POC: previous round unreadable"));
        _reveal(alice, ID, address(btc), UP, 10, 11);
    }

    function test_reveal_roundOneNeedsNoPredecessor() public {
        MockAggregatorV3 fresh = new MockAggregatorV3("FRESH");
        address[] memory f = new address[](1);
        f[0] = address(fresh);
        vm.prank(owner);
        poc.addFeeds(f);
        uint256 s = _seal(alice, ID, address(fresh), DOWN);
        uint80 e = fresh.pushRound(5e8, s + 1);
        uint80 x = fresh.pushRound(4e8, s + H);
        vm.warp(s + H);
        assertEq(e, 1);
        assertEq(uint8(_reveal(alice, ID, address(fresh), DOWN, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }
}

contract ProofOfCallQuirkyFeedTest is BaseTest {
    QuirkyFeed internal q;
    uint256 internal s;

    function setUp() public override {
        super.setUp();
        q = new QuirkyFeed();
        address[] memory f = new address[](1);
        f[0] = address(q);
        vm.prank(owner);
        poc.addFeeds(f);
        q.set(1, 100e8, block.timestamp - 1);
        s = _seal(alice, ID, address(q), UP);
        q.set(2, 100e8, s + 1);
        q.set(3, 110e8, s + H);
        vm.warp(s + H);
    }

    function test_quirky_happyPath() public {
        assertEq(uint8(_reveal(alice, ID, address(q), UP, 2, 3)), uint8(ProofOfCall.Outcome.Hit));
    }

    function test_quirky_revert_roundIdMismatch() public {
        q.setLieAboutId(2);
        vm.expectRevert(bytes("POC: round id mismatch"));
        _reveal(alice, ID, address(q), UP, 2, 3);
    }

    function test_quirky_revert_previousRoundIdMismatch() public {
        q.setLieAboutId(1);
        vm.expectRevert(bytes("POC: previous round id mismatch"));
        _reveal(alice, ID, address(q), UP, 2, 3);
    }

    function test_quirky_revert_previousRoundReverts() public {
        q.setRevertOn(1);
        vm.expectRevert(bytes("POC: previous round unreadable"));
        _reveal(alice, ID, address(q), UP, 2, 3);
    }

    function test_quirky_revert_latestRoundUnreadable() public {
        q.setLatestReverts(true);
        vm.warp(s + H + GAP + 1);
        vm.expectRevert(bytes("POC: latest round unreadable"));
        _reveal(alice, ID, address(q), UP, 1, 3); // round 1 is pre-seal: needs a latest-round read
    }
}

contract ProofOfCallExpireTest is BaseTest {
    function test_expire_countsAsMiss() public {
        _seal(alice, ID, address(btc), UP);
        uint64 rb = poc.getCall(alice, ID).revealBy;
        vm.warp(uint256(rb) + 1);
        vm.expectEmit(true, true, true, false, address(poc));
        emit ProofOfCall.Expired(alice, ID, bob);
        vm.prank(bob); // anyone
        poc.expire(alice, ID);
        ProofOfCall.Scorecard memory card = poc.scorecard(alice);
        assertEq(card.misses, 1);
        assertEq(card.expiries, 1);
        assertEq(card.hits, 0);
        assertEq(uint8(poc.getCall(alice, ID).outcome), uint8(ProofOfCall.Outcome.Expired));
    }

    function test_expire_revert_unknownCall() public {
        vm.expectRevert(bytes("POC: unknown call"));
        poc.expire(alice, ID);
    }

    function test_expire_revert_windowOpen() public {
        _seal(alice, ID, address(btc), UP);
        vm.warp(poc.getCall(alice, ID).revealBy);
        vm.expectRevert(bytes("POC: reveal window open"));
        poc.expire(alice, ID);
    }

    function test_expire_revert_beforeHorizon() public {
        _seal(alice, ID, address(btc), UP);
        vm.expectRevert(bytes("POC: reveal window open"));
        poc.expire(alice, ID);
    }

    function test_expire_revert_afterReveal() public {
        (uint80 e, uint80 x) = _scenario(UP, 60_000e8, 61_000e8);
        _reveal(alice, ID, address(btc), UP, e, x);
        vm.warp(poc.getCall(alice, ID).revealBy + 1);
        vm.expectRevert(bytes("POC: already settled"));
        poc.expire(alice, ID);
    }

    function test_expire_revert_double() public {
        _seal(alice, ID, address(btc), UP);
        vm.warp(poc.getCall(alice, ID).revealBy + 1);
        poc.expire(alice, ID);
        vm.expectRevert(bytes("POC: already settled"));
        poc.expire(alice, ID);
        assertEq(poc.scorecard(alice).misses, 1);
    }
}

contract ProofOfCallValueAndViewsTest is BaseTest {
    function test_rejectsPlainValue() public {
        Sender snd = new Sender();
        vm.deal(address(snd), 1 ether);
        assertFalse(snd.send(address(poc), 1));
        assertEq(address(poc).balance, 0);
    }

    function test_rejectsUnknownSelector() public {
        (bool ok,) = address(poc).call(hex"deadbeef");
        assertFalse(ok);
    }

    function test_computeCommitment_matchesSpec() public view {
        bytes32 expected = keccak256(abi.encode(block.chainid, address(poc), alice, ID, address(btc), uint8(UP), SALT));
        assertEq(poc.computeCommitment(alice, ID, address(btc), UP, SALT), expected);
    }

    function test_computeCommitment_bindsChainId() public {
        bytes32 a = poc.computeCommitment(alice, ID, address(btc), UP, SALT);
        vm.chainId(1990);
        bytes32 b = poc.computeCommitment(alice, ID, address(btc), UP, SALT);
        assertTrue(a != b);
    }

    function test_computeCommitment_bindsContract() public {
        ProofOfCall other = new ProofOfCall(owner, GAP, BAND, new address[](0));
        assertTrue(
            other.computeCommitment(alice, ID, address(btc), UP, SALT)
                != poc.computeCommitment(alice, ID, address(btc), UP, SALT)
        );
    }

    function test_constants() public view {
        assertEq(poc.UP(), 1);
        assertEq(poc.DOWN(), 2);
        assertEq(poc.BPS(), 10_000);
        assertEq(poc.MIN_HORIZON(), 5 minutes);
        assertEq(poc.MAX_HORIZON(), 366 days);
        assertEq(poc.MIN_REVEAL_WINDOW(), 1 hours);
        assertEq(poc.MAX_REVEAL_WINDOW(), 30 days);
        assertEq(poc.MIN_MAX_GAP(), 1 minutes);
        assertEq(poc.MAX_MAX_GAP(), 7 days);
        assertEq(poc.MAX_FLAT_BAND_BPS(), 1000);
        assertEq(poc.MAX_FEEDS_PER_TX(), 32);
        assertEq(poc.MAX_ANSWER(), int256(type(int128).max));
    }

    function test_isFeedAllowedAt_unknownFeed() public view {
        assertFalse(poc.isFeedAllowedAt(address(0xBEEF), block.timestamp));
    }
}
