// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {RestrictedTransfer721} from "./base/RestrictedTransfer721.sol";
import {MetadataRenderer} from "./libraries/MetadataRenderer.sol";
import {SupplyStatus, SupplyRightData} from "./SupplyTypes.sol";
import {IClaimReleaseGuard} from "./interfaces/ISupplyRightProtocol.sol";

/// @title SupplyRightNFT
/// @notice ERC-721 record of a verified commercial supply right (a buyer's right to receive contracted
///         goods). Only hashes and the minimum economic terms needed for claim accounting are stored
///         onchain; purchase orders, supplier identity and pricing documents stay offchain.
/// @dev The token is a digital representation only. Legal enforceability depends on the underlying
///      signed agreement that `agreementHash` references.
contract SupplyRightNFT is RestrictedTransfer721 {
    using Strings for uint256;

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant BUYER_ROLE = keccak256("BUYER_ROLE");

    struct MintParams {
        address buyer;
        bytes32 poRefHash;
        bytes32 agreementHash;
        bytes32 supplierRefHash;
        uint256 contractValue;
        uint256 orderedQuantity;
        uint64 deliveryDeadline;
        bytes8 unit;
    }

    /// @notice Protocol contracts allowed to drive lifecycle transitions. Bound exactly once.
    address public vault;
    address public claimManager;

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => SupplyRightData) private _rights;
    mapping(bytes32 poRefHash => uint256 tokenId) public tokenIdByPoRef;

    event ProtocolBound(address indexed vault, address indexed claimManager);
    event SupplyRightMinted(
        uint256 indexed tokenId,
        address indexed buyer,
        bytes32 indexed poRefHash,
        bytes32 agreementHash,
        bytes32 supplierRefHash,
        uint256 contractValue,
        uint256 orderedQuantity,
        uint64 deliveryDeadline,
        address registrar
    );
    event SupplyRightStatusChanged(
        uint256 indexed tokenId, SupplyStatus from, SupplyStatus to, bytes32 reasonHash, address indexed actor
    );
    event SupplierAcknowledged(uint256 indexed tokenId, bytes32 supplierAckHash, address indexed registrar);
    event DeliveryRecorded(
        uint256 indexed tokenId, uint256 deliveredQuantity, bytes32 evidenceHash, address indexed actor
    );
    event ProtectionLinked(uint256 indexed tokenId, uint256 indexed protectionId);

    error AlreadyBound();
    error NotProtocol();
    error InvalidParams();
    error BuyerNotAuthorized(address buyer);
    error DuplicatePurchaseOrder(uint256 existingTokenId);
    error InvalidStatus(SupplyStatus current);
    error InvalidTransition(SupplyStatus from, SupplyStatus to);
    error InvalidQuantity();
    error AlreadyProtected(uint256 protectionId);
    error ClaimActivityPending();

    constructor(address admin) RestrictedTransfer721("SupplyRight Supply Right", "SRSR", admin) {}

    // ---------------------------------------------------------------------
    // Admin wiring
    // ---------------------------------------------------------------------

    /// @notice One-time binding of the vault and claim manager. Cannot be changed afterwards, so the
    ///         admin cannot later point lifecycle control at an arbitrary address.
    function bindProtocol(address vault_, address claimManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault != address(0) || claimManager != address(0)) revert AlreadyBound();
        if (vault_ == address(0) || claimManager_ == address(0)) revert ZeroAddress();
        vault = vault_;
        claimManager = claimManager_;
        emit ProtocolBound(vault_, claimManager_);
    }

    // ---------------------------------------------------------------------
    // Registrar actions
    // ---------------------------------------------------------------------

    /// @notice Mint a supply right after the registrar has verified the agreement documents offchain.
    function mintSupplyRight(MintParams calldata p) external onlyRole(REGISTRAR_ROLE) returns (uint256 tokenId) {
        if (p.buyer == address(0)) revert ZeroAddress();
        if (!hasRole(BUYER_ROLE, p.buyer)) revert BuyerNotAuthorized(p.buyer);
        if (
            p.poRefHash == bytes32(0) || p.agreementHash == bytes32(0) || p.supplierRefHash == bytes32(0)
                || p.contractValue == 0 || p.orderedQuantity == 0 || p.deliveryDeadline <= block.timestamp
        ) revert InvalidParams();
        uint256 existing = tokenIdByPoRef[p.poRefHash];
        if (existing != 0) revert DuplicatePurchaseOrder(existing);

        tokenId = _nextTokenId++;
        _rights[tokenId] = SupplyRightData({
            buyer: p.buyer,
            deliveryDeadline: p.deliveryDeadline,
            registeredAt: uint64(block.timestamp),
            status: SupplyStatus.Registered,
            unit: p.unit,
            poRefHash: p.poRefHash,
            agreementHash: p.agreementHash,
            supplierRefHash: p.supplierRefHash,
            supplierAckHash: bytes32(0),
            contractValue: p.contractValue,
            orderedQuantity: p.orderedQuantity,
            deliveredQuantity: 0,
            protectionId: 0
        });
        tokenIdByPoRef[p.poRefHash] = tokenId;

        _mint(p.buyer, tokenId);
        emit SupplyRightMinted(
            tokenId,
            p.buyer,
            p.poRefHash,
            p.agreementHash,
            p.supplierRefHash,
            p.contractValue,
            p.orderedQuantity,
            p.deliveryDeadline,
            msg.sender
        );
    }

    /// @notice Record the supplier's acknowledgement of the order and start the delivery obligation.
    function activate(uint256 tokenId, bytes32 supplierAckHash) external onlyRole(REGISTRAR_ROLE) {
        SupplyRightData storage r = _existing(tokenId);
        if (r.status != SupplyStatus.Registered) revert InvalidStatus(r.status);
        if (supplierAckHash == bytes32(0)) revert InvalidParams();
        r.supplierAckHash = supplierAckHash;
        emit SupplierAcknowledged(tokenId, supplierAckHash, msg.sender);
        _setStatus(tokenId, r, SupplyStatus.Active, supplierAckHash);
    }

    /// @notice Record verified cumulative delivered quantity (monotonic).
    function recordDelivery(uint256 tokenId, uint256 deliveredQuantity, bytes32 evidenceHash) external {
        if (msg.sender != claimManager && !hasRole(REGISTRAR_ROLE, msg.sender)) revert NotProtocol();
        SupplyRightData storage r = _existing(tokenId);
        if (
            r.status != SupplyStatus.Active && r.status != SupplyStatus.UnderAssessment
                && r.status != SupplyStatus.Defaulted
        ) revert InvalidStatus(r.status);
        if (deliveredQuantity < r.deliveredQuantity || deliveredQuantity > r.orderedQuantity) revert InvalidQuantity();
        if (evidenceHash == bytes32(0)) revert InvalidParams();
        r.deliveredQuantity = deliveredQuantity;
        emit DeliveryRecorded(tokenId, deliveredQuantity, evidenceHash, msg.sender);
    }

    /// @notice Confirm complete delivery. Only possible while no claim is under assessment.
    function markFulfilled(uint256 tokenId, bytes32 evidenceHash) external onlyRole(REGISTRAR_ROLE) {
        SupplyRightData storage r = _existing(tokenId);
        if (r.status != SupplyStatus.Active) revert InvalidStatus(r.status);
        if (evidenceHash == bytes32(0)) revert InvalidParams();
        r.deliveredQuantity = r.orderedQuantity;
        emit DeliveryRecorded(tokenId, r.orderedQuantity, evidenceHash, msg.sender);
        _setStatus(tokenId, r, SupplyStatus.Fulfilled, evidenceHash);
    }

    /// @notice Final closure. Allowed from Registered (cancelled before activation), Fulfilled or Defaulted,
    ///         and only when no claim is open and no rejection is still appealable.
    function close(uint256 tokenId, bytes32 reasonHash) external onlyRole(REGISTRAR_ROLE) {
        SupplyRightData storage r = _existing(tokenId);
        if (
            r.status != SupplyStatus.Registered && r.status != SupplyStatus.Fulfilled
                && r.status != SupplyStatus.Defaulted
        ) revert InvalidStatus(r.status);
        if (reasonHash == bytes32(0)) revert InvalidParams();
        if (r.protectionId != 0 && claimManager != address(0)) {
            if (IClaimReleaseGuard(claimManager).isReleaseBlocked(r.protectionId)) revert ClaimActivityPending();
        }
        _setStatus(tokenId, r, SupplyStatus.Closed, reasonHash);
    }

    // ---------------------------------------------------------------------
    // Protocol hooks
    // ---------------------------------------------------------------------

    function linkProtection(uint256 tokenId, uint256 protectionId) external {
        if (msg.sender != vault) revert NotProtocol();
        SupplyRightData storage r = _existing(tokenId);
        if (r.protectionId != 0) revert AlreadyProtected(r.protectionId);
        if (r.status != SupplyStatus.Registered && r.status != SupplyStatus.Active) revert InvalidStatus(r.status);
        r.protectionId = protectionId;
        emit ProtectionLinked(tokenId, protectionId);
    }

    /// @notice Claim-driven transitions. Only the bound claim manager may call this.
    function setStatusByProtocol(uint256 tokenId, SupplyStatus newStatus, bytes32 reasonHash) external {
        if (msg.sender != claimManager) revert NotProtocol();
        SupplyRightData storage r = _existing(tokenId);
        SupplyStatus from = r.status;
        bool allowed = (
            newStatus == SupplyStatus.UnderAssessment
                && (from == SupplyStatus.Active || from == SupplyStatus.Defaulted)
        )
            || (
                from == SupplyStatus.UnderAssessment
                    && (newStatus == SupplyStatus.Active || newStatus == SupplyStatus.Defaulted)
            );
        if (!allowed) revert InvalidTransition(from, newStatus);
        _setStatus(tokenId, r, newStatus, reasonHash);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function getSupplyRight(uint256 tokenId) external view returns (SupplyRightData memory) {
        _requireOwned(tokenId);
        return _rights[tokenId];
    }

    /// @notice Paged read of supply rights (1-based ids).
    function getSupplyRights(uint256 fromId, uint256 count) external view returns (SupplyRightData[] memory out) {
        uint256 last = _nextTokenId - 1;
        if (fromId == 0) fromId = 1;
        if (fromId > last) return new SupplyRightData[](0);
        uint256 n = last - fromId + 1;
        if (n > count) n = count;
        out = new SupplyRightData[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _rights[fromId + i];
        }
    }

    /// @notice Contract value attributable to the quantity not yet delivered.
    function undeliveredValue(uint256 tokenId, uint256 deliveredQuantity) public view returns (uint256) {
        SupplyRightData storage r = _rights[tokenId];
        if (r.orderedQuantity == 0 || deliveredQuantity >= r.orderedQuantity) return 0;
        return ((r.orderedQuantity - deliveredQuantity) * r.contractValue) / r.orderedQuantity;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        SupplyRightData storage r = _rights[tokenId];
        string memory status = statusName(r.status);
        string memory id = tokenId.toString();
        string memory json = string.concat(
            '{"name":"SupplyRight Supply Right #',
            id,
            '","description":"Digital record of a registrar-verified supply right. Commercial terms remain offchain; this token references document hashes only. Enforceability depends on the underlying signed agreement. Testnet prototype.",',
            '"attributes":[{"trait_type":"Status","value":"',
            status,
            '"},{"trait_type":"Delivery Deadline","display_type":"date","value":',
            uint256(r.deliveryDeadline).toString(),
            '},{"trait_type":"Protected","value":"',
            r.protectionId == 0 ? "No" : "Yes",
            '"},{"trait_type":"Agreement Hash","value":"',
            uint256(r.agreementHash).toHexString(32),
            '"}],"image":"',
            MetadataRenderer.badgeImage("Supply Right", id, status, "#2DD4BF"),
            '"}'
        );
        return MetadataRenderer.jsonDataUri(json);
    }

    function statusName(SupplyStatus s) public pure returns (string memory) {
        if (s == SupplyStatus.Registered) return "Registered";
        if (s == SupplyStatus.Active) return "Active";
        if (s == SupplyStatus.Fulfilled) return "Fulfilled";
        if (s == SupplyStatus.UnderAssessment) return "Under Assessment";
        if (s == SupplyStatus.Defaulted) return "Defaulted";
        return "Closed";
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _existing(uint256 tokenId) private view returns (SupplyRightData storage r) {
        _requireOwned(tokenId);
        r = _rights[tokenId];
    }

    function _setStatus(uint256 tokenId, SupplyRightData storage r, SupplyStatus to, bytes32 reasonHash) private {
        SupplyStatus from = r.status;
        r.status = to;
        emit SupplyRightStatusChanged(tokenId, from, to, reasonHash, msg.sender);
    }
}
