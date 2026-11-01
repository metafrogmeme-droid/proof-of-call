// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title ProofOfCall
/// @notice Sealed, oracle-scored market calls with public per-publisher scorecards.
///
/// Lifecycle of a call:
///   1. seal    - the publisher stores a hash commitment. Asset (feed) and direction stay hidden.
///   2. reveal  - after the horizon, anyone holding the opening reveals it with two oracle round ids.
///                The contract proves on chain that the entry round is the first round updated at or
///                after the seal, and the exit round the first round updated at or after the horizon.
///                The call is scored HIT / MISS / FLAT, or VOID when the feed stalled or gave bad data.
///   3. expire  - a call not revealed by its deadline can be expired by anyone and counts as a MISS.
///
/// Hard properties: accepts no value and holds no funds, is not upgradeable, makes only STATICCALLs
/// (to allowlisted feeds), and the owner can only manage the feed allowlist and the defaults for new
/// seals. Settings are snapshotted per call at seal time, so no owner action changes how an existing
/// call is scored.
contract ProofOfCall {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Outcome {
        Open, // sealed, not yet settled
        Hit,
        Miss,
        Flat,
        Void,
        Expired // never revealed in time; counted as a miss
    }

    enum VoidReason {
        None,
        EntryStalled, // no feed update within maxGap after the seal
        ExitStalled, // no feed update within maxGap after the horizon
        EntryBadData, // proven entry round had an unusable answer or timestamp
        ExitBadData // proven exit round had an unusable answer or timestamp
    }

    struct Call {
        bytes32 commitment;
        uint64 sealedAt;
        uint64 horizon;
        uint64 revealBy;
        uint32 maxGap;
        uint16 flatBandBps;
        Outcome outcome;
        VoidReason voidReason;
        uint8 direction;
        address feed;
        uint80 entryRound;
        uint80 exitRound;
        int256 entryPrice;
        int256 exitPrice;
    }

    struct Scorecard {
        uint64 sealedCalls;
        uint64 hits;
        uint64 misses; // includes expired calls
        uint64 flats;
        uint64 voids;
        uint64 expiries;
    }

    struct FeedState {
        uint64 addedAt;
        uint64 retiredAt; // 0 while active
    }

    /// @dev Result of proving one round against one target time.
    struct RoundProof {
        bool stalled;
        bool badData;
        int256 answer;
        uint256 updatedAt;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint8 public constant UP = 1;
    uint8 public constant DOWN = 2;

    uint256 public constant BPS = 10_000;
    uint64 public constant MIN_HORIZON = 5 minutes;
    uint64 public constant MAX_HORIZON = 366 days;
    uint64 public constant MIN_REVEAL_WINDOW = 1 hours;
    uint64 public constant MAX_REVEAL_WINDOW = 30 days;
    uint32 public constant MIN_MAX_GAP = 1 minutes;
    uint32 public constant MAX_MAX_GAP = 7 days;
    uint16 public constant MAX_FLAT_BAND_BPS = 1000;
    uint256 public constant MAX_FEEDS_PER_TX = 32;
    /// @dev Answers above this are treated as bad data; keeps all scoring arithmetic overflow-free.
    int256 public constant MAX_ANSWER = int256(type(int128).max);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public owner;
    address public pendingOwner;

    /// @notice Defaults copied into each new call at seal time.
    uint32 public defaultMaxGap;
    uint16 public defaultFlatBandBps;

    mapping(address feed => FeedState) internal _feeds;
    mapping(address publisher => mapping(bytes32 callId => Call)) internal _calls;
    mapping(address publisher => Scorecard) internal _scorecards;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Sealed(
        address indexed publisher,
        bytes32 indexed callId,
        bytes32 commitment,
        uint64 sealedAt,
        uint64 horizon,
        uint64 revealBy,
        uint32 maxGap,
        uint16 flatBandBps
    );
    event Revealed(
        address indexed publisher,
        bytes32 indexed callId,
        address indexed feed,
        uint8 direction,
        Outcome outcome,
        VoidReason voidReason,
        uint80 entryRound,
        uint80 exitRound,
        int256 entryPrice,
        int256 exitPrice
    );
    event Expired(address indexed publisher, bytes32 indexed callId, address indexed caller);
    event FeedAdded(address indexed feed);
    event FeedRetired(address indexed feed);
    event DefaultsUpdated(uint32 maxGap, uint16 flatBandBps);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Construction and admin
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "POC: not owner");
        _;
    }

    constructor(address initialOwner, uint32 maxGap, uint16 flatBandBps, address[] memory feeds) {
        require(initialOwner != address(0), "POC: zero owner");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
        _setDefaults(maxGap, flatBandBps);
        _addFeeds(feeds);
    }

    function addFeeds(address[] calldata feeds) external onlyOwner {
        _addFeeds(feeds);
    }

    /// @notice Retire a feed. Calls sealed before this block can still be revealed against it.
    function retireFeed(address feed) external onlyOwner {
        FeedState storage f = _feeds[feed];
        require(f.addedAt != 0, "POC: feed not listed");
        require(f.retiredAt == 0, "POC: feed already retired");
        f.retiredAt = uint64(block.timestamp);
        emit FeedRetired(feed);
    }

    /// @notice Change the defaults for calls sealed from now on. Existing calls keep their snapshot.
    function setDefaults(uint32 maxGap, uint16 flatBandBps) external onlyOwner {
        _setDefaults(maxGap, flatBandBps);
    }

    /// @notice Start a two-step ownership transfer. Passing address(0) cancels a pending transfer.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "POC: not pending owner");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Give up ownership for good. The feed allowlist and defaults are then frozen.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------------
    // Seal / reveal / expire
    // ---------------------------------------------------------------------

    /// @notice Seal a call in the caller's namespace.
    /// @param callId     publisher-chosen id, unique per publisher
    /// @param commitment computeCommitment(msg.sender, callId, feed, direction, salt)
    /// @param horizon    seconds from now until the call's target time
    /// @param revealBy   absolute deadline for reveal; after it anyone may expire the call
    function seal(bytes32 callId, bytes32 commitment, uint64 horizon, uint64 revealBy) external {
        require(commitment != bytes32(0), "POC: zero commitment");
        Call storage c = _calls[msg.sender][callId];
        require(c.sealedAt == 0, "POC: call exists");
        require(horizon >= MIN_HORIZON && horizon <= MAX_HORIZON, "POC: horizon out of range");

        uint32 maxGap = defaultMaxGap;
        uint256 target = block.timestamp + horizon;
        require(uint256(revealBy) >= target + maxGap + MIN_REVEAL_WINDOW, "POC: reveal window too short");
        require(uint256(revealBy) <= target + maxGap + MAX_REVEAL_WINDOW, "POC: reveal window too long");

        c.commitment = commitment;
        c.sealedAt = uint64(block.timestamp);
        c.horizon = horizon;
        c.revealBy = revealBy;
        c.maxGap = maxGap;
        c.flatBandBps = defaultFlatBandBps;

        unchecked {
            _scorecards[msg.sender].sealedCalls++;
        }
        emit Sealed(msg.sender, callId, commitment, c.sealedAt, horizon, revealBy, maxGap, c.flatBandBps);
    }

    /// @notice Reveal and score a call. Callable by anyone who holds the opening.
    /// @param entryRound first feed round with updatedAt >= sealedAt (or the latest round, as a stall proof)
    /// @param exitRound  first feed round with updatedAt >= sealedAt + horizon (or the latest, as a stall proof)
    function reveal(
        address publisher,
        bytes32 callId,
        address feed,
        uint8 direction,
        bytes32 salt,
        uint80 entryRound,
        uint80 exitRound
    ) external returns (Outcome outcome) {
        Call storage c = _calls[publisher][callId];
        require(c.sealedAt != 0, "POC: unknown call");
        require(c.outcome == Outcome.Open, "POC: already settled");

        uint256 target = uint256(c.sealedAt) + c.horizon;
        require(block.timestamp >= target, "POC: horizon not reached");
        require(block.timestamp <= c.revealBy, "POC: reveal window closed");
        require(computeCommitment(publisher, callId, feed, direction, salt) == c.commitment, "POC: wrong opening");
        require(direction == UP || direction == DOWN, "POC: bad direction");
        require(isFeedAllowedAt(feed, c.sealedAt), "POC: feed not allowed");

        RoundProof memory entry = _proveRound(feed, entryRound, c.sealedAt, c.maxGap);
        RoundProof memory exit = _proveRound(feed, exitRound, target, c.maxGap);

        VoidReason reason = VoidReason.None;
        if (entry.stalled) {
            reason = VoidReason.EntryStalled;
        } else if (entry.badData) {
            reason = VoidReason.EntryBadData;
        } else if (exit.stalled) {
            reason = VoidReason.ExitStalled;
        } else if (exit.badData) {
            reason = VoidReason.ExitBadData;
        }

        Scorecard storage card = _scorecards[publisher];
        if (reason != VoidReason.None) {
            outcome = Outcome.Void;
            unchecked {
                card.voids++;
            }
        } else {
            outcome = _score(direction, entry.answer, exit.answer, c.flatBandBps);
            unchecked {
                if (outcome == Outcome.Hit) card.hits++;
                else if (outcome == Outcome.Miss) card.misses++;
                else card.flats++;
            }
            c.entryPrice = entry.answer;
            c.exitPrice = exit.answer;
        }

        c.outcome = outcome;
        c.voidReason = reason;
        c.direction = direction;
        c.feed = feed;
        c.entryRound = entryRound;
        c.exitRound = exitRound;

        emit Revealed(
            publisher, callId, feed, direction, outcome, reason, entryRound, exitRound, c.entryPrice, c.exitPrice
        );
    }

    /// @notice Close a call that was not revealed by its deadline. Counts as a MISS. Callable by anyone.
    function expire(address publisher, bytes32 callId) external {
        Call storage c = _calls[publisher][callId];
        require(c.sealedAt != 0, "POC: unknown call");
        require(c.outcome == Outcome.Open, "POC: already settled");
        require(block.timestamp > c.revealBy, "POC: reveal window open");

        c.outcome = Outcome.Expired;
        Scorecard storage card = _scorecards[publisher];
        unchecked {
            card.misses++;
            card.expiries++;
        }
        emit Expired(publisher, callId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The commitment a publisher must seal. Binds chain, contract, publisher, id, feed, direction, salt.
    function computeCommitment(address publisher, bytes32 callId, address feed, uint8 direction, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), publisher, callId, feed, direction, salt));
    }

    function getCall(address publisher, bytes32 callId) external view returns (Call memory) {
        return _calls[publisher][callId];
    }

    function scorecard(address publisher) external view returns (Scorecard memory) {
        return _scorecards[publisher];
    }

    function feedState(address feed) external view returns (FeedState memory) {
        return _feeds[feed];
    }

    /// @notice True if `feed` was on the allowlist at time `t`.
    function isFeedAllowedAt(address feed, uint256 t) public view returns (bool) {
        FeedState memory f = _feeds[feed];
        return f.addedAt != 0 && f.addedAt <= t && (f.retiredAt == 0 || f.retiredAt > t);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _setDefaults(uint32 maxGap, uint16 flatBandBps) internal {
        require(maxGap >= MIN_MAX_GAP && maxGap <= MAX_MAX_GAP, "POC: max gap out of range");
        require(flatBandBps <= MAX_FLAT_BAND_BPS, "POC: flat band too wide");
        defaultMaxGap = maxGap;
        defaultFlatBandBps = flatBandBps;
        emit DefaultsUpdated(maxGap, flatBandBps);
    }

    function _addFeeds(address[] memory feeds) internal {
        require(feeds.length <= MAX_FEEDS_PER_TX, "POC: too many feeds");
        for (uint256 i = 0; i < feeds.length; ++i) {
            address feed = feeds[i];
            require(feed.code.length != 0, "POC: feed has no code");
            require(_feeds[feed].addedAt == 0, "POC: feed already listed");
            _feeds[feed].addedAt = uint64(block.timestamp);
            emit FeedAdded(feed);
        }
    }

    /// @dev Prove that `roundId` is the first round of `feed` with updatedAt >= `t`, or, if the round is
    ///      older than `t`, that it is the latest round and the feed has been silent for more than `maxGap`
    ///      past `t` (a stall). Anything else reverts, so a caller cannot pick a convenient round.
    function _proveRound(address feed, uint80 roundId, uint256 t, uint32 maxGap)
        internal
        view
        returns (RoundProof memory p)
    {
        require(roundId != 0, "POC: zero round");
        IAggregatorV3 agg = IAggregatorV3(feed);

        uint80 rid;
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
        try agg.getRoundData(roundId) returns (uint80 r, int256 a, uint256, uint256 u, uint80 air) {
            (rid, answer, updatedAt, answeredInRound) = (r, a, u, air);
        } catch {
            revert("POC: round unreadable");
        }
        require(rid == roundId, "POC: round id mismatch");

        if (updatedAt < t) {
            // Only valid as a stall proof.
            uint80 latest;
            try agg.latestRoundData() returns (uint80 r, int256, uint256, uint256, uint80) {
                latest = r;
            } catch {
                revert("POC: latest round unreadable");
            }
            require(latest == roundId, "POC: round before target");
            require(block.timestamp > t + maxGap, "POC: no round after target yet");
            p.stalled = true;
            p.updatedAt = updatedAt;
            return p;
        }

        if (roundId != 1) {
            uint80 prevId;
            uint256 prevUpdatedAt;
            try agg.getRoundData(roundId - 1) returns (uint80 r, int256, uint256, uint256 u, uint80) {
                (prevId, prevUpdatedAt) = (r, u);
            } catch {
                revert("POC: previous round unreadable");
            }
            require(prevId == roundId - 1, "POC: previous round id mismatch");
            require(prevUpdatedAt < t, "POC: not first round after target");
        }

        p.updatedAt = updatedAt;
        if (
            updatedAt > block.timestamp || updatedAt - t > maxGap || answer <= 0 || answer > MAX_ANSWER
                || answeredInRound < roundId
        ) {
            // A gap above maxGap means the feed was too slow to give a fair price: fail closed.
            if (updatedAt <= block.timestamp && updatedAt - t > maxGap) p.stalled = true;
            else p.badData = true;
            return p;
        }
        p.answer = answer;
    }

    /// @dev Both prices are in (0, MAX_ANSWER], so the arithmetic below cannot overflow.
    function _score(uint8 direction, int256 entryPrice, int256 exitPrice, uint16 flatBandBps)
        internal
        pure
        returns (Outcome)
    {
        uint256 p0 = uint256(entryPrice);
        uint256 p1 = uint256(exitPrice);
        uint256 move = p1 > p0 ? p1 - p0 : p0 - p1;
        if (move * BPS <= p0 * flatBandBps) return Outcome.Flat;
        bool wentUp = p1 > p0;
        return (wentUp == (direction == UP)) ? Outcome.Hit : Outcome.Miss;
    }
}
