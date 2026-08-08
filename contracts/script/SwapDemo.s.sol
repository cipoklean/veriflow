// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {VeriRouter} from "../src/core/VeriRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Demo swap: wrap a little MON -> WMON, approve the router, then swap
 * WMON -> USDC via the live VeriFlow router. Governor must be CVI-verified.
 * Addresses are read from the latest DeployVeriFlow broadcast JSON (NEW-05
 * single source of truth), matching BootstrapVeriFlow.
 */
contract SwapDemo is Script {
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        uint256 pk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        address user = Vm(CHEATCODE_ADDRESS).addr(pk);

        // Router from the latest deploy broadcast (NEW-05).
        string memory json = Vm(CHEATCODE_ADDRESS).readFile(
            string.concat(
                "broadcast/DeployVeriFlow.s.sol/",
                Vm(CHEATCODE_ADDRESS).toString(block.chainid),
                "/run-latest.json"
            )
        );
        address routerAddr = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.veriRouter_.value");
        VeriRouter router = VeriRouter(payable(routerAddr));

        uint256 wrapAmount = Vm(CHEATCODE_ADDRESS).envOr("SWAP_WRAP", uint256(0.01e18));
        uint256 swapAmount = Vm(CHEATCODE_ADDRESS).envOr("SWAP_AMOUNT", uint256(0.005e18));

        vm.startBroadcast(pk);
        // 1. Wrap MON -> WMON (WETH9-style deposit on canonical WMON).
        if (IERC20(WMON).balanceOf(user) < swapAmount) {
            MockWETH(payable(WMON)).deposit{value: wrapAmount}();
            console2.log("Wrapped MON -> WMON:", wrapAmount);
        }
        // 2. Approve the router.
        IERC20(WMON).approve(address(router), swapAmount);
        // 3. Swap WMON -> USDC. minOut is denominated in the OUTPUT token
        //    (USDC, 6 decimals) — derive it from the router's own quote so the
        //    demo never misprices units.
        address[] memory path = new address[](2);
        path[0] = WMON;
        path[1] = USDC;
        uint256[] memory amounts = router.getAmountsOut(swapAmount, path);
        uint256 expectedOut = amounts[amounts.length - 1];
        uint256 minOut = expectedOut * 90 / 100; // 10% slippage tolerance for demo
        console2.log("Expected output:", expectedOut, "(USDC units)");
        router.swapExactTokensForTokens(swapAmount, minOut, path, user, block.timestamp + 600);
        console2.log("Swapped", swapAmount, "WMON -> USDC via", routerAddr);
        vm.stopBroadcast();
    }
}
