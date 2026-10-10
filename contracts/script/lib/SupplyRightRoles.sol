// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SupplyRightNFT} from "../../src/SupplyRightNFT.sol";
import {ProtectionNFT} from "../../src/ProtectionNFT.sol";
import {RecoveryClaimNFT} from "../../src/RecoveryClaimNFT.sol";
import {SupplyProtectionVault} from "../../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../../src/SupplyClaimManager.sol";

/// @notice The four-wallet role matrix, shared by Deploy, SetupRoles and the Foundry tests so the matrix
///         that is tested is exactly the one assigned on Sepolia.
///
///         admin     SupplyRightNFT: DEFAULT_ADMIN, REGISTRAR, TRANSFER_APPROVER
///                   RecoveryClaimNFT: DEFAULT_ADMIN, TRANSFER_APPROVER
///                   ProtectionNFT, SupplyProtectionVault, SupplyClaimManager: DEFAULT_ADMIN
///         buyer     SupplyRightNFT: BUYER
///         provider  SupplyProtectionVault: PROVIDER
///         verifier  SupplyClaimManager: VERIFIER
///
///         Every permission is enforced by the contracts themselves (OpenZeppelin AccessControl plus the
///         buyer/beneficiary/provider checks in the vault and claim manager).
library SupplyRightRoles {
    struct Protocol {
        SupplyRightNFT rights;
        ProtectionNFT protection;
        RecoveryClaimNFT recovery;
        SupplyProtectionVault vault;
        SupplyClaimManager claims;
    }

    struct Wallets {
        address admin;
        address buyer;
        address provider;
        address verifier;
    }

    error InvalidRoleWallets();

    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    /// @dev The four role wallets must be set and pairwise distinct (one key per role).
    function validate(Wallets memory w) internal pure {
        address[4] memory a = [w.admin, w.buyer, w.provider, w.verifier];
        for (uint256 i = 0; i < 4; i++) {
            if (a[i] == address(0)) revert InvalidRoleWallets();
            for (uint256 j = i + 1; j < 4; j++) {
                if (a[i] == a[j]) revert InvalidRoleWallets();
            }
        }
    }

    /// @notice Grant the matrix, skipping roles already held. The caller must hold DEFAULT_ADMIN_ROLE on
    ///         all five contracts. Returns the number of grant transactions sent.
    function grant(Protocol memory p, Wallets memory w) internal returns (uint256 sent) {
        validate(w);
        sent += _grant(address(p.rights), p.rights.BUYER_ROLE(), w.buyer);
        sent += _grant(address(p.vault), p.vault.PROVIDER_ROLE(), w.provider);
        sent += _grant(address(p.claims), p.claims.VERIFIER_ROLE(), w.verifier);
        sent += _grant(address(p.rights), p.rights.REGISTRAR_ROLE(), w.admin);
        sent += _grant(address(p.rights), p.rights.TRANSFER_APPROVER_ROLE(), w.admin);
        sent += _grant(address(p.recovery), p.recovery.TRANSFER_APPROVER_ROLE(), w.admin);
        sent += _grant(address(p.rights), DEFAULT_ADMIN_ROLE, w.admin);
        sent += _grant(address(p.protection), DEFAULT_ADMIN_ROLE, w.admin);
        sent += _grant(address(p.recovery), DEFAULT_ADMIN_ROLE, w.admin);
        sent += _grant(address(p.vault), DEFAULT_ADMIN_ROLE, w.admin);
        sent += _grant(address(p.claims), DEFAULT_ADMIN_ROLE, w.admin);
    }

    /// @notice Read the live role state and list every deviation from the matrix: a missing expected role,
    ///         or a role wallet holding a privilege that belongs to another role. Empty = matrix holds.
    function problems(Protocol memory p, Wallets memory w) internal view returns (string[] memory out) {
        out = new string[](48);
        uint256 n;
        bytes32 buyerRole = p.rights.BUYER_ROLE();
        bytes32 registrarRole = p.rights.REGISTRAR_ROLE();
        bytes32 approverRole = p.rights.TRANSFER_APPROVER_ROLE();
        bytes32 providerRole = p.vault.PROVIDER_ROLE();
        bytes32 verifierRole = p.claims.VERIFIER_ROLE();

        // Expected grants.
        n = _expect(out, n, address(p.rights), buyerRole, w.buyer, true, "buyer: SupplyRightNFT.BUYER_ROLE");
        n = _expect(out, n, address(p.vault), providerRole, w.provider, true, "provider: Vault.PROVIDER_ROLE");
        n = _expect(out, n, address(p.claims), verifierRole, w.verifier, true, "verifier: ClaimManager.VERIFIER_ROLE");
        n = _expect(out, n, address(p.rights), registrarRole, w.admin, true, "admin: SupplyRightNFT.REGISTRAR_ROLE");
        n = _expect(out, n, address(p.rights), approverRole, w.admin, true, "admin: SupplyRightNFT.TRANSFER_APPROVER");
        n = _expect(out, n, address(p.recovery), approverRole, w.admin, true, "admin: RecoveryNFT.TRANSFER_APPROVER");
        n = _expectAdmin(out, n, p, w.admin, true, "admin");

        // Separation of duties: no role wallet holds another role's privileges.
        address[3] memory nonAdmins = [w.buyer, w.provider, w.verifier];
        string[3] memory names = ["buyer", "provider", "verifier"];
        for (uint256 i = 0; i < 3; i++) {
            address a = nonAdmins[i];
            string memory who = names[i];
            if (a != w.buyer) {
                n = _expect(out, n, address(p.rights), buyerRole, a, false, string.concat(who, ": BUYER_ROLE"));
            }
            if (a != w.provider) {
                n = _expect(out, n, address(p.vault), providerRole, a, false, string.concat(who, ": PROVIDER_ROLE"));
            }
            if (a != w.verifier) {
                n = _expect(out, n, address(p.claims), verifierRole, a, false, string.concat(who, ": VERIFIER_ROLE"));
            }
            n = _expect(out, n, address(p.rights), registrarRole, a, false, string.concat(who, ": REGISTRAR_ROLE"));
            n = _expect(out, n, address(p.rights), approverRole, a, false, string.concat(who, ": TRANSFER_APPROVER"));
            n = _expect(out, n, address(p.recovery), approverRole, a, false, string.concat(who, ": TRANSFER_APPROVER"));
            n = _expectAdmin(out, n, p, a, false, who);
        }
        n = _expect(out, n, address(p.rights), buyerRole, w.admin, false, "admin: BUYER_ROLE");
        n = _expect(out, n, address(p.vault), providerRole, w.admin, false, "admin: PROVIDER_ROLE");
        n = _expect(out, n, address(p.claims), verifierRole, w.admin, false, "admin: VERIFIER_ROLE");

        assembly ("memory-safe") {
            mstore(out, n)
        }
    }

    function _grant(address c, bytes32 role, address account) private returns (uint256) {
        if (IAccessControl(c).hasRole(role, account)) return 0;
        IAccessControl(c).grantRole(role, account);
        return 1;
    }

    function _expectAdmin(string[] memory out, uint256 n, Protocol memory p, address a, bool want, string memory who)
        private
        view
        returns (uint256)
    {
        string memory suffix = ": DEFAULT_ADMIN_ROLE on ";
        n = _expect(out, n, address(p.rights), DEFAULT_ADMIN_ROLE, a, want, string.concat(who, suffix, "SupplyRightNFT"));
        n = _expect(out, n, address(p.protection), DEFAULT_ADMIN_ROLE, a, want, string.concat(who, suffix, "ProtectionNFT"));
        n = _expect(out, n, address(p.recovery), DEFAULT_ADMIN_ROLE, a, want, string.concat(who, suffix, "RecoveryNFT"));
        n = _expect(out, n, address(p.vault), DEFAULT_ADMIN_ROLE, a, want, string.concat(who, suffix, "Vault"));
        n = _expect(out, n, address(p.claims), DEFAULT_ADMIN_ROLE, a, want, string.concat(who, suffix, "ClaimManager"));
        return n;
    }

    function _expect(
        string[] memory out,
        uint256 n,
        address c,
        bytes32 role,
        address account,
        bool want,
        string memory label
    ) private view returns (uint256) {
        if (IAccessControl(c).hasRole(role, account) == want) return n;
        out[n] = want ? string.concat("missing ", label) : string.concat("forbidden ", label);
        return n + 1;
    }
}
