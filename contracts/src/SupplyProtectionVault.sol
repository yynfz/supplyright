// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    SupplyStatus,
    SupplyRightData,
    RequestStatus,
    ProtectionRequest,
    ProtectionPosition,
    ProtectionStatus,
    ProtectionTerms,
    ProtectionClaimStatus
} from "./SupplyTypes.sol";
import {
    ISupplyRightNFT,
    IProtectionNFT,
    ISupplyProtectionVault,
    IClaimReleaseGuard
} from "./interfaces/ISupplyRightProtocol.sol";

/// @title SupplyProtectionVault
/// @notice Holds protection collateral in native ETH and manages funded protection agreements attached
///         to individual supply rights.
///
///         Accounting model (per provider):
///           free   - deposited, uncommitted; withdrawable at any time by its owner
///           locked - committed to a specific protection; never withdrawable directly
///         Invariant: address(vault).balance >= totalFreeCollateral + totalLockedCollateral
///         ETH enters only through `deposit` / `fundAndApproveProtection`; plain transfers are rejected
///         (no receive/fallback), so every wei held is attributed to a provider.
///
///         There is intentionally no admin withdrawal, sweep, or payout-redirect function. Payouts can only
///         be triggered by the bound claim manager and always go to the protection's recorded beneficiary.
contract SupplyProtectionVault is AccessControl, ReentrancyGuard, ISupplyProtectionVault {
    bytes32 public constant PROVIDER_ROLE = keccak256("PROVIDER_ROLE");
    uint16 public constant BPS = 10_000;
    uint64 public constant MAX_CLAIM_WINDOW = 365 days;

    ISupplyRightNFT public immutable supplyRights;
    IProtectionNFT public immutable protectionNFT;
    address public claimManager;

    uint256 public requestCount;
    uint256 public protectionCount;
    mapping(uint256 requestId => ProtectionRequest) private _requests;
    mapping(uint256 protectionId => ProtectionPosition) private _protections;
    mapping(uint256 supplyRightId => uint256 requestId) public pendingRequestOf;

    mapping(address provider => uint256) public freeCollateral;
    mapping(address provider => uint256) public lockedCollateral;
    uint256 public totalFreeCollateral;
    uint256 public totalLockedCollateral;
    uint256 public totalPaidOut;

    event ClaimManagerBound(address indexed claimManager);
    event CollateralDeposited(address indexed provider, uint256 amount, uint256 freeBalance);
    event CollateralWithdrawn(address indexed provider, uint256 amount, uint256 freeBalance);
    event ProtectionRequested(
        uint256 indexed requestId,
        uint256 indexed supplyRightId,
        address indexed buyer,
        address provider,
        uint256 coverageAmount,
        uint16 coverageBps,
        uint64 expiresAt,
        bytes32 termsHash
    );
    event ProtectionRequestRejected(uint256 indexed requestId, address indexed provider, bytes32 reasonHash);
    event ProtectionRequestCancelled(uint256 indexed requestId, address indexed buyer);
    event ProtectionActivated(
        uint256 indexed protectionId,
        uint256 indexed requestId,
        uint256 indexed supplyRightId,
        address provider,
        address beneficiary,
        uint256 lockedAmount,
        bytes32 decisionHash
    );
    event ClaimOpenedOnProtection(uint256 indexed protectionId);
    event ClaimClosedOnProtection(uint256 indexed protectionId);
    event PayoutExecuted(
        uint256 indexed protectionId, address indexed beneficiary, uint256 amount, uint256 remainingLocked
    );
    event CollateralReleased(uint256 indexed protectionId, address indexed provider, uint256 amount, address caller);

    error AlreadyBound();
    error ZeroAddress();
    error NotClaimManager();
    error ZeroAmount();
    error InsufficientFreeCollateral(uint256 available, uint256 required);
    error NotBuyer();
    error SupplyRightNotEligible(SupplyStatus status);
    error AlreadyProtected(uint256 protectionId);
    error RequestAlreadyPending(uint256 requestId);
    error InvalidCoverage();
    error InvalidExpiry();
    error InvalidHash();
    error NotProvider(address account);
    error NotDesignatedProvider();
    error SelfProtection();
    error RequestNotPending(RequestStatus status);
    error UnknownProtection(uint256 protectionId);
    error ProtectionNotActive(ProtectionStatus status);
    error ProtectionExpired(uint64 startsAt, uint64 expiresAt);
    error ClaimAlreadyOpen();
    error NoOpenClaim();
    error InvalidClaimStage();
    error ExcessivePayout(uint256 requested, uint256 available);
    error ReleaseNotAllowed();
    error ReleaseBlockedByClaim();

    constructor(address admin, ISupplyRightNFT supplyRights_, IProtectionNFT protectionNFT_) {
        if (admin == address(0) || address(supplyRights_) == address(0) || address(protectionNFT_) == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        supplyRights = supplyRights_;
        protectionNFT = protectionNFT_;
    }

    modifier onlyClaimManager() {
        if (msg.sender != claimManager) revert NotClaimManager();
        _;
    }

    /// @notice One-time binding; afterwards the claim manager address can never change.
    function bindClaimManager(address claimManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (claimManager != address(0)) revert AlreadyBound();
        if (claimManager_ == address(0)) revert ZeroAddress();
        claimManager = claimManager_;
        emit ClaimManagerBound(claimManager_);
    }

    // ---------------------------------------------------------------------
    // Provider collateral
    // ---------------------------------------------------------------------

    /// @notice Deposit `msg.value` ETH as free collateral.
    function deposit() external payable nonReentrant onlyRole(PROVIDER_ROLE) {
        _deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw uncommitted collateral. Works even if the PROVIDER_ROLE was revoked, so funds
    ///         are never trapped by an access-control change. Locked collateral is never withdrawable.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 free = freeCollateral[msg.sender];
        if (free < amount) revert InsufficientFreeCollateral(free, amount);
        freeCollateral[msg.sender] = free - amount;
        totalFreeCollateral -= amount;
        Address.sendValue(payable(msg.sender), amount);
        emit CollateralWithdrawn(msg.sender, amount, free - amount);
    }

    // ---------------------------------------------------------------------
    // Protection requests (buyer)
    // ---------------------------------------------------------------------

    /// @param provider Designated provider, or address(0) to let any authorized provider accept.
    /// @param coverageAmount Maximum cumulative payout; must be fully funded before activation.
    /// @param coverageBps Share of the verified eligible loss that is compensated (1-10000).
    /// @param expiresAt Last timestamp at which a claim may be filed. Must be after the delivery deadline.
    /// @param termsHash Hash of the protection agreement / conditions document.
    function requestProtection(
        uint256 supplyRightId,
        address provider,
        uint256 coverageAmount,
        uint16 coverageBps,
        uint64 expiresAt,
        bytes32 termsHash
    ) external returns (uint256 requestId) {
        SupplyRightData memory sr = supplyRights.getSupplyRight(supplyRightId);
        if (msg.sender != sr.buyer || supplyRights.ownerOf(supplyRightId) != msg.sender) revert NotBuyer();
        if (sr.status != SupplyStatus.Registered && sr.status != SupplyStatus.Active) {
            revert SupplyRightNotEligible(sr.status);
        }
        if (sr.protectionId != 0) revert AlreadyProtected(sr.protectionId);
        uint256 pending = pendingRequestOf[supplyRightId];
        if (pending != 0) revert RequestAlreadyPending(pending);
        if (coverageAmount == 0 || coverageAmount > sr.contractValue) revert InvalidCoverage();
        if (coverageBps == 0 || coverageBps > BPS) revert InvalidCoverage();
        if (expiresAt <= sr.deliveryDeadline || expiresAt > sr.deliveryDeadline + MAX_CLAIM_WINDOW) {
            revert InvalidExpiry();
        }
        if (termsHash == bytes32(0)) revert InvalidHash();
        if (provider != address(0)) {
            if (!hasRole(PROVIDER_ROLE, provider)) revert NotProvider(provider);
            if (provider == msg.sender) revert SelfProtection();
        }

        requestId = ++requestCount;
        _requests[requestId] = ProtectionRequest({
            supplyRightId: supplyRightId,
            buyer: msg.sender,
            provider: provider,
            coverageAmount: coverageAmount,
            coverageBps: coverageBps,
            expiresAt: expiresAt,
            requestedAt: uint64(block.timestamp),
            decidedAt: 0,
            status: RequestStatus.Pending,
            protectionId: 0,
            termsHash: termsHash,
            decisionHash: bytes32(0)
        });
        pendingRequestOf[supplyRightId] = requestId;
        emit ProtectionRequested(
            requestId, supplyRightId, msg.sender, provider, coverageAmount, coverageBps, expiresAt, termsHash
        );
    }

    function cancelRequest(uint256 requestId) external {
        ProtectionRequest storage r = _requests[requestId];
        if (r.status != RequestStatus.Pending) revert RequestNotPending(r.status);
        if (msg.sender != r.buyer) revert NotBuyer();
        r.status = RequestStatus.Cancelled;
        r.decidedAt = uint64(block.timestamp);
        delete pendingRequestOf[r.supplyRightId];
        emit ProtectionRequestCancelled(requestId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Provider decisions
    // ---------------------------------------------------------------------

    function rejectRequest(uint256 requestId, bytes32 reasonHash) external onlyRole(PROVIDER_ROLE) {
        ProtectionRequest storage r = _requests[requestId];
        if (r.status != RequestStatus.Pending) revert RequestNotPending(r.status);
        if (r.provider != address(0) && r.provider != msg.sender) revert NotDesignatedProvider();
        if (reasonHash == bytes32(0)) revert InvalidHash();
        r.status = RequestStatus.Rejected;
        r.decidedAt = uint64(block.timestamp);
        r.decisionHash = reasonHash;
        delete pendingRequestOf[r.supplyRightId];
        emit ProtectionRequestRejected(requestId, msg.sender, reasonHash);
    }

    /// @notice Approve using already-deposited free collateral.
    function approveProtection(uint256 requestId, bytes32 decisionHash)
        external
        nonReentrant
        onlyRole(PROVIDER_ROLE)
        returns (uint256)
    {
        return _approve(requestId, decisionHash);
    }

    /// @notice Deposit `msg.value` ETH and approve in one transaction. The deposit is credited to free
    ///         collateral first, so `msg.value` must cover at least the shortfall
    ///         (coverageAmount - freeCollateral); any excess stays as withdrawable free collateral.
    function fundAndApproveProtection(uint256 requestId, bytes32 decisionHash)
        external
        payable
        nonReentrant
        onlyRole(PROVIDER_ROLE)
        returns (uint256)
    {
        _checkApprover(_requests[requestId]);
        if (msg.value > 0) _deposit(msg.sender, msg.value);
        return _approve(requestId, decisionHash);
    }

    /// @notice Return remaining locked collateral to the provider's free balance after valid closure
    ///         (supply right Fulfilled/Closed) or after the protection expired - and only if no claim is
    ///         open and no rejected claim can still be appealed. Funds only ever move to the provider.
    function releaseCollateral(uint256 protectionId) external nonReentrant {
        ProtectionPosition storage p = _protections[protectionId];
        if (p.status == ProtectionStatus.None) revert UnknownProtection(protectionId);
        if (p.status == ProtectionStatus.Released) revert ProtectionNotActive(p.status);
        if (p.claimOpen) revert ReleaseBlockedByClaim();
        if (claimManager != address(0) && IClaimReleaseGuard(claimManager).isReleaseBlocked(protectionId)) {
            revert ReleaseBlockedByClaim();
        }
        SupplyStatus s = supplyRights.getSupplyRight(p.supplyRightId).status;
        bool finalized = s == SupplyStatus.Closed || s == SupplyStatus.Fulfilled;
        if (!finalized && block.timestamp <= p.expiresAt) revert ReleaseNotAllowed();

        uint256 amount = p.lockedAmount;
        p.lockedAmount = 0;
        p.releasedAmount += amount;
        p.status = ProtectionStatus.Released;
        lockedCollateral[p.provider] -= amount;
        totalLockedCollateral -= amount;
        freeCollateral[p.provider] += amount;
        totalFreeCollateral += amount;

        protectionNFT.setClaimStatus(protectionId, ProtectionClaimStatus.Released);
        emit CollateralReleased(protectionId, p.provider, amount, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Claim manager hooks
    // ---------------------------------------------------------------------

    function openClaim(uint256 protectionId, bool enforceValidity) external onlyClaimManager {
        ProtectionPosition storage p = _protections[protectionId];
        if (p.status != ProtectionStatus.Active) revert ProtectionNotActive(p.status);
        if (p.claimOpen) revert ClaimAlreadyOpen();
        if (enforceValidity && (block.timestamp < p.startsAt || block.timestamp > p.expiresAt)) {
            revert ProtectionExpired(p.startsAt, p.expiresAt);
        }
        p.claimOpen = true;
        protectionNFT.setClaimStatus(protectionId, ProtectionClaimStatus.ClaimPending);
        emit ClaimOpenedOnProtection(protectionId);
    }

    function setClaimStage(uint256 protectionId, ProtectionClaimStatus stage) external onlyClaimManager {
        ProtectionPosition storage p = _protections[protectionId];
        if (!p.claimOpen) revert NoOpenClaim();
        if (
            stage != ProtectionClaimStatus.ClaimPending && stage != ProtectionClaimStatus.ClaimApproved
                && stage != ProtectionClaimStatus.Disputed
        ) revert InvalidClaimStage();
        protectionNFT.setClaimStatus(protectionId, stage);
    }

    function closeClaim(uint256 protectionId) external onlyClaimManager {
        ProtectionPosition storage p = _protections[protectionId];
        if (!p.claimOpen) revert NoOpenClaim();
        p.claimOpen = false;
        protectionNFT.setClaimStatus(
            protectionId, p.paidAmount > 0 ? ProtectionClaimStatus.PartiallyPaid : ProtectionClaimStatus.NoClaim
        );
        emit ClaimClosedOnProtection(protectionId);
    }

    /// @notice Pay `amount` from this protection's locked collateral to its beneficiary.
    ///         Capped by both the remaining agreed coverage and the locked funds.
    function executePayout(uint256 protectionId, uint256 amount)
        external
        nonReentrant
        onlyClaimManager
        returns (address beneficiary)
    {
        ProtectionPosition storage p = _protections[protectionId];
        if (!p.claimOpen) revert NoOpenClaim();
        uint256 available = Math.min(p.lockedAmount, p.coverageAmount - p.paidAmount);
        if (amount == 0 || amount > available) revert ExcessivePayout(amount, available);

        p.lockedAmount -= amount;
        p.paidAmount += amount;
        p.claimOpen = false;
        lockedCollateral[p.provider] -= amount;
        totalLockedCollateral -= amount;
        totalPaidOut += amount;
        bool exhausted = p.lockedAmount == 0;
        if (exhausted) p.status = ProtectionStatus.Exhausted;
        beneficiary = p.beneficiary;

        protectionNFT.setClaimStatus(
            protectionId, exhausted ? ProtectionClaimStatus.Exhausted : ProtectionClaimStatus.PartiallyPaid
        );
        Address.sendValue(payable(beneficiary), amount);
        emit PayoutExecuted(protectionId, beneficiary, amount, p.lockedAmount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Eligible payout for a verified loss: coverageBps share of the loss, capped by remaining
    ///         agreed coverage and by locked collateral.
    function quotePayout(uint256 protectionId, uint256 eligibleLoss) public view returns (uint256) {
        ProtectionPosition storage p = _protections[protectionId];
        if (p.status != ProtectionStatus.Active) return 0;
        uint256 gross = Math.mulDiv(eligibleLoss, p.coverageBps, BPS);
        uint256 cap = Math.min(p.lockedAmount, p.coverageAmount - p.paidAmount);
        return Math.min(gross, cap);
    }

    function getRequest(uint256 requestId) external view returns (ProtectionRequest memory) {
        return _requests[requestId];
    }

    function getProtection(uint256 protectionId) external view returns (ProtectionPosition memory) {
        return _protections[protectionId];
    }

    function getRequests(uint256 fromId, uint256 count) external view returns (ProtectionRequest[] memory out) {
        (uint256 start, uint256 n) = _page(fromId, count, requestCount);
        out = new ProtectionRequest[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _requests[start + i];
        }
    }

    function getProtections(uint256 fromId, uint256 count) external view returns (ProtectionPosition[] memory out) {
        (uint256 start, uint256 n) = _page(fromId, count, protectionCount);
        out = new ProtectionPosition[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _protections[start + i];
        }
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _deposit(address provider, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        freeCollateral[provider] += amount;
        totalFreeCollateral += amount;
        emit CollateralDeposited(provider, amount, freeCollateral[provider]);
    }

    function _approve(uint256 requestId, bytes32 decisionHash) private returns (uint256 protectionId) {
        ProtectionRequest storage r = _requests[requestId];
        _checkApprover(r);
        if (decisionHash == bytes32(0)) revert InvalidHash();
        if (block.timestamp >= r.expiresAt) revert InvalidExpiry();

        SupplyRightData memory sr = supplyRights.getSupplyRight(r.supplyRightId);
        if (sr.status != SupplyStatus.Registered && sr.status != SupplyStatus.Active) {
            revert SupplyRightNotEligible(sr.status);
        }
        if (sr.protectionId != 0) revert AlreadyProtected(sr.protectionId);
        if (supplyRights.ownerOf(r.supplyRightId) != r.buyer) revert NotBuyer();

        uint256 amount = r.coverageAmount;
        uint256 free = freeCollateral[msg.sender];
        if (free < amount) revert InsufficientFreeCollateral(free, amount);

        // Effects: commit collateral before any external call.
        freeCollateral[msg.sender] = free - amount;
        totalFreeCollateral -= amount;
        lockedCollateral[msg.sender] += amount;
        totalLockedCollateral += amount;

        protectionId = ++protectionCount;
        _protections[protectionId] = ProtectionPosition({
            supplyRightId: r.supplyRightId,
            requestId: requestId,
            provider: msg.sender,
            beneficiary: r.buyer,
            coverageAmount: amount,
            lockedAmount: amount,
            paidAmount: 0,
            releasedAmount: 0,
            coverageBps: r.coverageBps,
            startsAt: uint64(block.timestamp),
            expiresAt: r.expiresAt,
            claimOpen: false,
            status: ProtectionStatus.Active,
            termsHash: r.termsHash
        });
        r.status = RequestStatus.Approved;
        r.provider = msg.sender;
        r.protectionId = protectionId;
        r.decisionHash = decisionHash;
        r.decidedAt = uint64(block.timestamp);
        delete pendingRequestOf[r.supplyRightId];

        // Interactions with bound protocol contracts only.
        supplyRights.linkProtection(r.supplyRightId, protectionId);
        protectionNFT.mint(
            protectionId,
            ProtectionTerms({
                supplyRightId: r.supplyRightId,
                provider: msg.sender,
                beneficiary: r.buyer,
                coverageAmount: amount,
                coverageBps: r.coverageBps,
                startsAt: uint64(block.timestamp),
                expiresAt: r.expiresAt,
                termsHash: r.termsHash,
                escrowVault: address(this),
                escrowId: protectionId,
                claimStatus: ProtectionClaimStatus.NoClaim
            })
        );
        emit ProtectionActivated(protectionId, requestId, r.supplyRightId, msg.sender, r.buyer, amount, decisionHash);
    }

    function _checkApprover(ProtectionRequest storage r) private view {
        if (r.status != RequestStatus.Pending) revert RequestNotPending(r.status);
        if (r.provider != address(0) && r.provider != msg.sender) revert NotDesignatedProvider();
        if (msg.sender == r.buyer) revert SelfProtection();
    }

    function _page(uint256 fromId, uint256 count, uint256 last) private pure returns (uint256 start, uint256 n) {
        start = fromId == 0 ? 1 : fromId;
        if (start > last) return (start, 0);
        n = last - start + 1;
        if (n > count) n = count;
    }
}
