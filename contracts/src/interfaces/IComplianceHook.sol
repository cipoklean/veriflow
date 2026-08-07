// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICVIRegistry} from "./ICVIRegistry.sol";
import {ICVARegistry} from "./ICVARegistry.sol";

/**
 * @title IComplianceHook
 * @notice Interface for the Compliance Hook that intercepts AMM operations
 * @dev This is the core compliance enforcement layer. It checks CVI (identity) and CVA (asset) compliance
 * before allowing any swap, addLiquidity, or removeLiquidity operation.
 */
interface IComplianceHook {
    /**
     * @notice Compliance check result
     * @param allowed Whether the operation is allowed
     * @param reason Human-readable reason if not allowed
     * @param checkType Type of check performed: 0=CVI, 1=CVA, 2=Both
     */
    struct ComplianceResult {
        bool allowed;
        string reason;
        uint8 checkType;
    }

    /**
     * @notice Check compliance for a swap operation
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
    ) external view returns (ComplianceResult memory);

    /**
     * @notice Check compliance for adding liquidity
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
    ) external view returns (ComplianceResult memory);

    /**
     * @notice Check compliance for removing liquidity
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
    ) external view returns (ComplianceResult memory);

    /**
     * @notice Check if a wallet passes CVI (identity) compliance for a given pool
     * @param wallet The wallet to check
     * @param pool The pool address (for pool-specific rules)
     * @return True if wallet is verified and meets pool requirements
     */
    function checkCVI(address wallet, address pool) external view returns (bool);

    /**
     * @notice Check if a token passes CVA (asset) compliance
     * @param token The token to check
     * @return True if token is a verified CVA asset
     */
    function checkCVA(address token) external view returns (bool);

    /**
     * @notice Get the CVI registry address
     * @return ICVIRegistry address
     */
    function cviRegistry() external view returns (ICVIRegistry);

    /**
     * @notice Get the CVA registry address
     * @return ICVARegistry address
     */
    function cvaRegistry() external view returns (ICVARegistry);

    /**
     * @notice Set the CVI registry (governance only)
     * @param registry New CVI registry address
     */
    function setCVIRegistry(ICVIRegistry registry) external;

    /**
     * @notice Set the CVA registry (governance only)
     * @param registry New CVA registry address
     */
    function setCVARegistry(ICVARegistry registry) external;

    /**
     * @notice Pause/unpause compliance checks (fail-closed when paused)
     * @param paused True to pause
     */
    function setPaused(bool paused) external;

    /**
     * @notice Check if compliance is paused
     * @return True if paused
     */
    function paused() external view returns (bool);
}