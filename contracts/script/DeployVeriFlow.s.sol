// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {VeriFactory} from "../src/core/VeriFactory.sol";
import {VeriRouter} from "../src/core/VeriRouter.sol";
import {ComplianceHook} from "../src/compliance/ComplianceHook.sol";
import {MockCVIRegistry} from "../src/mocks/MockCVIRegistry.sol";
import {MockCVARegistry} from "../src/mocks/MockCVARegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {IComplianceHook} from "../src/interfaces/IComplianceHook.sol";
import {ICVIRegistry} from "../src/interfaces/ICVIRegistry.sol";
import {ICVARegistry} from "../src/interfaces/ICVARegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VeriFlow Deploy Script
 * @notice Deploys complete VeriFlow stack for Monad testnet
 * @dev Deployment order: CVI Registry -> CVA Registry -> ComplianceHook -> Factory -> Router
 */
contract DeployVeriFlow is Script {
    // ============================================================
    // Configuration (read from env in run())
    // ============================================================
    address WETH_ADDRESS;
    address GOVERNOR;
    address CVI_REGISTRY_ADDRESS;
    address CVA_REGISTRY_ADDRESS;

    // ============================================================
    // Deployed Contract Addresses
    // ============================================================
    MockCVIRegistry cviRegistry;
    MockCVARegistry cvaRegistry;
    ComplianceHook complianceHook;
    VeriFactory veriFactory;
    VeriRouter veriRouter;
    MockWETH mockWeth;
    MockERC20 testTokenA;
    MockERC20 testTokenB;

    // Cheatcode address (same as VM_ADDRESS in CommonBase)
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    /// @notice Parse a hex string (with or without 0x prefix) to address
    function parseAddress(string memory hexStr) internal pure returns (address) {
        bytes memory hexBytes = bytes(hexStr);
        uint256 start = 0;
        if (hexBytes.length >= 2 && hexBytes[0] == "0" && (hexBytes[1] == "x" || hexBytes[1] == "X")) {
            start = 2;
        }
        uint256 result = 0;
        for (uint256 i = start; i < hexBytes.length; i++) {
            bytes1 c = hexBytes[i];
            if (c >= "0" && c <= "9") {
                result = result * 16 + (uint8(c) - 48);
            } else if (c >= "a" && c <= "f") {
                result = result * 16 + (uint8(c) - 97 + 10);
            } else if (c >= "A" && c <= "F") {
                result = result * 16 + (uint8(c) - 65 + 10);
            }
        }
        return address(uint160(result));
    }

    function run() external returns (
        address cviRegistry_,
        address cvaRegistry_,
        address complianceHook_,
        address veriFactory_,
        address veriRouter_,
        address testTokenA_,
        address testTokenB_
    ) {
        // Use Vm(CHEATCODE_ADDRESS) for env* functions (not available on vmSafe)
        // Use vmSafe for startBroadcast/stopBroadcast (inherited from ScriptBase)
        string memory wethStr = Vm(CHEATCODE_ADDRESS).envString("WETH_ADDRESS");
        string memory governorStr = Vm(CHEATCODE_ADDRESS).envString("GOVERNOR");
        string memory cviStr = Vm(CHEATCODE_ADDRESS).envString("CVI_REGISTRY_ADDRESS");
        string memory cvaStr = Vm(CHEATCODE_ADDRESS).envString("CVA_REGISTRY_ADDRESS");

        WETH_ADDRESS = bytes(wethStr).length > 0 ? parseAddress(wethStr) : address(0);
        GOVERNOR = bytes(governorStr).length > 0 ? parseAddress(governorStr) : address(0);
        CVI_REGISTRY_ADDRESS = bytes(cviStr).length > 0 ? parseAddress(cviStr) : address(0);
        CVA_REGISTRY_ADDRESS = bytes(cvaStr).length > 0 ? parseAddress(cvaStr) : address(0);

        // Default governor to deployer if not set
        if (GOVERNOR == address(0)) {
            uint256 deployerPkForGov = Vm(CHEATCODE_ADDRESS).envUint("DEPLOYER_PRIVATE_KEY");
            if (deployerPkForGov != 0) {
                GOVERNOR = Vm(CHEATCODE_ADDRESS).addr(deployerPkForGov);
            }
        }

        uint256 deployerPk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        vmSafe.startBroadcast(deployerPk);

        // ============================================================
        // Step 1: Deploy CVI Registry (Mock for testing, real for prod)
        // ============================================================
        if (CVI_REGISTRY_ADDRESS == address(0)) {
            cviRegistry = new MockCVIRegistry();
            CVI_REGISTRY_ADDRESS = address(cviRegistry);
            console2.log("Deployed MockCVIRegistry at:", CVI_REGISTRY_ADDRESS);
        } else {
            cviRegistry = MockCVIRegistry(CVI_REGISTRY_ADDRESS);
            console2.log("Using existing CVI Registry at:", CVI_REGISTRY_ADDRESS);
        }

        // ============================================================
        // Step 2: Deploy CVA Registry (Mock for testing, real for prod)
        // ============================================================
        if (CVA_REGISTRY_ADDRESS == address(0)) {
            cvaRegistry = new MockCVARegistry();
            CVA_REGISTRY_ADDRESS = address(cvaRegistry);
            console2.log("Deployed MockCVARegistry at:", CVA_REGISTRY_ADDRESS);
        } else {
            cvaRegistry = MockCVARegistry(CVA_REGISTRY_ADDRESS);
            console2.log("Using existing CVA Registry at:", CVA_REGISTRY_ADDRESS);
        }

        // ============================================================
        // Step 3: Deploy ComplianceHook
        // ============================================================
        complianceHook = new ComplianceHook(
            ICVIRegistry(CVI_REGISTRY_ADDRESS),
            ICVARegistry(CVA_REGISTRY_ADDRESS)
        );
        console2.log("Deployed ComplianceHook at:", address(complianceHook));

        if (GOVERNOR != complianceHook.owner()) {
            complianceHook.transferOwnership(GOVERNOR);
            console2.log("Transferred ComplianceHook ownership to:", GOVERNOR);
        }
        // Ownable2Step: the new owner must accept. If GOVERNOR is deployer-keyed,
        // accept from the deployer broadcast; otherwise require off-chain accept.
        if (GOVERNOR != address(0) && GOVERNOR != complianceHook.owner() && GOVERNOR == Vm(CHEATCODE_ADDRESS).addr(deployerPk)) {
            complianceHook.acceptOwnership();
            console2.log("ComplianceHook ownership accepted by GOVERNOR");
        }

        // ============================================================
        // Step 4: Deploy VeriFactory
        // ============================================================
        veriFactory = new VeriFactory(IComplianceHook(address(complianceHook)));
        console2.log("Deployed VeriFactory at:", address(veriFactory));

        if (GOVERNOR != veriFactory.owner()) {
            veriFactory.transferOwnership(GOVERNOR);
            console2.log("Transferred VeriFactory ownership to:", GOVERNOR);
        }
        if (GOVERNOR != address(0) && GOVERNOR != veriFactory.owner() && GOVERNOR == Vm(CHEATCODE_ADDRESS).addr(deployerPk)) {
            veriFactory.acceptOwnership();
            console2.log("VeriFactory ownership accepted by GOVERNOR");
        }

        // ============================================================
        // Step 5: Deploy VeriRouter (with MockWETH if no real WETH/WMON given)
        // ============================================================
        if (WETH_ADDRESS == address(0)) {
            // Deploy a proper WETH9-style mock (deposit/withdraw) so ETH-entry
            // swap paths work end-to-end on local Anvil.
            mockWeth = new MockWETH();
            WETH_ADDRESS = address(mockWeth);
            console2.log("Deployed MockWETH at:", WETH_ADDRESS);
        } else {
            console2.log("Using real WETH/WMON at:", WETH_ADDRESS);
        }

        // Router constructor: factory + WETH + compliance hook, in that order.
        veriRouter = new VeriRouter(
            address(veriFactory),
            WETH_ADDRESS,
            IComplianceHook(address(complianceHook))
        );
        console2.log("Deployed VeriRouter at:", address(veriRouter));

        if (GOVERNOR != veriRouter.owner()) {
            veriRouter.transferOwnership(GOVERNOR);
            console2.log("Transferred VeriRouter ownership to:", GOVERNOR);
        }
        if (GOVERNOR != address(0) && GOVERNOR != veriRouter.owner() && GOVERNOR == Vm(CHEATCODE_ADDRESS).addr(deployerPk)) {
            veriRouter.acceptOwnership();
            console2.log("VeriRouter ownership accepted by GOVERNOR");
        }

        // ============================================================
        // Step 6: Deploy Test Tokens (for local testing only)
        // ============================================================
        if (Vm(CHEATCODE_ADDRESS).envBool("DEPLOY_TEST_TOKENS")) {
            testTokenA = new MockERC20("Test Token A", "TKA", 18, 1_000_000 * 10**18);
            testTokenB = new MockERC20("Test Token B", "TKB", 18, 1_000_000 * 10**18);
            console2.log("Deployed TestTokenA at:", address(testTokenA));
            console2.log("Deployed TestTokenB at:", address(testTokenB));

            if (address(cvaRegistry) == CVA_REGISTRY_ADDRESS) {
                cvaRegistry.registerAsset(address(testTokenA), address(0), "TKA", "Test Token A", 18, false, address(0), address(0));
                cvaRegistry.registerAsset(address(testTokenB), address(0), "TKB", "Test Token B", 18, false, address(0), address(0));
                console2.log("Registered test tokens in CVA registry");
            }
        }

        vmSafe.stopBroadcast();

        // ============================================================
        // Verification: Print all addresses for frontend config
        // ============================================================
        console2.log("\n=== VERIFLOW DEPLOYMENT SUMMARY ===");
        console2.log("CVI Registry:", CVI_REGISTRY_ADDRESS);
        console2.log("CVA Registry:", CVA_REGISTRY_ADDRESS);
        console2.log("ComplianceHook:", address(complianceHook));
        console2.log("VeriFactory:", address(veriFactory));
        console2.log("VeriRouter:", address(veriRouter));
        console2.log("WETH:", WETH_ADDRESS);
        if (address(testTokenA) != address(0)) {
            console2.log("TestTokenA:", address(testTokenA));
            console2.log("TestTokenB:", address(testTokenB));
        }
        console2.log("====================================\n");

        return (
            CVI_REGISTRY_ADDRESS,
            CVA_REGISTRY_ADDRESS,
            address(complianceHook),
            address(veriFactory),
            address(veriRouter),
            address(testTokenA),
            address(testTokenB)
        );
    }

    // ============================================================
    // Helper: Create a test pair and add initial liquidity
    // ============================================================
    function createTestPair(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external {
        uint256 deployerPk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        vmSafe.startBroadcast(deployerPk);

        IERC20(tokenA).approve(address(veriRouter), amountA);
        IERC20(tokenB).approve(address(veriRouter), amountB);

        address pairAddress = veriFactory.createPair(tokenA, tokenB);
        console2.log("Created pair at:", pairAddress);

        veriRouter.addLiquidity(
            tokenA,
            tokenB,
            amountA,
            amountB,
            amountA * 99 / 100,
            amountB * 99 / 100,
            msg.sender,
            block.timestamp + 3600
        );
        console2.log("Added initial liquidity to pair");

        vmSafe.stopBroadcast();
    }
}