// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICVIRegistry} from "../interfaces/ICVIRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockCVIRegistry
 * @notice Mock implementation of CVI Registry for local testing
 * @dev Simulates Cleanverse Verified Identity on-chain registry.
 * In production, this would be replaced by the actual Cleanverse CVI Registry contract.
 */
contract MockCVIRegistry is ICVIRegistry, Ownable {
    struct WalletStatus {
        bool isVerified;
        uint8 tier;
        uint8 subTier;
        string group;
        string subGroup;
        string[] countries;
        uint256 expiry;
        uint256 apassTokenId;
    }

    mapping(address => WalletStatus) public walletStatuses;
    mapping(uint256 => address) public tokenIdToWallet;

    event WalletStatusUpdated(address indexed wallet, bool isVerified, uint8 tier, uint256 expiry);
    event ApassRegistered(address indexed wallet, uint256 indexed tokenId);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register a wallet with CVI attestation (for testing)
     * @param wallet The wallet address
     * @param tier A-Pass tier (0-99)
     * @param subTier A-Pass sub-tier (0-99)
     * @param group A-Pass group (2 chars)
     * @param subGroup A-Pass sub-group (2 chars)
     * @param countries Array of ISO 3166-1 alpha-2 country codes
     * @param expiry Unix timestamp when attestation expires
     * @param tokenId A-Pass NFT token ID
     */
    function registerWallet(
        address wallet,
        uint8 tier,
        uint8 subTier,
        string calldata group,
        string calldata subGroup,
        string[] calldata countries,
        uint256 expiry,
        uint256 tokenId
    ) external onlyOwner {
        walletStatuses[wallet] = WalletStatus({
            isVerified: true,
            tier: tier,
            subTier: subTier,
            group: group,
            subGroup: subGroup,
            countries: countries,
            expiry: expiry,
            apassTokenId: tokenId
        });
        if (tokenId > 0) {
            tokenIdToWallet[tokenId] = wallet;
        }
        emit WalletStatusUpdated(wallet, true, tier, expiry);
        if (tokenId > 0) {
            emit ApassRegistered(wallet, tokenId);
        }
    }

    /**
     * @notice Update wallet verification status
     * @param wallet The wallet address
     * @param isVerified New verification status
     */
    function setVerified(address wallet, bool isVerified) external onlyOwner {
        WalletStatus storage status = walletStatuses[wallet];
        status.isVerified = isVerified;
        emit WalletStatusUpdated(wallet, isVerified, status.tier, status.expiry);
    }

    /**
     * @notice Update wallet expiry (for testing expiry checks)
     * @param wallet The wallet address
     * @param expiry New expiry timestamp
     */
    function setExpiry(address wallet, uint256 expiry) external onlyOwner {
        walletStatuses[wallet].expiry = expiry;
        emit WalletStatusUpdated(wallet, walletStatuses[wallet].isVerified, walletStatuses[wallet].tier, expiry);
    }

    /**
     * @notice Update wallet tier
     * @param wallet The wallet address
     * @param tier New tier
     * @param subTier New sub-tier
     */
    function setTier(address wallet, uint8 tier, uint8 subTier) external onlyOwner {
        walletStatuses[wallet].tier = tier;
        walletStatuses[wallet].subTier = subTier;
        emit WalletStatusUpdated(wallet, walletStatuses[wallet].isVerified, tier, walletStatuses[wallet].expiry);
    }

    /**
     * @notice Update wallet countries
     * @param wallet The wallet address
     * @param countries New country list
     */
    function setCountries(address wallet, string[] calldata countries) external onlyOwner {
        walletStatuses[wallet].countries = countries;
    }

    function getWalletStatus(address wallet)
        external
        view
        override
        returns (
            bool isVerified,
            uint8 tier,
            uint8 subTier,
            string memory group,
            string memory subGroup,
            string[] memory countries,
            uint256 expiry
        )
    {
        WalletStatus storage status = walletStatuses[wallet];
        if (status.expiry > 0 && block.timestamp > status.expiry) {
            return (false, 0, 0, "", "", new string[](0), 0);
        }
        return (
            status.isVerified,
            status.tier,
            status.subTier,
            status.group,
            status.subGroup,
            status.countries,
            status.expiry
        );
    }

    function isVerified(address wallet) external view override returns (bool) {
        WalletStatus storage status = walletStatuses[wallet];
        if (!status.isVerified) return false;
        if (status.expiry > 0 && block.timestamp > status.expiry) return false;
        return true;
    }

    function getApassTokenId(address wallet) external view override returns (uint256) {
        return walletStatuses[wallet].apassTokenId;
    }

    /**
     * @notice Get wallet by token ID (reverse lookup)
     * @param tokenId A-Pass NFT token ID
     * @return wallet address
     */
    function getWalletByTokenId(uint256 tokenId) external view returns (address) {
        return tokenIdToWallet[tokenId];
    }

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
    ) external override onlyOwner {
        require(wallets.length == tiers.length, "Length mismatch");
        require(wallets.length == expiries.length, "Length mismatch");
        require(wallets.length == tokenIds.length, "Length mismatch");

        for (uint256 i = 0; i < wallets.length; i++) {
            this.registerWallet(
                wallets[i],
                tiers[i],
                0,
                "",
                "",
                new string[](0),
                expiries[i],
                tokenIds[i]
            );
        }
    }
}