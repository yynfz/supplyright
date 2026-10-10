// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Code etched onto an account (vm.etch) so that it refuses incoming ETH, used to make the ETH leg of a
///      payout or withdrawal fail.
contract EtherRejecter {
    error Rejected();

    receive() external payable {
        revert Rejected();
    }
}
