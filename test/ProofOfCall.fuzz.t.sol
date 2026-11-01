// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {ProofOfCall} from "../src/ProofOfCall.sol";

contract ProofOfCallFuzzTest is BaseTest {
    // ------------------------------------------------------------------ commit

    /// Any change to any opening field must be rejected.
    function testFuzz_commitment_bindsEveryField(
        bytes32 id,
        bytes32 salt,
        uint8 dir,
        bytes32 otherSalt,
        bytes32 otherId,
        address otherFeed,
        uint8 otherDir,
        uint8 which
    ) public {
        dir = uint8(bound(dir, 1, 2));
        bytes32 c = poc.computeCommitment(alice, id, address(btc), dir, salt);
        which = uint8(bound(which, 0, 4));
        bytes32 altered;
        if (which == 0) {
            vm.assume(otherSalt != salt);
            altered = poc.computeCommitment(alice, id, address(btc), dir, otherSalt);
        } else if (which == 1) {
            vm.assume(otherId != id);
            altered = poc.computeCommitment(alice, otherId, address(btc), dir, salt);
        } else if (which == 2) {
            vm.assume(otherFeed != address(btc));
            altered = poc.computeCommitment(alice, id, otherFeed, dir, salt);
        } else if (which == 3) {
            vm.assume(otherDir != dir);
            altered = poc.computeCommitment(alice, id, address(btc), otherDir, salt);
        } else {
            altered = poc.computeCommitment(bob, id, address(btc), dir, salt);
        }
        assertTrue(altered != c);
    }

    /// A sealed call only opens with its exact salt.
    function testFuzz_reveal_wrongSaltReverts(bytes32 salt, bytes32 wrong) public {
        vm.assume(salt != wrong);
        uint256 s = block.timestamp;
        bytes32 c = poc.computeCommitment(alice, ID, address(btc), UP, salt);
        vm.prank(alice);
        poc.seal(ID, c, H, _revealBy(s, H));
        uint80 e = btc.pushRound(1e8, s + 1);
        uint80 x = btc.pushRound(2e8, s + H);
        vm.warp(s + H);
        vm.expectRevert(bytes("POC: wrong opening"));
        poc.reveal(alice, ID, address(btc), UP, wrong, e, x);
        // and the right salt still works afterwards
        assertEq(uint8(poc.reveal(alice, ID, address(btc), UP, salt, e, x)), uint8(ProofOfCall.Outcome.Hit));
    }

    /// Seal accepts exactly the documented horizon / window ranges.
    function testFuzz_seal_bounds(uint64 horizon, uint64 revealBy) public {
        uint256 target = block.timestamp + uint256(horizon);
        bool horizonOk = horizon >= 5 minutes && horizon <= 366 days;
        vm.prank(alice);
        if (!horizonOk) {
            vm.expectRevert(bytes("POC: horizon out of range"));
            poc.seal(ID, keccak256("c"), horizon, revealBy);
            return;
        }
        if (uint256(revealBy) < target + GAP + 1 hours) {
            vm.expectRevert(bytes("POC: reveal window too short"));
            poc.seal(ID, keccak256("c"), horizon, revealBy);
            return;
        }
        if (uint256(revealBy) > target + GAP + 30 days) {
            vm.expectRevert(bytes("POC: reveal window too long"));
            poc.seal(ID, keccak256("c"), horizon, revealBy);
            return;
        }
        poc.seal(ID, keccak256("c"), horizon, revealBy);
        assertEq(poc.getCall(alice, ID).revealBy, revealBy);
    }

    // ------------------------------------------------------------------ timing

    /// Reveal works exactly inside [sealedAt + horizon, revealBy]; expire exactly after revealBy.
    function testFuzz_revealAndExpireTiming(uint64 horizon, uint256 extraWindow, uint256 when) public {
        horizon = uint64(bound(horizon, 5 minutes, 30 days));
        extraWindow = bound(extraWindow, 0, 30 days - 1 hours);
        uint256 s = block.timestamp;
        uint64 rb = uint64(s + horizon + GAP + 1 hours + extraWindow);
        bytes32 c = poc.computeCommitment(alice, ID, address(btc), UP, SALT);
        vm.prank(alice);
        poc.seal(ID, c, horizon, rb);
        uint80 e = btc.pushRound(1e8, s);
        uint80 x = btc.pushRound(2e8, s + horizon);

        when = bound(when, s, uint256(rb) + 10 days);
        vm.warp(when);
        if (when < s + horizon) {
            vm.expectRevert(bytes("POC: horizon not reached"));
            poc.reveal(alice, ID, address(btc), UP, SALT, e, x);
            vm.expectRevert(bytes("POC: reveal window open"));
            poc.expire(alice, ID);
        } else if (when <= rb) {
            vm.expectRevert(bytes("POC: reveal window open"));
            poc.expire(alice, ID);
            assertEq(uint8(poc.reveal(alice, ID, address(btc), UP, SALT, e, x)), uint8(ProofOfCall.Outcome.Hit));
        } else {
            vm.expectRevert(bytes("POC: reveal window closed"));
            poc.reveal(alice, ID, address(btc), UP, SALT, e, x);
            poc.expire(alice, ID);
            assertEq(poc.scorecard(alice).misses, 1);
        }
    }

    // ------------------------------------------------------------------ score

    function _reference(uint8 dir, uint256 p0, uint256 p1, uint256 band) internal pure returns (ProofOfCall.Outcome) {
        uint256 move = p1 > p0 ? p1 - p0 : p0 - p1;
        // move / p0 <= band / 10_000, evaluated without division
        if (move * 10_000 <= p0 * band) return ProofOfCall.Outcome.Flat;
        if ((p1 > p0) == (dir == 1)) return ProofOfCall.Outcome.Hit;
        return ProofOfCall.Outcome.Miss;
    }

    function testFuzz_score_matchesReference(uint8 dir, int256 p0, int256 p1, uint16 band) public {
        dir = uint8(bound(dir, 1, 2));
        p0 = bound(p0, 1, poc.MAX_ANSWER());
        p1 = bound(p1, 1, poc.MAX_ANSWER());
        band = uint16(bound(band, 0, 1000));
        vm.prank(owner);
        poc.setDefaults(GAP, band);

        (uint80 e, uint80 x) = _scenario(dir, p0, p1);
        ProofOfCall.Outcome got = _reveal(alice, ID, address(btc), dir, e, x);
        assertEq(uint8(got), uint8(_reference(dir, uint256(p0), uint256(p1), band)));

        ProofOfCall.Scorecard memory card = poc.scorecard(alice);
        assertEq(uint256(card.hits) + card.misses + card.flats + card.voids, 1);
    }

    /// Opposite directions on the same prices never both hit.
    function testFuzz_score_oppositeCallsNeverBothHit(int256 p0, int256 p1) public {
        p0 = bound(p0, 1, poc.MAX_ANSWER());
        p1 = bound(p1, 1, poc.MAX_ANSWER());
        uint256 s = block.timestamp;
        bytes32 idUp = keccak256("up");
        bytes32 idDown = keccak256("down");
        bytes32 cUp = _commit(alice, idUp, address(btc), UP, SALT);
        bytes32 cDown = _commit(alice, idDown, address(btc), DOWN, SALT);
        vm.startPrank(alice);
        poc.seal(idUp, cUp, H, _revealBy(s, H));
        poc.seal(idDown, cDown, H, _revealBy(s, H));
        vm.stopPrank();
        uint80 e = btc.pushRound(p0, s + 1);
        uint80 x = btc.pushRound(p1, s + H);
        vm.warp(s + H);
        ProofOfCall.Outcome a = _reveal(alice, idUp, address(btc), UP, e, x);
        ProofOfCall.Outcome b = _reveal(alice, idDown, address(btc), DOWN, e, x);
        if (a == ProofOfCall.Outcome.Flat) assertEq(uint8(b), uint8(ProofOfCall.Outcome.Flat));
        else assertTrue(a != b);
    }

    // ------------------------------------------------------------------ round proofs

    /// With N rounds at increasing times, only the first round at or after each target is accepted.
    function testFuzz_roundProof_onlyFirstRoundAccepted(uint8 n, uint256 seed, uint80 pickEntry, uint80 pickExit)
        public
    {
        n = uint8(bound(n, 2, 20));
        uint256 s = _seal(alice, ID, address(btc), UP);
        uint256 t = s;
        uint80 first = btc.latestRound() + 1;
        uint80 entryOk;
        uint80 exitOk;
        for (uint256 i = 0; i < n; ++i) {
            t += bound(uint256(keccak256(abi.encode(seed, i))), 1, (H + GAP) / n);
            uint80 r = btc.pushRound(int256(1e8 + i), t);
            if (entryOk == 0 && t >= s) entryOk = r;
            if (exitOk == 0 && t >= s + H) exitOk = r;
        }
        if (exitOk == 0) {
            t = s + H;
            exitOk = btc.pushRound(2e8, t);
        }
        vm.warp(t);
        pickEntry = uint80(bound(pickEntry, first, btc.latestRound()));
        pickExit = uint80(bound(pickExit, first, btc.latestRound()));
        if (seed % 2 == 0) (pickEntry, pickExit) = (entryOk, exitOk); // exercise the accepting path too

        if (pickEntry == entryOk && pickExit == exitOk) {
            _reveal(alice, ID, address(btc), UP, pickEntry, pickExit); // must not revert
            assertTrue(poc.getCall(alice, ID).outcome != ProofOfCall.Outcome.Open);
        } else {
            vm.expectRevert();
            _reveal(alice, ID, address(btc), UP, pickEntry, pickExit);
        }
    }

    // ------------------------------------------------------------------ expire

    function testFuzz_expire_anyCallerAfterDeadline(address caller, uint256 late) public {
        _seal(alice, ID, address(btc), UP);
        uint64 rb = poc.getCall(alice, ID).revealBy;
        late = bound(late, 1, 3650 days);
        vm.warp(uint256(rb) + late);
        vm.prank(caller);
        poc.expire(alice, ID);
        assertEq(poc.scorecard(alice).expiries, 1);
        assertEq(poc.scorecard(alice).misses, 1);
    }
}
