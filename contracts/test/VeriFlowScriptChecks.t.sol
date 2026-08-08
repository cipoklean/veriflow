// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VeriFlowScriptChecks} from "../script/VeriFlowScriptChecks.sol";

/// @dev External wrapper so the library's revert happens in a NESTED call frame
/// (forge's expectRevert requires the revert at a lower depth than the test).
contract AnvilCheckWrapper {
    function assertNotAnvilDefault(address addr) external pure {
        VeriFlowScriptChecks.assertNotAnvilDefault(addr);
    }
}

/// @dev NEW-14: the shared script assertion must reject all 10 well-known
/// anvil default accounts and accept real addresses.
contract VeriFlowScriptChecksTest is Test {
    AnvilCheckWrapper wrapper = new AnvilCheckWrapper();

    function testAssertNotAnvilDefaultRejectsAllTen() public {
        address[10] memory anvil = VeriFlowScriptChecks.anvilDefaultAccounts();
        for (uint256 i = 0; i < anvil.length; i++) {
            vm.expectRevert(bytes("FEE_TO_SETTER must not be an Anvil default account"));
            wrapper.assertNotAnvilDefault(anvil[i]);
        }
    }

    function testAssertNotAnvilDefaultAcceptsRealAddresses() public {
        // Governor/deployer + random EOAs must pass.
        wrapper.assertNotAnvilDefault(0x51b0228bd9B8BF78CEDB11Cb485BA9F80cCf4655);
        wrapper.assertNotAnvilDefault(address(0xdead));
        wrapper.assertNotAnvilDefault(0x0000000000000000000000000000000000000001);
    }
}
