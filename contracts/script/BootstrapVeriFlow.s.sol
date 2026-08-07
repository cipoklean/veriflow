// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IComplianceHook} from "../src/interfaces/IComplianceHook.sol";
import {ICVIRegistry} from "../src/interfaces/ICVIRegistry.sol";
import {ICVARegistry} from "../src/interfaces/ICVARegistry.sol";
import {VeriFactory} from "../src/core/VeriFactory.sol";
import {VeriRouter} from "../src/core/VeriRouter.sol";
import {MockCVIRegistry} from "../src/mocks/MockCVIRegistry.sol";
import {MockCVARegistry} from "../src/mocks/MockCVARegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BootstrapVeriFlow
 * @notice One-shot setup to make a freshly deployed VeriFlow stack usable:
 *   1. Transfer CVI + CVA registry ownership to the Governor
 *   2. Register WMON + USDC as verified CVA assets
 *   3. Register the Governor + Router as verified CVI wallets
 *   4. Create the WMON/USDC pair
 *   5. (Optional, SEED_LIQUIDITY=true) seed initial liquidity
 *
 * @dev Addresses are read from env (VERI_FACTORY, VERI_ROUTER, CVI_REGISTRY,
 * CVA_REGISTRY, COMPLIANCE_HOOK, WMON, USDC) so it works after any fresh
 * deploy. Run with the deployer key first (registry ownership transfer),
 * then the governor key (registration calls) — or the same key when
 * GOVERNOR == deployer, as in local Anvil runs.
 */
contract BootstrapVeriFlow is Script {
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    // Defaults: previously deployed Monad testnet (10143) addresses.
    address constant DEFAULT_COMPLIANCE_HOOK = 0xe8294deBc3170ba67E81f8997059B5923689b24a;
    address constant DEFAULT_CVI_REGISTRY = 0xBF9d97a54BA2eB0e559b5012a77550F3dDC3312D;
    address constant DEFAULT_CVA_REGISTRY = 0xAc233f7169E57eA15182F5bC66C2C427a7af6103;
    address constant DEFAULT_VERI_FACTORY = 0x566eD0cBF42486Af55E32a4378f075a1991F8bAf;
    address constant DEFAULT_VERI_ROUTER = 0xC96181FdcD68937e76F2dc4e2Fc9D6AEf47B4D6C;

    // Real Monad testnet tokens (WMON verified live on testnet-rpc 2026-08).
    address constant DEFAULT_WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address constant DEFAULT_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    uint256 constant WMON_SEED = 1000e18;
    uint256 constant USDC_SEED = 3000e6;

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

    function envOrAddress(string memory key, address defaultAddr) internal returns (address) {
        string memory val = Vm(CHEATCODE_ADDRESS).envString(key);
        return bytes(val).length > 0 ? parseAddress(val) : defaultAddr;
    }

    function run() external {
        uint256 deployerPk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        address deployer = Vm(CHEATCODE_ADDRESS).addr(deployerPk);

        // Governor: env or default to deployer.
        string memory governorStr = Vm(CHEATCODE_ADDRESS).envString("GOVERNOR");
        address governor = bytes(governorStr).length > 0 ? parseAddress(governorStr) : deployer;

        // Deployed stack: env overrides, else defaults.
        address cviAddr = envOrAddress("CVI_REGISTRY", DEFAULT_CVI_REGISTRY);
        address cvaAddr = envOrAddress("CVA_REGISTRY", DEFAULT_CVA_REGISTRY);
        address factoryAddr = envOrAddress("VERI_FACTORY", DEFAULT_VERI_FACTORY);
        address routerAddr = envOrAddress("VERI_ROUTER", DEFAULT_VERI_ROUTER);
        address wmon = envOrAddress("WMON", DEFAULT_WMON);
        address usdc = envOrAddress("USDC", DEFAULT_USDC);

        MockCVIRegistry cvi = MockCVIRegistry(cviAddr);
        MockCVARegistry cva = MockCVARegistry(cvaAddr);
        VeriFactory factory = VeriFactory(factoryAddr);
        VeriRouter router = VeriRouter(payable(routerAddr));

        console2.log("Governor:", governor);
        console2.log("CVI Registry:", cviAddr);
        console2.log("CVA Registry:", cvaAddr);
        console2.log("VeriFactory:", factoryAddr);
        console2.log("VeriRouter:", routerAddr);
        console2.log("WMON:", wmon);
        console2.log("USDC:", usdc);

        // ============================================================
        // 1. Transfer registry ownership to the Governor (as deployer/owner)
        // ============================================================
        vm.startBroadcast(deployerPk);
        if (Ownable(cviAddr).owner() != governor) {
            cvi.transferOwnership(governor);
            console2.log("CVI Registry ownership ->", governor);
        } else {
            console2.log("CVI Registry already owned by governor");
        }
        if (Ownable(cvaAddr).owner() != governor) {
            cva.transferOwnership(governor);
            console2.log("CVA Registry ownership ->", governor);
        } else {
            console2.log("CVA Registry already owned by governor");
        }
        vm.stopBroadcast();

        // ============================================================
        // 2-4. Governor-side setup (registrations + pair creation)
        // ============================================================
        uint256 governorPk = Vm(CHEATCODE_ADDRESS).envOr("GOVERNOR_PRIVATE_KEY", deployerPk);
        vm.startBroadcast(governorPk);

        // 2. Register WMON + USDC as verified CVA assets.
        if (!cva.isVerifiedAsset(wmon)) {
            cva.registerAsset(wmon, address(0), "WMON", "Wrapped Monad", 18, false, address(0), address(0));
            console2.log("Registered WMON as CVA");
        } else {
            console2.log("WMON already CVA-verified");
        }
        if (!cva.isVerifiedAsset(usdc)) {
            cva.registerAsset(usdc, address(0), "USDC", "USD Coin", 6, false, address(0), address(0));
            console2.log("Registered USDC as CVA");
        } else {
            console2.log("USDC already CVA-verified");
        }

        // 3. Register Governor + Router as verified CVI wallets.
        uint256 farFuture = block.timestamp + 365 days;
        string[] memory countries = new string[](1);
        countries[0] = "US";

        if (!cvi.isVerified(governor)) {
            cvi.registerWallet(governor, 1, 0, "G", "SG", countries, farFuture, 1);
            console2.log("Registered Governor in CVI");
        } else {
            console2.log("Governor already CVI-verified");
        }
        if (!cvi.isVerified(routerAddr)) {
            cvi.registerWallet(routerAddr, 1, 0, "G", "SG", countries, farFuture, 2);
            console2.log("Registered Router in CVI");
        } else {
            console2.log("Router already CVI-verified");
        }

        // 4. Create the WMON/USDC pair (reverts if either asset is not CVA-verified).
        address pair = factory.getPair(wmon, usdc);
        if (pair == address(0)) {
            pair = factory.createPair(wmon, usdc);
            console2.log("Created WMON/USDC pair at:", pair);
        } else {
            console2.log("WMON/USDC pair already exists at:", pair);
        }

        // ============================================================
        // 5. (Optional) Seed liquidity — only when tokens have real code
        //    (skip on local Anvil where WMON/USDC are placeholder addresses).
        // ============================================================
        if (Vm(CHEATCODE_ADDRESS).envOr("SEED_LIQUIDITY", false)) {
            IERC20(wmon).approve(address(router), WMON_SEED);
            IERC20(usdc).approve(address(router), USDC_SEED);
            router.addLiquidity(
                wmon,
                usdc,
                WMON_SEED,
                USDC_SEED,
                WMON_SEED * 99 / 100,
                USDC_SEED * 99 / 100,
                governor,
                block.timestamp + 3600
            );
            console2.log("Seeded initial liquidity WMON/USDC");
        } else {
            console2.log("Skipped liquidity seeding (SEED_LIQUIDITY not set)");
        }

        vm.stopBroadcast();
    }
}
