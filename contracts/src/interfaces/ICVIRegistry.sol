// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICVIRegistry
 * @notice Interface for Cleanverse Verified Identity (CVI) Registry
 * @dev This interface represents the on-chain registry that stores user compliance attestations.
 * In production, this would be a Cleanverse-deployed contract. For testing, we use MockCVIRegistry.
 */
interface ICVIRegistry {
    /**
     * @notice Get the verification status of a wallet
     * @param wallet The wallet address to check
     * @return isVerified True if wallet has active, non-expired CVI attestation
     * @return tier The user's A-Pass tier (0-99)
     * @return subTier The user's A-Pass sub-tier (0-99)
     * @return group The user's A-Pass group (2-char)
     * @return subGroup The user's A-Pass sub-group (2-char)
     * @return countries Array of ISO 3166-1 alpha-2 country codes
     * @return expiry Unix timestamp when attestation expires
     */
    function getWalletStatus(address wallet)
        external
        view
        returns (
            bool isVerified,
            uint8 tier,
            uint8 subTier,
            string memory group,
            string memory subGroup,
            string[] memory countries,
            uint256 expiry
        );

    /**
     * @notice Check if a wallet is currently verified (convenience function)
     * @param wallet The wallet address to check
     * @return True if verified and not expired
     */
    function isVerified(address wallet) external view returns (bool);

    /**
     * @notice Get the A-Pass NFT token ID for a wallet (if registered)
     * @param wallet The wallet address
     * @return tokenId The A-Pass NFT token ID, 0 if not registered
     */
    function getApassTokenId(address wallet) external view returns (uint256);

    /**
     * @notice Batch register multiple wallets (for testing)
     * @param wallets Array of wallet addresses
     * @param tiers Array of tiers
     * @param expiries Array of expiry timestamps
     * @param tokenIds Array of token IDs
     */
    function batchRegister(
        address[] calldata wallets,
        uint8[] calldata tiers,
        uint256[] calldata expiries,
        uint256[] calldata tokenIds
    ) external;
}