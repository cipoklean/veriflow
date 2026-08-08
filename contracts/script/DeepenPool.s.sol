// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {VeriRouter} from "../src/core/VeriRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deepen + reprice the live WMON/USDC pool WITHOUT minting anything.
 * Only real balances: deposit() MON->WMON, sell a fraction of that WMON into
 * the pair (reprice from ~95 USDC/MON toward the 1-5 range), then addLiquidity
 * with the remaining WMON + the governor's full USDC balance (faucet top-up).
 *
 * Constraint learned from modeling: addLiquidity only absorbs USDC at the
 * pool's CURRENT ratio, so a ~2.44 WMON wallet cannot absorb a large faucet
 * top-up - the pool lands near 7 USDC : 2.64 WMON. The chosen 40% sell
 * fraction puts the price at ~2.6 USDC/MON and keeps impact at 0.1 WMON
 * under 5% (3.6%), which is the stated target. SELL_PCT env can override.
 *
 * Governor must be CVI-verified (router-mediated calls are exempt from the
 * pair's per-call CVI check, but LP tokens minted to the governor need the
 * registry state anyway).
 */
contract DeepenPool is Script {
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    address constant PAIR = 0x2fD1F8B9184d4ed41CF5f1A7639847ADDe9314b7;
    uint256 constant GAS_RESERVE = 0.3e18; // keep MON for gas

    function run() external {
        uint256 pk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        address governor = Vm(CHEATCODE_ADDRESS).addr(pk);

        // Router from the latest deploy broadcast (NEW-05 single source).
        string memory json = Vm(CHEATCODE_ADDRESS).readFile(
            string.concat(
                "broadcast/DeployVeriFlow.s.sol/",
                Vm(CHEATCODE_ADDRESS).toString(block.chainid),
                "/run-latest.json"
            )
        );
        address routerAddr = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.veriRouter_.value");
        VeriRouter router = VeriRouter(payable(routerAddr));

        uint256 sellPct = Vm(CHEATCODE_ADDRESS).envOr("SELL_PCT", uint256(40)); // % of WMON sold to reprice

        // --- read live balances (faucet top-up read at runtime) ---
        uint256 monBal = address(governor).balance;
        uint256 wmonBal = IERC20(WMON).balanceOf(governor);
        uint256 usdcBal = IERC20(USDC).balanceOf(governor);
        console2.log("Balances - MON:", monBal);
        console2.log("Balances - WMON:", wmonBal);
        console2.log("Balances - USDC:", usdcBal);

        vm.startBroadcast(pk);

        // 1. Deposit all MON except the gas reserve into WMON.
        uint256 depositAmt = monBal > GAS_RESERVE ? monBal - GAS_RESERVE : 0;
        if (depositAmt > 0) {
            MockWETH(payable(WMON)).deposit{value: depositAmt}();
            console2.log("Deposited MON -> WMON:", depositAmt);
        }
        wmonBal = IERC20(WMON).balanceOf(governor);

        // 2. Reprice: sell SELL_PCT% of WMON for USDC into the pair.
        uint256 sellAmt = wmonBal * sellPct / 100;
        if (sellAmt > 0) {
            IERC20(WMON).approve(address(router), sellAmt);
            address[] memory path = new address[](2);
            path[0] = WMON;
            path[1] = USDC;
            // minOut=1: the point of the sell is to MOVE the price; any positive
            // USDC out is acceptable on testnet (deadline guards staleness).
            router.swapExactTokensForTokens(sellAmt, 1, path, governor, block.timestamp + 600);
            console2.log("Sold", sellAmt, "WMON -> USDC (reprice, minOut=1)");
        }
        wmonBal = IERC20(WMON).balanceOf(governor);
        usdcBal = IERC20(USDC).balanceOf(governor);
        console2.log("After sell - WMON:", wmonBal);
        console2.log("After sell - USDC:", usdcBal);

        // 3. Add liquidity with ALL remaining WMON + ALL USDC. The router adds
        //    at the pool's current ratio and refunds the excess USDC.
        uint256 wmonAdd = wmonBal;
        uint256 usdcAdd = usdcBal;
        if (wmonAdd > 0 && usdcAdd > 0) {
            IERC20(WMON).approve(address(router), wmonAdd);
            IERC20(USDC).approve(address(router), usdcAdd);
            (uint256 a0, uint256 a1, uint256 liq) = router.addLiquidity(
                WMON,
                USDC,
                wmonAdd,
                usdcAdd,
                1, // min amounts: 1 wei - testnet, pool is tiny
                1,
                governor,
                block.timestamp + 600
            );
            console2.log("Added liquidity - WMON:", a0);
            console2.log("Added liquidity - USDC:", a1);
            console2.log("Added liquidity - LP:", liq);
        }

        vm.stopBroadcast();

        // 4. Log post-state: reserves, implied price, impact per size.
        (uint112 r0, uint112 r1, ) = IUniswapV2PairLike(PAIR).getReserves();
        uint256 usdcRes = uint256(r0); // token0 = USDC
        uint256 wmonRes = uint256(r1); // token1 = WMON
        console2.log("=== POST-STATE ===");
        console2.log("Reserves - USDC:", usdcRes);
        console2.log("Reserves - WMON:", wmonRes);
        uint256 price = usdcRes * 1e18 / wmonRes; // USDC per 1e18 WMON
        console2.log("Implied price:", price, "(USDC per WMON, 18-dec)");
        uint256[4] memory sizes = [uint256(0.01e18), uint256(0.05e18), uint256(0.1e18), uint256(1e18)];
        for (uint256 i = 0; i < 4; i++) {
            // impact = (0.997*in) / (wmonRes + 0.997*in)
            uint256 eff = sizes[i] * 997 / 1000;
            uint256 impact = eff * 100_00 / (wmonRes + eff); // bps of 100%
            console2.log("Impact size (wei):", sizes[i]);
            console2.log("Impact bps:", impact);
            console2.log("Impact pct:", impact / 100);
        }
        console2.log("Post balances - MON:", address(governor).balance);
        console2.log("Post balances - WMON:", IERC20(WMON).balanceOf(governor));
        console2.log("Post balances - USDC:", IERC20(USDC).balanceOf(governor));
    }
}

interface IUniswapV2PairLike {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}
