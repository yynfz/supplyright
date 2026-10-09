// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {RestrictedTransfer721} from "./base/RestrictedTransfer721.sol";
import {MetadataRenderer} from "./libraries/MetadataRenderer.sol";
import {RecoveryClaimData, RecoveryStatus} from "./SupplyTypes.sol";

/// @title RecoveryClaimNFT
/// @notice Digital record of an eligible recovery claim arising from a compensated supply failure.
///         Minted only by the bound SupplyClaimManager inside the atomic settlement transaction.
/// @dev The NFT does NOT by itself transfer legally enforceable debt. Subrogation or assignment of the
///      buyer's claim against the supplier must be supported by separate, valid agreements.
contract RecoveryClaimNFT is RestrictedTransfer721 {
    using Strings for uint256;

    address public claimManager;
    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => RecoveryClaimData) private _claims;

    event ClaimManagerBound(address indexed claimManager);
    event RecoveryClaimMinted(
        uint256 indexed tokenId,
        uint256 indexed claimId,
        uint256 indexed supplyRightId,
        address provider,
        uint256 compensationAmount,
        bytes32 settlementRef
    );
    event RecoveryUpdated(
        uint256 indexed tokenId,
        RecoveryStatus status,
        uint256 recoveredAmount,
        bytes32 updateHash,
        address indexed actor
    );

    error AlreadyBound();
    error NotClaimManager();
    error NotHolder();
    error InvalidRecoveryUpdate();

    constructor(address admin) RestrictedTransfer721("SupplyRight Recovery Claim", "SRRC", admin) {}

    function bindClaimManager(address claimManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (claimManager != address(0)) revert AlreadyBound();
        if (claimManager_ == address(0)) revert ZeroAddress();
        claimManager = claimManager_;
        emit ClaimManagerBound(claimManager_);
    }

    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /// @dev Uses `_mint` (not `_safeMint`) so a recipient contract cannot grief settlement by rejecting the NFT.
    function mintRecoveryClaim(address to, RecoveryClaimData calldata data) external returns (uint256 tokenId) {
        if (msg.sender != claimManager) revert NotClaimManager();
        if (to == address(0)) revert ZeroAddress();
        tokenId = _nextTokenId++;
        _claims[tokenId] = data;
        _mint(to, tokenId);
        emit RecoveryClaimMinted(
            tokenId, data.claimId, data.supplyRightId, data.provider, data.compensationAmount, data.settlementRef
        );
    }

    /// @notice Holder-reported recovery progress against the defaulting supplier (self-attested).
    function updateRecovery(uint256 tokenId, RecoveryStatus newStatus, uint256 recoveredAmount, bytes32 updateHash)
        external
    {
        if (ownerOf(tokenId) != msg.sender) revert NotHolder();
        RecoveryClaimData storage c = _claims[tokenId];
        RecoveryStatus cur = c.status;
        if (cur == RecoveryStatus.Recovered || cur == RecoveryStatus.WrittenOff) revert InvalidRecoveryUpdate();
        if (updateHash == bytes32(0) || newStatus == RecoveryStatus.Open) revert InvalidRecoveryUpdate();
        if (recoveredAmount < c.recoveredAmount || recoveredAmount > c.recoveryAmount) revert InvalidRecoveryUpdate();
        if (newStatus == RecoveryStatus.Recovered && recoveredAmount != c.recoveryAmount) revert InvalidRecoveryUpdate();
        if (newStatus == RecoveryStatus.PartiallyRecovered && (recoveredAmount == 0 || recoveredAmount == c.recoveryAmount))
        {
            revert InvalidRecoveryUpdate();
        }
        c.status = newStatus;
        c.recoveredAmount = recoveredAmount;
        c.lastUpdateHash = updateHash;
        emit RecoveryUpdated(tokenId, newStatus, recoveredAmount, updateHash, msg.sender);
    }

    function getRecoveryClaim(uint256 tokenId) external view returns (RecoveryClaimData memory) {
        _requireOwned(tokenId);
        return _claims[tokenId];
    }

    function getRecoveryClaims(uint256 fromId, uint256 count) external view returns (RecoveryClaimData[] memory out) {
        uint256 last = _nextTokenId - 1;
        if (fromId == 0) fromId = 1;
        if (fromId > last) return new RecoveryClaimData[](0);
        uint256 n = last - fromId + 1;
        if (n > count) n = count;
        out = new RecoveryClaimData[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _claims[fromId + i];
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        RecoveryClaimData storage c = _claims[tokenId];
        string memory id = tokenId.toString();
        string memory status = recoveryStatusName(c.status);
        string memory json = string.concat(
            '{"name":"SupplyRight Recovery Claim #',
            id,
            '","description":"Digital record of a recovery claim created by an atomic SupplyRight settlement. It does not by itself transfer legally enforceable debt; subrogation/assignment requires separate valid agreements. Testnet prototype.",',
            '"attributes":[{"trait_type":"Recovery Status","value":"',
            status,
            '"},{"trait_type":"Claim","value":"',
            c.claimId.toString(),
            '"},{"trait_type":"Supply Right","value":"',
            c.supplyRightId.toString(),
            '"},{"trait_type":"Settlement Ref","value":"',
            uint256(c.settlementRef).toHexString(32),
            '"}],"image":"',
            MetadataRenderer.badgeImage("Recovery Claim", id, status, "#F59E0B"),
            '"}'
        );
        return MetadataRenderer.jsonDataUri(json);
    }

    function recoveryStatusName(RecoveryStatus s) public pure returns (string memory) {
        if (s == RecoveryStatus.Open) return "Open";
        if (s == RecoveryStatus.InRecovery) return "In Recovery";
        if (s == RecoveryStatus.PartiallyRecovered) return "Partially Recovered";
        if (s == RecoveryStatus.Recovered) return "Recovered";
        return "Written Off";
    }
}
