// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    SupplyStatus,
    SupplyRightData,
    ProtectionPosition,
    ProtectionTerms,
    ProtectionClaimStatus,
    RecoveryClaimData
} from "../SupplyTypes.sol";

interface ISupplyRightNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getSupplyRight(uint256 tokenId) external view returns (SupplyRightData memory);
    function undeliveredValue(uint256 tokenId, uint256 deliveredQuantity) external view returns (uint256);
    function linkProtection(uint256 tokenId, uint256 protectionId) external;
    function setStatusByProtocol(uint256 tokenId, SupplyStatus newStatus, bytes32 reasonHash) external;
    function recordDelivery(uint256 tokenId, uint256 deliveredQuantity, bytes32 evidenceHash) external;
}

interface IProtectionNFT {
    function mint(uint256 tokenId, ProtectionTerms calldata terms) external;
    function setClaimStatus(uint256 tokenId, ProtectionClaimStatus status) external;
}

interface IRecoveryClaimNFT {
    function nextTokenId() external view returns (uint256);
    function mintRecoveryClaim(address to, RecoveryClaimData calldata data) external returns (uint256);
}

interface ISupplyProtectionVault {
    function getProtection(uint256 protectionId) external view returns (ProtectionPosition memory);
    function quotePayout(uint256 protectionId, uint256 eligibleLoss) external view returns (uint256);
    function openClaim(uint256 protectionId, bool enforceValidity) external;
    function setClaimStage(uint256 protectionId, ProtectionClaimStatus stage) external;
    function closeClaim(uint256 protectionId) external;
    function executePayout(uint256 protectionId, uint256 amount) external returns (address beneficiary);
}

/// @notice Implemented by the claim manager so the vault and registry can block releases/closures
///         while a claim is open or a rejection can still be appealed.
interface IClaimReleaseGuard {
    function isReleaseBlocked(uint256 protectionId) external view returns (bool);
}
