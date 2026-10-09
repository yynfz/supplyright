// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @notice Minimal onchain metadata. Deliberately excludes commercial terms (prices, supplier identity,
///         purchase-order contents); only lifecycle state and document hashes are exposed.
library MetadataRenderer {
    function jsonDataUri(string memory json) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function badgeImage(string memory title, string memory idLabel, string memory statusText, string memory accent)
        internal
        pure
        returns (string memory)
    {
        string memory font = "font-family='Helvetica,Arial,sans-serif'";
        string memory svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>",
            "<rect width='400' height='400' fill='#0B1F3A'/>",
            "<rect x='24' y='24' width='352' height='352' rx='18' fill='none' stroke='",
            accent,
            "' stroke-width='2'/>",
            string.concat("<text x='48' y='84' fill='#FFFFFF' ", font, " font-size='22' font-weight='700'>SupplyRight</text>"),
            string.concat("<text x='48' y='114' fill='", accent, "' ", font, " font-size='16'>", title, "</text>"),
            string.concat("<text x='48' y='212' fill='#FFFFFF' ", font, " font-size='56' font-weight='700'>#", idLabel, "</text>"),
            string.concat("<text x='48' y='296' fill='#94A3B8' ", font, " font-size='13'>STATUS</text>"),
            string.concat("<text x='48' y='324' fill='#FFFFFF' ", font, " font-size='20'>", statusText, "</text>"),
            string.concat("<text x='48' y='356' fill='#64748B' ", font, " font-size='11'>Testnet record - no monetary value</text>"),
            "</svg>"
        );
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }
}
