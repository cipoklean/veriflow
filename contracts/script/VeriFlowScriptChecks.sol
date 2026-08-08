// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VeriFlowScriptChecks
 * @notice Shared deploy/bootstrap safety checks.
 *
 * NEW-14: feeToSetter must NEVER be one of the 10 well-known Anvil default
 * accounts (the `anvil` CLI derives them from the public test mnemonic
 * "test test test test test test test test test test test junk"). If a deploy
 * or bootstrap accidentally leaves feeToSetter on such a key (e.g. because
 * FEE_TO_SETTER was unset and the script fell back to a hardcoded anvil
 * address), the assertion reverts the whole script before anything is
 * broadcast.
 */
library VeriFlowScriptChecks {
    /// @dev The 10 well-known Anvil default accounts (index 0..9).
    function anvilDefaultAccounts() internal pure returns (address[10] memory accounts) {
        accounts = [
            address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266),
            address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8),
            address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC),
            address(0x90F79bf6EB2c4f870365E785982E1f101E93b906),
            address(0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65),
            address(0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc),
            address(0x976EA74026E726554dB657fA54763abd0C3a0aa9),
            address(0x14dC79964da2C08b23698B3D3cc7Ca32193d9955),
            address(0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f),
            address(0xa0Ee7A142d267C1f36714E4a8F75612F20a79720)
        ];
    }

    /**
     * @dev Reverts if `addr` is any of the 10 well-known Anvil default accounts.
     */
    function assertNotAnvilDefault(address addr) internal pure {
        address[10] memory accounts = anvilDefaultAccounts();
        for (uint256 i = 0; i < accounts.length; i++) {
            require(addr != accounts[i], "FEE_TO_SETTER must not be an Anvil default account");
        }
    }
}
