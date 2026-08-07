// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IComplianceHook} from "../interfaces/IComplianceHook.sol";
import {ICVIRegistry} from "../interfaces/ICVIRegistry.sol";
import {ICVARegistry} from "../interfaces/ICVARegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ComplianceHook
 * @notice Core compliance enforcement contract for VeriFlow
 * @dev This hook intercepts all AMM operations and enforces CVI (identity) and CVA (asset) compliance.
 * It implements a fail-closed design: if compliance cannot be verified, the operation is rejected.
 * Compliance checks are always live — no caching (M-02): registry state is authoritative at call time.
 */
contract ComplianceHook is IComplianceHook, Ownable2Step, Pausable, ReentrancyGuard {
    ICVIRegistry public cviRegistry_;
    ICVARegistry public cvaRegistry_;

    // Error codes for revert reasons
    error ComplianceFailed(string reason);
    error CVIVerificationFailed(string reason);
    error CVAVerificationFailed(string reason);
    error RegistryUnavailable(string registry);
    error OperationPaused();

    event CVIChecked(address indexed wallet, address indexed pool, bool allowed, string reason);
    event CVAChecked(address indexed token, bool allowed, string reason);
    event RegistriesUpdated(ICVIRegistry newCVI, ICVARegistry newCVA);

    constructor(
        ICVIRegistry _cviRegistry,
        ICVARegistry _cvaRegistry
    ) Ownable(msg.sender) {
        cviRegistry_ = _cviRegistry;
        cvaRegistry_ = _cvaRegistry;
    }

    // ============================================================
    // IComplianceHook Interface Implementation
    // ============================================================

    function cviRegistry() external view override returns (ICVIRegistry) {
        return cviRegistry_;
    }

    function cvaRegistry() external view override returns (ICVARegistry) {
        return cvaRegistry_;
    }

    function setCVIRegistry(ICVIRegistry registry) external override onlyOwner {
        cviRegistry_ = registry;
        emit RegistriesUpdated(registry, cvaRegistry_);
    }

    function setCVARegistry(ICVARegistry registry) external override onlyOwner {
        cvaRegistry_ = registry;
        emit RegistriesUpdated(cviRegistry_, registry);
    }

    function setPaused(bool paused) external override onlyOwner {
        if (paused) {
            _pause();
        } else {
            _unpause();
        }
    }

    function paused() public view override(Pausable, IComplianceHook) returns (bool) {
        return super.paused();
    }

    // ============================================================
    // Internal Compliance Check Functions (live, uncached)
    // ============================================================

    /**
     * @notice Internal CVI (identity) compliance check
     * @param wallet The wallet to check
     * @param pool The pool address (for pool-specific rules)
     * @return True if wallet passes CVI compliance
     */
    function _checkCVI(address wallet, address pool) internal view returns (bool) {
        // Fail-closed: if paused, reject all operations
        if (paused()) {
            return false;
        }

        // Live query — no cache. Registry state is authoritative at call time.
        bool isVerified;
        try cviRegistry_.isVerified(wallet) returns (bool result) {
            isVerified = result;
        } catch {
            // Fail-closed: if registry call fails, reject
            return false;
        }

        return isVerified;
    }

    /**
     * @notice Internal CVA (asset) compliance check
     * @param token The token to check
     * @return True if token is a verified CVA asset
     */
    function _checkCVA(address token) internal view returns (bool) {
        // Fail-closed: if paused, reject all operations
        if (paused()) {
            return false;
        }

        // Live query — no cache.
        bool isVerified;
        try cvaRegistry_.isVerifiedAsset(token) returns (bool result) {
            isVerified = result;
        } catch {
            // Fail-closed: if registry call fails, reject
            return false;
        }

        return isVerified;
    }

    // ============================================================
    // Public Compliance Check Functions (Interface Implementation)
    // ============================================================

    /**
     * @notice Check CVI (identity) compliance for a wallet against a pool
     * @param wallet The wallet to check
     * @param pool The pool address (for pool-specific rules)
     * @return True if wallet passes CVI compliance
     */
    function checkCVI(address wallet, address pool) external view override returns (bool) {
        return _checkCVI(wallet, pool);
    }

    /**
     * @notice Check CVA (asset) compliance for a token
     * @param token The token to check
     * @return True if token is a verified CVA asset
     */
    function checkCVA(address token) external view override returns (bool) {
        return _checkCVA(token);
    }

    /**
     * @notice Comprehensive compliance check for swap operations
     * @param sender The wallet initiating the swap
     * @param tokenIn The input token
     * @param tokenOut The output token
     * @param amountIn Amount of tokenIn
     * @param amountOutMin Minimum amountOut (for slippage)
     * @return ComplianceResult with allowed=true if compliant
     */
    function checkSwap(
        address sender,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin
    ) external view override returns (ComplianceResult memory) {
        // Check CVI compliance for sender
        bool cviAllowed = _checkCVI(sender, address(this)); // Use hook address as pool identifier
        if (!cviAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVI verification failed: sender not verified or attestation expired",
                checkType: 0
            });
        }

        // Check CVA compliance for both tokens
        bool tokenInAllowed = _checkCVA(tokenIn);
        if (!tokenInAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVA verification failed: input token not a verified Cleanverse asset",
                checkType: 1
            });
        }

        bool tokenOutAllowed = _checkCVA(tokenOut);
        if (!tokenOutAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVA verification failed: output token not a verified Cleanverse asset",
                checkType: 1
            });
        }

        // All checks passed
        return ComplianceResult({
            allowed: true,
            reason: "All compliance checks passed",
            checkType: 2
        });
    }

    /**
     * @notice Comprehensive compliance check for adding liquidity
     * @param sender The wallet adding liquidity
     * @param tokenA First token
     * @param tokenB Second token
     * @param amountADesired Desired amount of tokenA
     * @param amountBDesired Desired amount of tokenB
     * @return ComplianceResult with allowed=true if compliant
     */
    function checkAddLiquidity(
        address sender,
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired
    ) external view override returns (ComplianceResult memory) {
        // Check CVI compliance for sender
        bool cviAllowed = _checkCVI(sender, address(this));
        if (!cviAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVI verification failed: sender not verified or attestation expired",
                checkType: 0
            });
        }

        // Check CVA compliance for both tokens
        bool tokenAAllowed = _checkCVA(tokenA);
        if (!tokenAAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVA verification failed: tokenA not a verified Cleanverse asset",
                checkType: 1
            });
        }

        bool tokenBAllowed = _checkCVA(tokenB);
        if (!tokenBAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVA verification failed: tokenB not a verified Cleanverse asset",
                checkType: 1
            });
        }

        return ComplianceResult({
            allowed: true,
            reason: "All compliance checks passed",
            checkType: 2
        });
    }

    /**
     * @notice Comprehensive compliance check for removing liquidity
     * @param sender The wallet removing liquidity
     * @param tokenA First token
     * @param tokenB Second token
     * @param liquidity Amount of LP tokens to burn
     * @return ComplianceResult with allowed=true if compliant
     */
    function checkRemoveLiquidity(
        address sender,
        address tokenA,
        address tokenB,
        uint256 liquidity
    ) external view override returns (ComplianceResult memory) {
        // Check CVI compliance for sender
        bool cviAllowed = _checkCVI(sender, address(this));
        if (!cviAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVI verification failed: sender not verified or attestation expired",
                checkType: 0
            });
        }

        // Check CVA compliance for both tokens (they should already be verified if pool exists)
        bool tokenAAllowed = _checkCVA(tokenA);
        bool tokenBAllowed = _checkCVA(tokenB);

        if (!tokenAAllowed || !tokenBAllowed) {
            return ComplianceResult({
                allowed: false,
                reason: "CVA verification failed: pool contains non-verified assets",
                checkType: 1
            });
        }

        return ComplianceResult({
            allowed: true,
            reason: "All compliance checks passed",
            checkType: 2
        });
    }
}
