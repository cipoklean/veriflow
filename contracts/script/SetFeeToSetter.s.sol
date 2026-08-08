// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {VeriFactory} from "../src/core/VeriFactory.sol";
import {VeriFlowScriptChecks} from "./VeriFlowScriptChecks.sol";

/**
 * @notice NEW-14: one owner tx — point the live factory's feeToSetter at the
 * governor (it was left on an anvil default account). The target defaults to
 * the governor key and is asserted to NOT be a well-known anvil account.
 */
contract SetFeeToSetter is Script {
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    function run() external {
        uint256 pk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        address owner = Vm(CHEATCODE_ADDRESS).addr(pk);

        // Factory from the latest deploy broadcast (NEW-05 single source of truth).
        string memory json = Vm(CHEATCODE_ADDRESS).readFile(
            string.concat(
                "broadcast/DeployVeriFlow.s.sol/",
                Vm(CHEATCODE_ADDRESS).toString(block.chainid),
                "/run-latest.json"
            )
        );
        address factoryAddr = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.veriFactory_.value");
        VeriFactory factory = VeriFactory(factoryAddr);

        address feeToSetter = owner; // default: governor key
        VeriFlowScriptChecks.assertNotAnvilDefault(feeToSetter);

        console2.log("Factory:", factoryAddr);
        console2.log("feeToSetter ->", feeToSetter);

        vm.startBroadcast(pk);
        if (factory._feeToSetter() != feeToSetter) {
            factory.setFeeToSetter(feeToSetter);
            console2.log("setFeeToSetter broadcast");
        } else {
            console2.log("feeToSetter already correct");
        }
        vm.stopBroadcast();
    }
}
