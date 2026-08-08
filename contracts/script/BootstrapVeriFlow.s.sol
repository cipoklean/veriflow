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
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VeriFlowScriptChecks} from "./VeriFlowScriptChecks.sol";

/**
 * @title BootstrapVeriFlow
 * @notice One-shot setup to make a freshly deployed VeriFlow stack usable:
 *   1. Transfer CVI + CVA registry ownership to the Governor
 *   2. Register WMON + USDC as verified CVA assets
 *   3. Register the Governor as a verified CVI wallet (the Router stays
 *      unregistered — pairs exempt router-mediated calls via factory.router())
 *   4. Create the WMON/USDC pair
 *   5. (Optional, SEED_LIQUIDITY=true) seed initial liquidity
 *
 * @dev NEW-05: deployed-stack addresses (CVI/CVA/hook/factory/router) are read
 * from the LATEST DeployVeriFlow broadcast JSON — the single source of truth:
 *   broadcast/DeployVeriFlow.s.sol/{chainId}/run-latest.json
 * Env overrides (VERI_FACTORY, VERI_ROUTER, CVI_REGISTRY, CVA_REGISTRY,
 * COMPLIANCE_HOOK) still win when set; the broadcast JSON replaces the old
 * hardcoded defaults that went stale after every redeploy.
 *
 * Run with the deployer key first (registry ownership transfer), then the
 * governor key (registration calls) — or the same key when GOVERNOR ==
 * deployer, as in local Anvil runs and the default testnet setup.
 */
contract BootstrapVeriFlow is Script {
    address constant CHEATCODE_ADDRESS = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    // Real Monad testnet tokens (WMON verified live on testnet-rpc 2026-08).
    address constant DEFAULT_WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address constant DEFAULT_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

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
        if (Vm(CHEATCODE_ADDRESS).envOr(key, address(0)) != address(0)) {
            address envAddr = Vm(CHEATCODE_ADDRESS).envAddress(key);
            console2.log(string.concat(key, " (env):"), envAddr);
            return envAddr;
        }
        return defaultAddr;
    }

    // ============================================================
    // NEW-05: read the deployed stack from the latest broadcast JSON.
    // The DeployVeriFlow script returns named values
    // (cviRegistry_, cvaRegistry_, complianceHook_, veriFactory_,
    // veriRouter_, testTokenA_, testTokenB_) which foundry writes into
    // broadcast/DeployVeriFlow.s.sol/{chainId}/run-latest.json under
    // `.returns.<name>.value`.
    // ============================================================
    struct DeployedStack {
        address cvi;
        address cva;
        address hook;
        address factory;
        address router;
    }

    function broadcastPath() internal view returns (string memory) {
        return string.concat(
            "broadcast/DeployVeriFlow.s.sol/",
            Vm(CHEATCODE_ADDRESS).toString(block.chainid),
            "/run-latest.json"
        );
    }

    function loadBroadcastStack() internal returns (DeployedStack memory stack) {
        string memory path = broadcastPath();
        string memory json = Vm(CHEATCODE_ADDRESS).readFile(path);
        stack.cvi = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.cviRegistry_.value");
        stack.cva = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.cvaRegistry_.value");
        stack.hook = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.complianceHook_.value");
        stack.factory = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.veriFactory_.value");
        stack.router = Vm(CHEATCODE_ADDRESS).parseJsonAddress(json, ".returns.veriRouter_.value");
        console2.log("Broadcast stack loaded from:", path);
    }

    // Env override wins; otherwise the broadcast JSON is the single source of
    // truth; if neither resolves, fail loudly instead of silently pointing at
    // stale hardcoded defaults.
    function stackAddress(string memory envKey, address broadcastValue, string memory what) internal returns (address) {
        if (Vm(CHEATCODE_ADDRESS).envOr(envKey, address(0)) != address(0)) {
            address envAddr = Vm(CHEATCODE_ADDRESS).envAddress(envKey);
            console2.log(string.concat(what, " (env):"), envAddr);
            return envAddr;
        }
        require(broadcastValue != address(0), string.concat(what, " missing: set env or run DeployVeriFlow first"));
        console2.log(string.concat(what, " (broadcast):"), broadcastValue);
        return broadcastValue;
    }

    function run() external {
        uint256 deployerPk = Vm(CHEATCODE_ADDRESS).envUint("PRIVATE_KEY");
        address deployer = Vm(CHEATCODE_ADDRESS).addr(deployerPk);

        // Governor: env or default to deployer.
        string memory governorStr = Vm(CHEATCODE_ADDRESS).envString("GOVERNOR");
        address governor = bytes(governorStr).length > 0 ? parseAddress(governorStr) : deployer;

        // NEW-05: deployed stack from the latest broadcast JSON (env wins).
        DeployedStack memory stack = loadBroadcastStack();
        address cviAddr = stackAddress("CVI_REGISTRY", stack.cvi, "CVI Registry");
        address cvaAddr = stackAddress("CVA_REGISTRY", stack.cva, "CVA Registry");
        address hookAddr = stackAddress("COMPLIANCE_HOOK", stack.hook, "ComplianceHook");
        address factoryAddr = stackAddress("VERI_FACTORY", stack.factory, "VeriFactory");
        address routerAddr = stackAddress("VERI_ROUTER", stack.router, "VeriRouter");

        // Tokens: env overrides, else canonical Monad testnet defaults (these
        // are third-party assets, never deployment artifacts).
        address wmon = envOrAddress("WMON", DEFAULT_WMON);
        address usdc = envOrAddress("USDC", DEFAULT_USDC);

        MockCVIRegistry cvi = MockCVIRegistry(cviAddr);
        MockCVARegistry cva = MockCVARegistry(cvaAddr);
        VeriFactory factory = VeriFactory(factoryAddr);
        VeriRouter router = VeriRouter(payable(routerAddr));

        console2.log("Governor:", governor);
        console2.log("ComplianceHook:", hookAddr);
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

        // NEW-01: ensure the factory knows the router (idempotent; the deploy
        // script already set it when GOVERNOR == deployer).
        if (factory.router() != routerAddr) {
            factory.setRouter(routerAddr);
            console2.log("Factory router set to:", routerAddr);
        }

        // 3. Register the Governor as a verified CVI wallet. The Router is
        // deliberately NOT registered: pairs exempt router-mediated calls via
        // factory.router() (NEW-01), so a router CVI entry is redundant — and
        // the test suite asserts the router stays unregistered.
        uint256 farFuture = block.timestamp + 365 days;
        string[] memory countries = new string[](1);
        countries[0] = "US";

        if (!cvi.isVerified(governor)) {
            cvi.registerWallet(governor, 1, 0, "G", "SG", countries, farFuture, 1);
            console2.log("Registered Governor in CVI");
        } else {
            console2.log("Governor already CVI-verified");
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
        // 5. (Optional) Seed liquidity — SEED_LIQUIDITY=true.
        // The governor funds the pool: mints mock USDC when the USDC address
        // is a MockERC20 the governor owns (falls back to an existing balance
        // for real tokens like Circle FiatToken), wraps native MON into WMON
        // when short, then approves the router and adds liquidity.
        // ============================================================
        if (Vm(CHEATCODE_ADDRESS).envOr("SEED_LIQUIDITY", false)) {
            uint256 wmonSeed = Vm(CHEATCODE_ADDRESS).envOr("SEED_WMON", uint256(100e18));
            uint256 usdcSeed = Vm(CHEATCODE_ADDRESS).envOr("SEED_USDC", uint256(10_000e6));

            // Fund USDC: only mint when USDC is OUR MockERC20 (governor-owned).
            // Real tokens (Circle FiatToken) have a different owner — minting
            // them would create a failed broadcast tx, so detect first via the
            // read-only owner() and fall back to the existing balance.
            try MockERC20(usdc).owner() returns (address usdcOwner) {
                if (usdcOwner == governor) {
                    MockERC20(usdc).mint(governor, usdcSeed);
                    console2.log("Minted mock USDC for governor");
                } else {
                    console2.log("USDC not governor-owned (real token) - using existing balance");
                }
            } catch {
                console2.log("USDC has no owner() - using existing balance");
            }

            // Fund WMON: wrap native MON when the governor is short.
            uint256 wmonBal = IERC20(wmon).balanceOf(governor);
            if (wmonBal < wmonSeed) {
                MockWETH(payable(wmon)).deposit{value: wmonSeed - wmonBal}();
                console2.log("Wrapped MON into WMON for governor");
            }

            // Approve the router and add liquidity (1:1 pool at 100 USDC/WMON).
            IERC20(wmon).approve(address(router), wmonSeed);
            IERC20(usdc).approve(address(router), usdcSeed);
            router.addLiquidity(
                wmon,
                usdc,
                wmonSeed,
                usdcSeed,
                wmonSeed * 99 / 100,
                usdcSeed * 99 / 100,
                governor,
                block.timestamp + 3600
            );
            console2.log("Seeded initial liquidity WMON/USDC:", wmonSeed, ":", usdcSeed);
        } else {
            console2.log("Skipped liquidity seeding (SEED_LIQUIDITY not set)");
        }

        // ============================================================
        // NEW-09 + NEW-14: feeToSetter governance.
        // FEE_TO_SETTER comes from env; when UNSET it defaults to the GOVERNOR
        // key — NEVER to an anvil default account (asserted below). This keeps
        // fee collection out of the deployer key's hands while guaranteeing
        // the address is a real controlled wallet.
        // ============================================================
        string memory feeToSetterStr = Vm(CHEATCODE_ADDRESS).envOr("FEE_TO_SETTER", string(""));
        address feeToSetter = bytes(feeToSetterStr).length > 0 ? parseAddress(feeToSetterStr) : governor;
        // NEW-14: hard post-deploy assertion — reverts the whole script if the
        // resolved feeToSetter is one of the 10 well-known anvil accounts.
        VeriFlowScriptChecks.assertNotAnvilDefault(feeToSetter);
        if (factory._feeToSetter() != feeToSetter) {
            factory.setFeeToSetter(feeToSetter);
            console2.log("feeToSetter transferred to:", feeToSetter);
        } else {
            console2.log("feeToSetter already:", feeToSetter);
        }

        vm.stopBroadcast();
    }
}
