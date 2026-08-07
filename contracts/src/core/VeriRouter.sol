// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVeriRouter} from "../interfaces/IVeriAMM.sol";
import {VeriPair} from "./VeriPair.sol";
import {VeriFactory} from "./VeriFactory.sol";
import {IComplianceHook} from "../interfaces/IComplianceHook.sol";
import {ICVARegistry} from "../interfaces/ICVARegistry.sol";
import {IVeriFactory} from "../interfaces/IVeriAMM.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title VeriRouter
 * @notice Router for VeriFlow swaps and liquidity operations with compliance checks
 * @dev Entry point for all user interactions. Performs compliance checks via ComplianceHook
 * before routing to VeriPair pools. Internal mechanics follow the canonical Uniswap V2
 * router pattern: input tokens are pulled to the first pair, intermediate outputs flow
 * pair-to-pair via `pair.swap`, and WETH is wrapped/unwrapped explicitly at the router.
 */
contract VeriRouter is IVeriRouter, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private _factory;
    address private _WETH;
    IComplianceHook public complianceHook_;

    // Error codes
    error InsufficientOutputAmount();
    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error DeadlineExpired();
    error ComplianceRejected(string reason, uint8 checkType);
    error InvalidPath();
    error IdenticalTokens();
    error ZeroAddress();

    event ComplianceHookUpdated(IComplianceHook indexed newHook);
    event WETHUpdated(address indexed oldWETH, address indexed newWETH);

    /**
     * @dev Accept ETH only via WETH.withdraw() unwrapping. Anything else is a
     * donation attempt and is rejected — canonical Uniswap router behavior.
     */
    receive() external payable {
        require(msg.sender == _WETH, "WETH_ONLY");
    }

    constructor(
        address factory_,
        address weth_,
        IComplianceHook hook_
    ) Ownable(msg.sender) {
        _factory = factory_;
        _WETH = weth_;
        complianceHook_ = hook_;
    }

    // ============================================================
    // View Functions
    // ============================================================

    function factory() external view override returns (address) {
        return _factory;
    }

    function WETH() external view override returns (address) {
        return _WETH;
    }

    function complianceHook() external view override returns (address) {
        return address(complianceHook_);
    }

    // ============================================================
    // Add Liquidity
    // ============================================================

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        _checkComplianceAddLiquidity(msg.sender, tokenA, tokenB);

        VeriPair pair = VeriPair(IVeriFactory(_factory).getPair(tokenA, tokenB));
        require(address(pair) != address(0), "PAIR_NOT_EXISTS");

        (uint112 reserveA, uint112 reserveB) = _getReserves(tokenA, tokenB, pair);

        if (reserveA == 0 && reserveB == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
        } else {
            uint256 amountBOptimal = _quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "INSUFFICIENT_B_AMOUNT");
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = _quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal <= amountADesired, "INSUFFICIENT_A_AMOUNT");
                require(amountAOptimal >= amountAMin, "INSUFFICIENT_A_AMOUNT");
                amountB = amountBDesired;
                amountA = amountAOptimal;
            }
        }

        require(amountA > 0 && amountB > 0, "INSUFFICIENT_AMOUNT");

        // Pull only the optimal amounts from the user. Any excess approved by the
        // caller simply stays in their wallet — nothing to refund.
        _safeTransferFrom(tokenA, msg.sender, address(pair), amountA);
        _safeTransferFrom(tokenB, msg.sender, address(pair), amountB);
        liquidity = pair.mint(to);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external override payable nonReentrant returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        _checkComplianceAddLiquidity(msg.sender, token, _WETH);

        VeriPair pair = VeriPair(IVeriFactory(_factory).getPair(token, _WETH));
        require(address(pair) != address(0), "PAIR_NOT_EXISTS");

        (uint112 reserveToken, uint112 reserveETH) = _getReserves(token, _WETH, pair);

        if (reserveToken == 0 && reserveETH == 0) {
            amountToken = amountTokenDesired;
            amountETH = msg.value;
        } else {
            uint256 amountETHEstimated = _quote(amountTokenDesired, reserveToken, reserveETH);
            if (amountETHEstimated <= msg.value) {
                require(amountETHEstimated >= amountETHMin, "INSUFFICIENT_ETH_AMOUNT");
                amountToken = amountTokenDesired;
                amountETH = amountETHEstimated;
            } else {
                uint256 amountTokenEstimated = _quote(msg.value, reserveETH, reserveToken);
                require(amountTokenEstimated <= amountTokenDesired, "INSUFFICIENT_TOKEN_AMOUNT");
                require(amountTokenEstimated >= amountTokenMin, "INSUFFICIENT_TOKEN_AMOUNT");
                amountETH = msg.value;
                amountToken = amountTokenEstimated;
            }
        }

        require(amountToken > 0 && amountETH > 0, "INSUFFICIENT_AMOUNT");

        // Pull only the optimal token amount; the pair receives WETH via deposit+transfer.
        _safeTransferFrom(token, msg.sender, address(pair), amountToken);
        _safeTransferFrom(_WETH, msg.sender, address(pair), amountETH);
        liquidity = pair.mint(to);

        // Refund only the unused ETH that was actually sent with the call.
        if (msg.value > amountETH) payable(msg.sender).transfer(msg.value - amountETH);
    }

    // ============================================================
    // Remove Liquidity
    // ============================================================

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        _checkComplianceRemoveLiquidity(msg.sender, tokenA, tokenB);

        VeriPair pair = VeriPair(IVeriFactory(_factory).getPair(tokenA, tokenB));
        require(address(pair) != address(0), "PAIR_NOT_EXISTS");

        pair.transferFrom(msg.sender, address(pair), liquidity);
        (amountA, amountB) = pair.burn(to);

        require(amountA >= amountAMin, "INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "INSUFFICIENT_B_AMOUNT");
    }

    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256 amountToken, uint256 amountETH) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        _checkComplianceRemoveLiquidity(msg.sender, token, _WETH);

        VeriPair pair = VeriPair(IVeriFactory(_factory).getPair(token, _WETH));
        require(address(pair) != address(0), "PAIR_NOT_EXISTS");

        // Burn LP and receive BOTH tokens into the router first, so we can split
        // token → user and WETH → unwrap → ETH → user exactly once.
        pair.transferFrom(msg.sender, address(pair), liquidity);
        (amountToken, amountETH) = pair.burn(address(this));

        require(amountToken >= amountTokenMin, "INSUFFICIENT_TOKEN_AMOUNT");
        require(amountETH >= amountETHMin, "INSUFFICIENT_ETH_AMOUNT");

        _safeTransfer(token, to, amountToken);
        IWETH(_WETH).withdraw(amountETH);
        payable(to).transfer(amountETH);
    }

    // ============================================================
    // Swap Functions
    // ============================================================

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        _checkComplianceSwapPath(msg.sender, path);
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        _checkComplianceSwapPath(msg.sender, path);
        amounts = getAmountsIn(amountOut, path);
        require(amounts[0] <= amountInMax, "INSUFFICIENT_INPUT_AMOUNT");
        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override payable nonReentrant returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        require(path[0] == _WETH, "INVALID_PATH");
        _checkComplianceSwapPath(msg.sender, path);
        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        // Wrap only the input actually needed; the pair receives the WETH.
        _safeTransferFrom(_WETH, msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
        if (msg.value > amounts[0]) payable(msg.sender).transfer(msg.value - amounts[0]);
    }

    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        require(path[path.length - 1] == _WETH, "INVALID_PATH");
        _checkComplianceSwapPath(msg.sender, path);
        amounts = getAmountsIn(amountOut, path);
        require(amounts[0] <= amountInMax, "INSUFFICIENT_INPUT_AMOUNT");
        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        // Land the WETH output in the router, then unwrap once to ETH for the user.
        _swap(amounts, path, address(this));
        IWETH(_WETH).withdraw(amounts[amounts.length - 1]);
        payable(to).transfer(amounts[amounts.length - 1]);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override nonReentrant returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        require(path[path.length - 1] == _WETH, "INVALID_PATH");
        _checkComplianceSwapPath(msg.sender, path);
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amountIn);
        _swap(amounts, path, address(this));
        IWETH(_WETH).withdraw(amounts[amounts.length - 1]);
        payable(to).transfer(amounts[amounts.length - 1]);
    }

    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override payable nonReentrant returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "DEADLINE_EXPIRED");
        require(path[0] == _WETH, "INVALID_PATH");
        _checkComplianceSwapPath(msg.sender, path);
        amounts = getAmountsIn(amountOut, path);
        require(amounts[0] <= msg.value, "INSUFFICIENT_INPUT_AMOUNT");
        _safeTransferFrom(_WETH, msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
        if (msg.value > amounts[0]) payable(msg.sender).transfer(msg.value - amounts[0]);
    }

    // ============================================================
    // Quote & Amount Calculations
    // ============================================================

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure override returns (uint256 amountB) {
        require(amountA > 0, "INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "INSUFFICIENT_RESERVES");
        return (amountA * reserveB) / reserveA;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure override returns (uint256 amountOut) {
        require(amountIn > 0, "INSUFFICIENT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_RESERVES");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        return numerator / denominator;
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) public pure override returns (uint256 amountIn) {
        require(amountOut > 0, "INSUFFICIENT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_RESERVES");
        uint256 numerator = (reserveIn * amountOut) * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        return (numerator / denominator) + 1;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view override returns (uint256[] memory amounts) {
        require(path.length >= 2, "INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint112 reserveIn, uint112 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path) public view override returns (uint256[] memory amounts) {
        require(path.length >= 2, "INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint112 reserveIn, uint112 reserveOut) = _getReserves(path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }

    // ============================================================
    // Internal Helpers
    // ============================================================

    /**
     * @dev Canonical Uniswap V2 swap loop. Each hop calls `pair.swap()` directly:
     * the input was already delivered to the first pair (or the previous hop's
     * output), and intermediate outputs are routed to the next pair via `to`.
     */
    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            VeriPair pair = VeriPair(_pairFor(input, output));
            require(address(pair) != address(0), "PAIR_NOT_EXISTS");

            (address token0, ) = (pair.token0(), pair.token1());
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amounts[i + 1])
                : (amounts[i + 1], uint256(0));

            // Intermediate hops deliver the output token directly into the next pair.
            address recipient = i < path.length - 2 ? _pairFor(output, path[i + 2]) : to;

            pair.swap(amount0Out, amount1Out, recipient, new bytes(0));
        }
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        return IVeriFactory(_factory).getPair(tokenA, tokenB);
    }

    function _getReserves(address tokenA, address tokenB, VeriPair pair) internal view returns (uint112 reserveA, uint112 reserveB) {
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        (address token0, ) = (pair.token0(), pair.token1());
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _getReserves(address tokenA, address tokenB) internal view returns (uint112 reserveA, uint112 reserveB) {
        VeriPair pair = VeriPair(IVeriFactory(_factory).getPair(tokenA, tokenB));
        return _getReserves(tokenA, tokenB, pair);
    }

    /**
     * @dev Pull `value` tokens from `from` to `to`.
     * WETH-aware: when the caller sent ETH with this call (payable entry points),
     * the ETH is wrapped via `deposit()` and the WETH is transferred to `to`
     * (the pair) so the pair actually receives it. For plain ERC20 (including
     * WETH held as an ERC20), the standard transferFrom path is used.
     */
    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        if (token == _WETH && msg.value >= value) {
            IWETH(_WETH).deposit{value: value}();
            IWETH(_WETH).transfer(to, value);
        } else {
            IERC20(token).safeTransferFrom(from, to, value);
        }
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        if (token == _WETH) {
            IWETH(_WETH).withdraw(value);
            payable(to).transfer(value);
        } else {
            IERC20(token).safeTransfer(to, value);
        }
    }

    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal view returns (uint256 amountB) {
        return quote(amountA, reserveA, reserveB);
    }

    // ============================================================
    // Compliance Checks
    // ============================================================

    function _checkComplianceSwapPath(address sender, address[] memory path) internal view {
        // Check compliance for each hop
        for (uint256 i = 0; i < path.length - 1; i++) {
            IComplianceHook.ComplianceResult memory result = complianceHook_.checkSwap(
                sender,
                path[i],
                path[i + 1],
                0,
                0
            );
            if (!result.allowed) {
                revert ComplianceRejected(result.reason, result.checkType);
            }
        }
    }

    function _checkComplianceAddLiquidity(address sender, address tokenA, address tokenB) internal view {
        IComplianceHook.ComplianceResult memory result = complianceHook_.checkAddLiquidity(
            sender,
            tokenA,
            tokenB,
            0,
            0
        );
        if (!result.allowed) {
            revert ComplianceRejected(result.reason, result.checkType);
        }
    }

    function _checkComplianceRemoveLiquidity(address sender, address tokenA, address tokenB) internal view {
        IComplianceHook.ComplianceResult memory result = complianceHook_.checkRemoveLiquidity(
            sender,
            tokenA,
            tokenB,
            0
        );
        if (!result.allowed) {
            revert ComplianceRejected(result.reason, result.checkType);
        }
    }

    // ============================================================
    // Governance
    // ============================================================

    function setComplianceHook(IComplianceHook _complianceHook) external onlyOwner {
        complianceHook_ = _complianceHook;
        emit ComplianceHookUpdated(_complianceHook);
    }

    function setWETH(address _newWETH) external onlyOwner {
        require(_newWETH != address(0), "ZERO_ADDRESS");
        emit WETHUpdated(_WETH, _newWETH);
        _WETH = _newWETH;
    }
}
