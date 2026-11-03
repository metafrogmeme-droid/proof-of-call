// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

contract MockAggregatorV3Test is Test {
    MockAggregatorV3 internal m;

    function setUp() public {
        vm.warp(1_800_000_000);
        m = new MockAggregatorV3("BTC / USD");
    }

    function test_metadata() public view {
        assertEq(m.decimals(), 8);
        assertEq(m.DECIMALS(), 8);
        assertEq(m.description(), "BTC / USD");
        assertEq(m.version(), 1);
        assertEq(m.admin(), address(this));
    }

    function test_latest_revert_noData() public {
        vm.expectRevert(bytes("MOCK: no data"));
        m.latestRoundData();
    }

    function test_pushRound() public {
        uint80 r1 = m.pushRound(60_000e8, block.timestamp);
        uint80 r2 = m.pushRound(61_000e8, block.timestamp + 60);
        assertEq(r1, 1);
        assertEq(r2, 2);
        (uint80 id, int256 a, uint256 st, uint256 u, uint80 air) = m.latestRoundData();
        assertEq(id, 2);
        assertEq(a, 61_000e8);
        assertEq(st, block.timestamp + 60);
        assertEq(u, block.timestamp + 60);
        assertEq(air, 2);
        (id, a,,,) = m.getRoundData(1);
        assertEq(id, 1);
        assertEq(a, 60_000e8);
    }

    function test_pushRound_revert_timeBackwards() public {
        m.pushRound(1, block.timestamp);
        vm.expectRevert(bytes("MOCK: time went backwards"));
        m.pushRound(1, block.timestamp - 1);
    }

    function test_getRoundData_revert_missing() public {
        vm.expectRevert(bytes("MOCK: no such round"));
        m.getRoundData(7);
    }

    function test_setRound_and_latest() public {
        m.setRound(5, 42, 1, 2, 4);
        assertEq(m.latestRound(), 5);
        (uint80 id, int256 a, uint256 st, uint256 u, uint80 air) = m.getRoundData(5);
        assertEq(id, 5);
        assertEq(a, 42);
        assertEq(st, 1);
        assertEq(u, 2);
        assertEq(air, 4);
        m.setRound(3, 1, 1, 1, 3); // lower id does not lower latest
        assertEq(m.latestRound(), 5);
        m.setLatestRound(3);
        assertEq(m.latestRound(), 3);
    }

    function test_setRound_revert_zero() public {
        vm.expectRevert(bytes("MOCK: zero round"));
        m.setRound(0, 1, 1, 1, 0);
    }

    function test_reverting() public {
        m.pushRound(1, block.timestamp);
        m.setReverting(true);
        vm.expectRevert(bytes("MOCK: reverting"));
        m.latestRoundData();
        vm.expectRevert(bytes("MOCK: reverting"));
        m.getRoundData(1);
        m.setReverting(false);
        m.latestRoundData();
    }

    function test_onlyAdmin() public {
        address x = makeAddr("x");
        vm.startPrank(x);
        vm.expectRevert(bytes("MOCK: not admin"));
        m.pushRound(1, 1);
        vm.expectRevert(bytes("MOCK: not admin"));
        m.setRound(1, 1, 1, 1, 1);
        vm.expectRevert(bytes("MOCK: not admin"));
        m.setLatestRound(1);
        vm.expectRevert(bytes("MOCK: not admin"));
        m.setReverting(true);
        vm.stopPrank();
    }

    function testFuzz_pushRound_monotonic(uint8 n, uint256 seed) public {
        n = uint8(bound(n, 1, 50));
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < n; ++i) {
            t += uint256(keccak256(abi.encode(seed, i))) % 1 days;
            m.pushRound(int256(i + 1), t);
        }
        assertEq(m.latestRound(), n);
        uint256 prev;
        for (uint80 r = 1; r <= n; ++r) {
            (,,, uint256 u,) = m.getRoundData(r);
            assertGe(u, prev);
            prev = u;
        }
    }
}
