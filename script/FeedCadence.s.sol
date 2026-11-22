// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {DeployConfig} from "./DeployConfig.sol";

/// @title FeedCadence
/// @notice Read-only: measures how often a price feed updates, to choose POC_MAX_GAP before a deployment.
///         Never broadcasts and needs no key.
///
///   forge script script/FeedCadence.s.sol:FeedCadence --rpc-url https://rpc1mainnet.qie.digital/
///
///   POC_CADENCE_FEEDS   comma-separated feeds (default on chain 1990: QIE Oracle BTC / USD and ETH / USD)
///   POC_CADENCE_ROUNDS  how many recent rounds to sample (default 96, 2..500)
///
/// It also checks what ProofOfCall's round proofs assume: plain round ids (no Chainlink phase bits),
/// `updatedAt` never decreasing with the round id, and `answeredInRound == roundId`.
contract FeedCadence is Script {
    uint256 internal constant DEFAULT_ROUNDS = 96;
    uint256 internal constant MAX_ROUNDS = 500;
    uint256 internal constant ROUND_UP_TO = 15 minutes;
    uint256 internal constant MIN_RECOMMENDED = 1 hours;

    struct Stats {
        uint8 decimals;
        uint80 latestRound;
        int256 latestAnswer;
        uint256 latestUpdatedAt;
        uint256 sinceLatest; // seconds since the latest update, at the current block
        uint256 sampled; // rounds read
        uint256 gaps; // consecutive pairs measured
        uint256 minGap;
        uint256 medianGap;
        uint256 maxGap;
        uint256 meanGap;
        bool plainIds; // latestRound < 2**64: no phase id in the upper bits
        bool monotonic; // updatedAt never decreased with the round id in the sample
        bool answered; // answeredInRound == roundId for every sampled round
        bool complete; // every requested round could be read
        uint32 recommendedMaxGap; // 0 if the feed has no rounds
    }

    function run() external view {
        uint256 rounds = vm.envOr("POC_CADENCE_ROUNDS", DEFAULT_ROUNDS);
        require(rounds >= 2 && rounds <= MAX_ROUNDS, "CADENCE: POC_CADENCE_ROUNDS must be 2..500");
        address[] memory feeds = vm.envOr("POC_CADENCE_FEEDS", ",", new address[](0));
        if (feeds.length == 0) {
            require(block.chainid == DeployConfig.QIE_MAINNET, "CADENCE: set POC_CADENCE_FEEDS on this chain");
            feeds = new address[](2);
            feeds[0] = DeployConfig.QIE_MAINNET_BTC_USD;
            feeds[1] = DeployConfig.QIE_MAINNET_ETH_USD;
        }

        uint32 worst;
        console2.log("chain id      ", block.chainid);
        console2.log("block time    ", block.timestamp);
        for (uint256 i = 0; i < feeds.length; ++i) {
            Stats memory s = measure(feeds[i], rounds);
            _print(feeds[i], s);
            if (s.recommendedMaxGap > worst) worst = s.recommendedMaxGap;
        }
        console2.log("== recommended POC_MAX_GAP (all feeds, seconds):", uint256(worst));
    }

    /// @notice Reads up to `rounds` most recent rounds of `feed` and summarises the update intervals.
    function measure(address feed, uint256 rounds) public view returns (Stats memory s) {
        require(feed.code.length != 0, "CADENCE: feed has no code on this chain");
        IAggregatorV3 agg = IAggregatorV3(feed);
        s.decimals = agg.decimals();
        s.monotonic = true;
        s.answered = true;
        try agg.latestRoundData() returns (uint80 r, int256 a, uint256, uint256 u, uint80) {
            (s.latestRound, s.latestAnswer, s.latestUpdatedAt) = (r, a, u);
        } catch {
            return s; // no data yet (e.g. an empty testnet mock): complete stays false
        }
        s.sinceLatest = block.timestamp > s.latestUpdatedAt ? block.timestamp - s.latestUpdatedAt : 0;
        s.plainIds = s.latestRound < (uint80(1) << 64);
        s.complete = true;
        if (s.latestRound == 0) return s;

        uint256[] memory gaps = _sample(agg, s, rounds < s.latestRound ? rounds : s.latestRound);
        if (s.gaps != 0) s.medianGap = _median(gaps, s.gaps);
        uint256 worst = s.maxGap > s.sinceLatest ? s.maxGap : s.sinceLatest;
        s.recommendedMaxGap = recommendMaxGap(worst);
    }

    /// @notice 1.5 x the worst observed silence, rounded up to 15 minutes, at least 1 hour, within the
    ///         contract's bounds [1 min, 7 days]. A starting point only: the owner picks the final value.
    function recommendMaxGap(uint256 worstGap) public pure returns (uint32) {
        uint256 r = worstGap > DeployConfig.MAX_MAX_GAP ? DeployConfig.MAX_MAX_GAP : worstGap;
        r = (r * 3 + 1) / 2;
        r = ((r + ROUND_UP_TO - 1) / ROUND_UP_TO) * ROUND_UP_TO;
        if (r < MIN_RECOMMENDED) r = MIN_RECOMMENDED;
        if (r > DeployConfig.MAX_MAX_GAP) r = DeployConfig.MAX_MAX_GAP;
        return uint32(r);
    }

    /// @dev Walks back from the latest round over `n` rounds, filling the gap statistics in `s`.
    function _sample(IAggregatorV3 agg, Stats memory s, uint256 n) internal view returns (uint256[] memory gaps) {
        gaps = new uint256[](n);
        uint256 prevUpdatedAt;
        uint256 sum;
        s.minGap = type(uint256).max;
        for (uint256 k = 0; k < n; ++k) {
            (bool ok, uint256 u) = _readRound(agg, s.latestRound - uint80(k), s);
            if (!ok) {
                s.complete = false;
                break;
            }
            if (k != 0) {
                if (u > prevUpdatedAt) {
                    s.monotonic = false;
                } else {
                    uint256 g = prevUpdatedAt - u;
                    gaps[s.gaps++] = g;
                    sum += g;
                    if (g < s.minGap) s.minGap = g;
                    if (g > s.maxGap) s.maxGap = g;
                }
            }
            prevUpdatedAt = u;
        }
        if (s.gaps == 0) s.minGap = 0;
        else s.meanGap = sum / s.gaps;
    }

    function _readRound(IAggregatorV3 agg, uint80 id, Stats memory s) internal view returns (bool ok, uint256 u) {
        try agg.getRoundData(id) returns (uint80 r, int256, uint256, uint256 updatedAt, uint80 answeredInRound) {
            s.sampled++;
            if (r != id || answeredInRound < id) s.answered = false;
            return (true, updatedAt);
        } catch {
            return (false, 0);
        }
    }

    /// @dev Insertion sort of the first `n` values (n <= 500, off-chain only), then the middle value.
    function _median(uint256[] memory a, uint256 n) internal pure returns (uint256) {
        for (uint256 i = 1; i < n; ++i) {
            uint256 v = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > v) {
                a[j] = a[j - 1];
                --j;
            }
            a[j] = v;
        }
        return n % 2 == 1 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
    }

    function _print(address feed, Stats memory s) internal view {
        console2.log("--");
        console2.log("feed          ", feed);
        try IAggregatorV3(feed).description() returns (string memory d) {
            console2.log("description   ", d);
        } catch {
            console2.log("description    (unreadable)");
        }
        console2.log("decimals      ", uint256(s.decimals));
        console2.log("latest round  ", uint256(s.latestRound));
        console2.log("latest answer ", s.latestAnswer);
        console2.log("since latest s", s.sinceLatest);
        console2.log("rounds read   ", s.sampled);
        console2.log("gap min s     ", s.minGap);
        console2.log("gap median s  ", s.medianGap);
        console2.log("gap mean s    ", s.meanGap);
        console2.log("gap max s     ", s.maxGap);
        console2.log("plain ids     ", s.plainIds);
        console2.log("monotonic     ", s.monotonic);
        console2.log("answered      ", s.answered);
        console2.log("complete      ", s.complete);
        console2.log("recommended   ", uint256(s.recommendedMaxGap));
    }
}
