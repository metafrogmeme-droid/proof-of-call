// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @dev A feed that misbehaves in configurable ways, for proof edge cases.
contract QuirkyFeed is IAggregatorV3 {
    struct R {
        int256 answer;
        uint256 updatedAt;
        bool exists;
    }

    mapping(uint80 => R) internal rounds;
    uint80 public latest;
    uint80 public lieAboutId; // when getRoundData(lieAboutId) is asked, return a different id
    uint80 public revertOn; // getRoundData(revertOn) reverts
    bool public latestReverts;

    function set(uint80 id, int256 answer, uint256 updatedAt) external {
        rounds[id] = R(answer, updatedAt, true);
        if (id > latest) latest = id;
    }

    function setLieAboutId(uint80 id) external {
        lieAboutId = id;
    }

    function setRevertOn(uint80 id) external {
        revertOn = id;
    }

    function setLatestReverts(bool on) external {
        latestReverts = on;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "QUIRKY";
    }

    function version() external pure returns (uint256) {
        return 0;
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(id != revertOn, "QUIRKY: revert");
        R memory r = rounds[id];
        require(r.exists, "QUIRKY: missing");
        uint80 reported = id == lieAboutId ? id + 1000 : id;
        return (reported, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!latestReverts, "QUIRKY: latest revert");
        R memory r = rounds[latest];
        return (latest, r.answer, r.updatedAt, r.updatedAt, latest);
    }
}

/// @dev A contract that tries to receive value through ProofOfCall; used only to prove it cannot.
contract Sender {
    function send(address to, uint256 amount) external returns (bool ok) {
        (ok,) = to.call{value: amount}("");
    }

    receive() external payable {}
}
