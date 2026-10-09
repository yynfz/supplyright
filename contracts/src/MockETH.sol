// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockETH
/// @notice 18-decimal ERC-20 stand-in for Ether used as protection collateral and compensation in
///         Sepolia/local demos. It has NO monetary value, is not backed by ETH, and cannot be redeemed.
///         Anyone may mint a bounded amount from the faucet.
contract MockETH is ERC20 {
    uint256 public constant FAUCET_LIMIT = 1_000 ether;

    error FaucetLimitExceeded(uint256 requested, uint256 limit);

    constructor() ERC20("SupplyRight Mock ETH (Testnet - No Value)", "mETH") {}

    /// @notice Mint test tokens to the caller. Limited per call; testnet only.
    function faucet(uint256 amount) external {
        if (amount > FAUCET_LIMIT) revert FaucetLimitExceeded(amount, FAUCET_LIMIT);
        _mint(msg.sender, amount);
    }
}
