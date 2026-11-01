// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title MockAggregatorV3
/// @notice Testnet stand-in for a QIE Oracle feed (the QIE testnet has no oracle contracts).
///         8 decimals, rounds scripted by the deployer. Never allowlist this on mainnet.
contract MockAggregatorV3 is IAggregatorV3 {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
        bool exists;
    }

    uint8 public constant DECIMALS = 8;
    uint256 public constant VERSION = 1;

    address public immutable admin;
    string internal _description;
    uint80 public latestRound;
    bool public reverting;
    mapping(uint80 roundId => Round) internal _rounds;

    event RoundSet(uint80 indexed roundId, int256 answer, uint256 updatedAt);

    modifier onlyAdmin() {
        require(msg.sender == admin, "MOCK: not admin");
        _;
    }

    constructor(string memory description_) {
        admin = msg.sender;
        _description = description_;
    }

    /// @notice Append the next round. Timestamps may not go backwards.
    function pushRound(int256 answer, uint256 updatedAt) external onlyAdmin returns (uint80 roundId) {
        require(updatedAt >= _rounds[latestRound].updatedAt, "MOCK: time went backwards");
        roundId = latestRound + 1;
        _rounds[roundId] = Round(answer, updatedAt, updatedAt, roundId, true);
        latestRound = roundId;
        emit RoundSet(roundId, answer, updatedAt);
    }

    /// @notice Write any round with arbitrary fields, for edge-case tests. Raises latestRound if needed.
    function setRound(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
        external
        onlyAdmin
    {
        require(roundId != 0, "MOCK: zero round");
        _rounds[roundId] = Round(answer, startedAt, updatedAt, answeredInRound, true);
        if (roundId > latestRound) latestRound = roundId;
        emit RoundSet(roundId, answer, updatedAt);
    }

    function setLatestRound(uint80 roundId) external onlyAdmin {
        latestRound = roundId;
    }

    function setReverting(bool on) external onlyAdmin {
        reverting = on;
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return VERSION;
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!reverting, "MOCK: reverting");
        Round memory r = _rounds[roundId];
        require(r.exists, "MOCK: no such round");
        return (roundId, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!reverting, "MOCK: reverting");
        require(latestRound != 0, "MOCK: no data");
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }
}
