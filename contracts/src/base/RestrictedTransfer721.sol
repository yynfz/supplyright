// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RestrictedTransfer721
/// @notice ERC-721 whose holder-to-holder transfers are blocked unless an authorized approver has
///         recorded a one-time transfer authorization for a specific recipient, referencing the hash of
///         the contractual assignment document. Minting and protocol-level flows are unaffected.
abstract contract RestrictedTransfer721 is ERC721, AccessControl {
    bytes32 public constant TRANSFER_APPROVER_ROLE = keccak256("TRANSFER_APPROVER_ROLE");

    struct TransferAuthorization {
        address recipient;
        bytes32 authorizationHash;
    }

    mapping(uint256 tokenId => TransferAuthorization) private _transferAuthorizations;

    event TransferAuthorized(
        uint256 indexed tokenId, address indexed recipient, bytes32 authorizationHash, address indexed approver
    );
    event TransferAuthorizationRevoked(uint256 indexed tokenId, address indexed approver);

    error TransferNotAuthorized(uint256 tokenId, address to);
    error InvalidAuthorization();
    error ZeroAddress();

    constructor(string memory name_, string memory symbol_, address admin) ERC721(name_, symbol_) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Authorize the current holder to transfer `tokenId` to `recipient` exactly once.
    /// @param authorizationHash Hash of the signed assignment / transfer agreement.
    function authorizeTransfer(uint256 tokenId, address recipient, bytes32 authorizationHash)
        external
        onlyRole(TRANSFER_APPROVER_ROLE)
    {
        _requireOwned(tokenId);
        if (recipient == address(0) || authorizationHash == bytes32(0)) revert InvalidAuthorization();
        _transferAuthorizations[tokenId] = TransferAuthorization(recipient, authorizationHash);
        emit TransferAuthorized(tokenId, recipient, authorizationHash, msg.sender);
    }

    function revokeTransferAuthorization(uint256 tokenId) external onlyRole(TRANSFER_APPROVER_ROLE) {
        delete _transferAuthorizations[tokenId];
        emit TransferAuthorizationRevoked(tokenId, msg.sender);
    }

    function transferAuthorizationOf(uint256 tokenId) external view returns (TransferAuthorization memory) {
        return _transferAuthorizations[tokenId];
    }

    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            if (_transferAuthorizations[tokenId].recipient != to) revert TransferNotAuthorized(tokenId, to);
            delete _transferAuthorizations[tokenId];
        }
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
