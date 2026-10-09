// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {MetadataRenderer} from "./libraries/MetadataRenderer.sol";
import {ProtectionTerms, ProtectionClaimStatus} from "./SupplyTypes.sol";

/// @title ProtectionNFT
/// @notice Non-transferable ERC-721 evidencing a beneficiary's entitlement under a specific funded
///         protection agreement. Minted only by the bound SupplyProtectionVault, and only in the same
///         transaction that locks the full coverage amount as collateral. Token id == vault escrow id.
contract ProtectionNFT is ERC721, AccessControl {
    using Strings for uint256;

    address public vault;
    uint256 public totalMinted;
    mapping(uint256 tokenId => ProtectionTerms) private _terms;

    event VaultBound(address indexed vault);
    event ProtectionMinted(
        uint256 indexed tokenId,
        uint256 indexed supplyRightId,
        address indexed beneficiary,
        address provider,
        uint256 coverageAmount,
        uint16 coverageBps,
        uint64 expiresAt
    );
    event ProtectionClaimStatusChanged(uint256 indexed tokenId, ProtectionClaimStatus status);

    error AlreadyBound();
    error ZeroAddress();
    error NotVault();
    error NonTransferable();

    constructor(address admin) ERC721("SupplyRight Protection", "SRPT") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    function bindVault(address vault_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault != address(0)) revert AlreadyBound();
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        emit VaultBound(vault_);
    }

    function mint(uint256 tokenId, ProtectionTerms calldata terms) external onlyVault {
        _terms[tokenId] = terms;
        totalMinted++;
        _mint(terms.beneficiary, tokenId);
        emit ProtectionMinted(
            tokenId,
            terms.supplyRightId,
            terms.beneficiary,
            terms.provider,
            terms.coverageAmount,
            terms.coverageBps,
            terms.expiresAt
        );
    }

    function setClaimStatus(uint256 tokenId, ProtectionClaimStatus status) external onlyVault {
        _requireOwned(tokenId);
        _terms[tokenId].claimStatus = status;
        emit ProtectionClaimStatusChanged(tokenId, status);
    }

    function getTerms(uint256 tokenId) external view returns (ProtectionTerms memory) {
        _requireOwned(tokenId);
        return _terms[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        ProtectionTerms storage t = _terms[tokenId];
        string memory id = tokenId.toString();
        string memory status = claimStatusName(t.claimStatus);
        string memory json = string.concat(
            '{"name":"SupplyRight Protection #',
            id,
            '","description":"Non-transferable record of a funded supply-protection entitlement. Collateral is held by the SupplyRight vault. Testnet prototype; not an insurance policy.",',
            '"attributes":[{"trait_type":"Claim Status","value":"',
            status,
            '"},{"trait_type":"Supply Right","value":"',
            t.supplyRightId.toString(),
            '"},{"trait_type":"Coverage (bps)","display_type":"number","value":',
            uint256(t.coverageBps).toString(),
            '},{"trait_type":"Expires","display_type":"date","value":',
            uint256(t.expiresAt).toString(),
            '}],"image":"',
            MetadataRenderer.badgeImage("Protection", id, status, "#38BDF8"),
            '"}'
        );
        return MetadataRenderer.jsonDataUri(json);
    }

    function claimStatusName(ProtectionClaimStatus s) public pure returns (string memory) {
        if (s == ProtectionClaimStatus.NoClaim) return "No Claim";
        if (s == ProtectionClaimStatus.ClaimPending) return "Claim Pending";
        if (s == ProtectionClaimStatus.ClaimApproved) return "Claim Approved";
        if (s == ProtectionClaimStatus.Disputed) return "Disputed";
        if (s == ProtectionClaimStatus.PartiallyPaid) return "Partially Paid";
        if (s == ProtectionClaimStatus.Exhausted) return "Exhausted";
        return "Released";
    }

    /// @dev Protection entitlements cannot move between holders.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert NonTransferable();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
