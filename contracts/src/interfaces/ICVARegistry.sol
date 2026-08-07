// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICVARegistry
 * @notice Interface for Cleanverse Verified Assets (CVA) Registry
 * @dev This interface represents the on-chain registry that stores verified asset information.
 * In production, this would be a Cleanverse-deployed contract. For testing, we use MockCVARegistry.
 */
interface ICVARegistry {
    /**
     * @notice Check if a token is a verified Cleanverse asset (A-Token)
     * @param token The token contract address
     * @return isVerified True if token is a verified A-Token
     * @return originToken The underlying/origin token address (e.g., native USDC)
     * @return tokenSymbol The A-Token symbol (e.g., "ausdc")
     * @return tokenName The A-Token name (e.g., "Aave USDC")
     * @return decimals Token decimals
     * @return isWrapped True if this is a Wrapped A-Token
     * @return accessCore Address of the AccessCore contract for this token
     * @return apass Address of the A-Pass NFT contract
     */
    function getAssetInfo(address token)
        external
        view
        returns (
            bool isVerified,
            address originToken,
            string memory tokenSymbol,
            string memory tokenName,
            uint8 decimals,
            bool isWrapped,
            address accessCore,
            address apass
        );

    /**
     * @notice Register a verified asset (A-Token)
     * @param token The A-Token contract address
     * @param originToken The underlying/origin token address
     * @param tokenSymbol The A-Token symbol (e.g., "ausdc")
     * @param tokenName The A-Token name (e.g., "Aave USDC")
     * @param decimals Token decimals
     * @param isWrapped True if this is a Wrapped A-Token
     * @param accessCore Address of the AccessCore contract
     * @param apass Address of the A-Pass NFT contract
     */
    function registerAsset(
        address token,
        address originToken,
        string calldata tokenSymbol,
        string calldata tokenName,
        uint8 decimals,
        bool isWrapped,
        address accessCore,
        address apass
    ) external;

    /**
     * @notice Remove a verified asset
     * @param token The A-Token contract address
     */
    function removeAsset(address token) external;

    /**
     * @notice Update asset verification status
     * @param token The token address
     * @param isVerified New verification status
     */
    function setVerified(address token, bool isVerified) external;

    /**
     * @notice Convenience check if token is a verified CVA asset
     * @param token The token contract address
     * @return True if verified
     */
    function isVerifiedAsset(address token) external view returns (bool);

    /**
     * @notice Get all verified assets for a given chain
     * @return tokens Array of verified token addresses
     */
    function getVerifiedAssets() external view returns (address[] memory);

    /**
     * @notice Batch register common test assets
     * @param tokens Array of A-Token addresses
     * @param originTokens Array of origin token addresses
     * @param symbols Array of symbols
     * @param names Array of names
     * @param decimals Array of decimals
     * @param wrappedFlags Array of isWrapped flags
     */
    function batchRegister(
        address[] calldata tokens,
        address[] calldata originTokens,
        string[] calldata symbols,
        string[] calldata names,
        uint8[] calldata decimals,
        bool[] calldata wrappedFlags
    ) external;
}