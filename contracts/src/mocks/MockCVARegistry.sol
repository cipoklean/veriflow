// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICVARegistry} from "../interfaces/ICVARegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockCVARegistry
 * @notice Mock implementation of CVA Registry for local testing
 * @dev Simulates Cleanverse Verified Assets on-chain registry.
 * In production, this would be replaced by the actual Cleanverse CVA Registry contract.
 */
contract MockCVARegistry is ICVARegistry, Ownable {
    struct AssetInfo {
        bool isVerified;
        address originToken;
        string tokenSymbol;
        string tokenName;
        uint8 decimals;
        bool isWrapped;
        address accessCore;
        address apass;
    }

    mapping(address => AssetInfo) public assetInfos;
    address[] public verifiedAssets;
    mapping(address => address) public originToAToken;

    event AssetRegistered(address indexed token, address indexed originToken, string symbol, bool isWrapped);
    event AssetRemoved(address indexed token);

    constructor() Ownable(msg.sender) {}

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
    ) external override onlyOwner {
        require(!assetInfos[token].isVerified, "Already registered");

        assetInfos[token] = AssetInfo({
            isVerified: true,
            originToken: originToken,
            tokenSymbol: tokenSymbol,
            tokenName: tokenName,
            decimals: decimals,
            isWrapped: isWrapped,
            accessCore: accessCore,
            apass: apass
        });

        verifiedAssets.push(token);
        originToAToken[originToken] = token;

        emit AssetRegistered(token, originToken, tokenSymbol, isWrapped);
    }

    /**
     * @notice Remove a verified asset
     * @param token The A-Token contract address
     */
    function removeAsset(address token) external override onlyOwner {
        require(assetInfos[token].isVerified, "Not registered");

        address originToken = assetInfos[token].originToken;
        delete assetInfos[token];
        delete originToAToken[originToken];

        // Remove from verifiedAssets array (swap with last)
        for (uint256 i = 0; i < verifiedAssets.length; i++) {
            if (verifiedAssets[i] == token) {
                verifiedAssets[i] = verifiedAssets[verifiedAssets.length - 1];
                verifiedAssets.pop();
                break;
            }
        }

        emit AssetRemoved(token);
    }

    /**
     * @notice Update asset verification status
     * @param token The token address
     * @param isVerified New verification status
     */
    function setVerified(address token, bool isVerified) external override onlyOwner {
        assetInfos[token].isVerified = isVerified;
    }

    function getAssetInfo(address token)
        external
        view
        override
        returns (
            bool isVerified,
            address originToken,
            string memory tokenSymbol,
            string memory tokenName,
            uint8 decimals,
            bool isWrapped,
            address accessCore,
            address apass
        )
    {
        AssetInfo storage info = assetInfos[token];
        return (
            info.isVerified,
            info.originToken,
            info.tokenSymbol,
            info.tokenName,
            info.decimals,
            info.isWrapped,
            info.accessCore,
            info.apass
        );
    }

    function isVerifiedAsset(address token) external view override returns (bool) {
        return assetInfos[token].isVerified;
    }

    function getVerifiedAssets() external view override returns (address[] memory) {
        return verifiedAssets;
    }

    function getATokenForOrigin(address originToken) external view returns (address) {
        return originToAToken[originToken];
    }

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
    ) external override onlyOwner {
        require(tokens.length == originTokens.length, "Length mismatch");
        require(tokens.length == symbols.length, "Length mismatch");
        require(tokens.length == names.length, "Length mismatch");
        require(tokens.length == decimals.length, "Length mismatch");
        require(tokens.length == wrappedFlags.length, "Length mismatch");

        for (uint256 i = 0; i < tokens.length; i++) {
            this.registerAsset(
                tokens[i],
                originTokens[i],
                symbols[i],
                names[i],
                decimals[i],
                wrappedFlags[i],
                address(0),
                address(0)
            );
        }
    }
}