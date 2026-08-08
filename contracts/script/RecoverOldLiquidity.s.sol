// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {VeriRouter} from "../src/core/VeriRouter.sol";
import {VeriPair} from "../src/core/VeriPair.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Recover the governor's LP from the OLD (pre-redeploy) pair via the
 * OLD router, so the freed USDC/WMON can re-seed the NEW stack.
 * Old stack (deployed 2026-08-07 21:20 UTC, superseded by the redeploy):
 *   router 0x9F08a63090B363736801D152b86398Fb02FDd6a3
 *   pair   0x726D59E3a4767C7468AAF3B4c2194AB39c13e471
 *   tokens WMON 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
 *          USDC 0x534b2f3A21130d7a60830c2Df862319e593943A3
 */
contract RecoverOldLiquidity is Script {
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;
    address constant OLD_ROUTER = 0x9F08a63090B363736801D152b86398Fb02FDd6a3;
    address constant OLD_PAIR = 0x726D59E3a4767C7468AAF3B4c2194AB39c13e471;
    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        uint256 pk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        address me = Vm(CHEATCODE_ADDRESS).addr(pk);
        VeriPair pair = VeriPair(OLD_PAIR);
        VeriRouter router = VeriRouter(payable(OLD_ROUTER));

        uint256 lp = pair.balanceOf(me);
        console2.log("governor LP on old pair:", lp);
        require(lp > 0, "no LP to recover");

        vm.startBroadcast(pk);
        IERC20(OLD_PAIR).approve(OLD_ROUTER, lp);
        (uint256 amt0, uint256 amt1) = router.removeLiquidity(
            WMON,
            USDC,
            lp,
            0,
            0,
            me,
            block.timestamp + 3600
        );
        console2.log("recovered WMON:", amt0);
        console2.log("recovered USDC:", amt1);
        vm.stopBroadcast();
    }
}
