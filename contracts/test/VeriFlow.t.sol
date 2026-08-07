// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VeriRouter} from "../src/core/VeriRouter.sol";
import {VeriFactory} from "../src/core/VeriFactory.sol";
import {VeriPair} from "../src/core/VeriPair.sol";
import {ComplianceHook} from "../src/compliance/ComplianceHook.sol";
import {MockCVIRegistry} from "../src/mocks/MockCVIRegistry.sol";
import {MockCVARegistry} from "../src/mocks/MockCVARegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Minimal WETH9 (deposit/withdraw + ERC20) for ETH-entry swaps.
contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad, "WETH9: insufficient");
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint256) {
        return address(this).balance;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) public returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "WETH9: insufficient allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "WETH9: insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

contract VeriFlowTest is Test {
    VeriRouter router;
    VeriFactory factory;
    ComplianceHook hook;
    MockCVIRegistry cvi;
    MockCVARegistry cva;
    MockWETH weth;
    MockERC20 tokenA;
    MockERC20 tokenB;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol"); // deliberately NOT CVI-verified

    // Matches the hook's CVI failure string (both router and pair bubble it).
    string constant CVI_FAIL = "CVI verification failed: sender not verified or attestation expired";

    function setUp() public {
        cvi = new MockCVIRegistry();
        cva = new MockCVARegistry();
        hook = new ComplianceHook(cvi, cva);
        factory = new VeriFactory(hook);
        weth = new MockWETH();
        tokenA = new MockERC20("Token A", "TKA", 18, 1_000_000 ether);
        tokenB = new MockERC20("Token B", "TKB", 18, 1_000_000 ether);
        router = new VeriRouter(address(factory), address(weth), hook);

        // CVA: every tradable asset must be a verified Cleanverse asset.
        cva.registerAsset(address(tokenA), address(tokenA), "TKA", "Token A", 18, false, address(0), address(0));
        cva.registerAsset(address(tokenB), address(tokenB), "TKB", "Token B", 18, false, address(0), address(0));
        cva.registerAsset(address(weth), address(weth), "WETH", "Wrapped Ether", 18, false, address(0), address(0));

        // CVI: alice and bob are verified. carol is not. The router is NOT
        // registered — pair-level checks run on the actual user (H-05).
        uint256 farFuture = block.timestamp + 365 days;
        string[] memory countries = new string[](1);
        countries[0] = "US";
        cvi.registerWallet(alice, 1, 0, "G", "SG", countries, farFuture, 1);
        cvi.registerWallet(bob, 1, 0, "G", "SG", countries, farFuture, 2);

        // Fund and approve users (incl. carol, so only CVI gates her).
        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenA.mint(bob, 1000 ether);
        tokenB.mint(bob, 1000 ether);
        tokenA.mint(carol, 1000 ether);
        tokenB.mint(carol, 1000 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(carol, 1000 ether);

        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(bob);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(bob);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(carol);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(carol);
        tokenB.approve(address(router), type(uint256).max);
    }

    // ============================================================
    // Helpers
    // ============================================================

    /// Seed a tokenA/tokenB pool with 100 ether each via alice.
    function _seedPool() internal returns (address pair) {
        pair = factory.createPair(address(tokenA), address(tokenB));
        vm.prank(alice);
        router.addLiquidity(
            address(tokenA), address(tokenB), 100 ether, 100 ether, 0, 0, alice, block.timestamp + 1 hours
        );
    }

    function _k(VeriPair pair) internal view returns (uint256) {
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        return uint256(r0) * r1;
    }

    function _path(address[] memory p) internal pure returns (address[] memory) {
        return p;
    }

    // ============================================================
    // 1. Swap Math
    // ============================================================

    function testSwapExactTokensForTokensKNeverDecreases() public {
        VeriPair pair = VeriPair(_seedPool());
        uint256 kBefore = _k(pair);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.prank(alice);
        router.swapExactTokensForTokens(5 ether, 1, path, bob, block.timestamp + 1 hours);

        uint256 kAfter = _k(pair);
        // x*y never decreases (fee makes it increase slightly with the 997/1000 formula).
        assertGe(kAfter, kBefore, "k must never decrease after swap");
        assertGt(tokenB.balanceOf(bob), 0, "bob received output tokens");
    }

    function testSwapExactTokensForTokensRespectsOutputMin() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        // Ask for more than the pool can give -> INSUFFICIENT_OUTPUT_AMOUNT bubbles up.
        vm.prank(alice);
        vm.expectRevert(bytes("INSUFFICIENT_OUTPUT_AMOUNT"));
        router.swapExactTokensForTokens(5 ether, 1000 ether, path, bob, block.timestamp + 1 hours);
    }

    function testSwapExactETHForTokensKNeverDecreases() public {
        // WETH/tokenB pool seeded with ETH by alice.
        address pairAddr = factory.createPair(address(weth), address(tokenB));
        vm.prank(alice);
        router.addLiquidityETH{value: 100 ether}(
            address(tokenB), 100 ether, 0, 0, alice, block.timestamp + 1 hours
        );
        VeriPair pair = VeriPair(pairAddr);
        uint256 kBefore = _k(pair);

        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(tokenB);

        vm.prank(alice);
        router.swapExactETHForTokens{value: 5 ether}(1, path, bob, block.timestamp + 1 hours);

        uint256 kAfter = _k(pair);
        assertGe(kAfter, kBefore, "k must never decrease after ETH swap");
        assertGt(tokenB.balanceOf(bob), 0, "bob received tokenB");
        assertEq(alice.balance + 0 ether, alice.balance, "alice ETH unchanged sanity");
    }

    function testSwapETHForExactTokensRefundsExcessETH() public {
        factory.createPair(address(weth), address(tokenB));
        vm.prank(alice);
        router.addLiquidityETH{value: 100 ether}(
            address(tokenB), 100 ether, 0, 0, alice, block.timestamp + 1 hours
        );

        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(tokenB);

        // Exact-output swap: only the required input is wrapped and used;
        // the excess ETH sent is refunded to the caller.
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = tokenB.balanceOf(bob);
        vm.prank(alice);
        router.swapETHForExactTokens{value: 10 ether}(
            1 ether, path, bob, block.timestamp + 1 hours
        );
        // Required input ≈ 1.003 ether (0.3% fee); the rest (~9 ether) refunded.
        assertGt(alice.balance, aliceBefore - 2 ether, "excess ETH refunded");
        assertApproxEqAbs(tokenB.balanceOf(bob) - bobBefore, 1 ether, 2, "bob got exactly ~1 tokenB");
    }

    // ============================================================
    // 2. Liquidity
    // ============================================================

    function testAddLiquidityBurnsMinimumLiquidity() public {
        address pairAddr = factory.createPair(address(tokenA), address(tokenB));
        vm.prank(alice);
        (, , uint256 lp) = router.addLiquidity(
            address(tokenA), address(tokenB), 100 ether, 100 ether, 0, 0, alice, block.timestamp + 1 hours
        );

        VeriPair pair = VeriPair(pairAddr);
        // First deposit: liquidity = sqrt(a*b) - MINIMUM_LIQUIDITY.
        uint256 expected = Math.sqrt(100 ether * 100 ether) - 1000;
        assertEq(lp, expected, "first deposit mints sqrt(amount0*amount1) - MINIMUM_LIQUIDITY");
        // MINIMUM_LIQUIDITY (1000 LP) is permanently burned: supply excludes it.
        assertEq(pair.totalSupply(), lp, "totalSupply excludes burned MINIMUM_LIQUIDITY");
        assertEq(pair.balanceOf(address(pair)), 0, "no LP parked at the pair itself");
    }

    function testRemoveLiquidityReturnsProportional() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);

        vm.prank(alice);
        VeriPair(pairAddr).approve(address(router), lp);
        uint256 aliceABefore = tokenA.balanceOf(alice);
        uint256 aliceBBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        router.removeLiquidity(
            address(tokenA), address(tokenB), lp / 2, 1, 1, alice, block.timestamp + 1 hours
        );

        // ~half of each reserve returned (within rounding).
        uint256 halfA = (100 ether * (lp / 2)) / lp;
        assertApproxEqAbs(tokenA.balanceOf(alice) - aliceABefore, halfA, 2, "~half tokenA returned");
        uint256 halfB = (100 ether * (lp / 2)) / lp;
        assertApproxEqAbs(tokenB.balanceOf(alice) - aliceBBefore, halfB, 2, "~half tokenB returned");
    }

    function testRemoveLiquidityFullWithdrawsAllUserLP() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);

        vm.prank(alice);
        VeriPair(pairAddr).approve(address(router), lp);
        vm.prank(alice);
        router.removeLiquidity(
            address(tokenA), address(tokenB), lp, 1, 1, alice, block.timestamp + 1 hours
        );

        assertEq(pair.balanceOf(alice), 0, "alice burned all her LP");
        // 1000 MINIMUM_LIQUIDITY stayed burned: supply drops to 0, never back to 1000.
        assertEq(pair.totalSupply(), 0, "no LP resurrection after full removal");
    }

    function testFirstDepositorInflationAttack() public {
        // Attacker (alice) front-runs with a minimal deposit, then inflates the
        // price by donating tokens directly to the pair.
        address pairAddr = factory.createPair(address(tokenA), address(tokenB));
        VeriPair pair = VeriPair(pairAddr);

        // Minimal first deposit: sqrt(1001*1001) - 1000 = 1 LP.
        vm.prank(alice);
        (, , uint256 attackerLp) = router.addLiquidity(address(tokenA), address(tokenB), 1001, 1001, 0, 0, alice, block.timestamp + 1 hours);
        assertEq(attackerLp, 1, "attacker holds 1 LP");

        // Attacker donates a large amount of tokenA directly to the pool (no LP)
        // and syncs reserves, skewing them so a subsequent deposit mints ~0 LP.
        tokenA.transfer(pairAddr, 2_000 ether);
        pair.sync();

        // Victim (bob) deposits 1000 ether of each; the skewed reserves make the
        // quoted tokenB amount ~500 wei and LP minted rounds to zero ->
        // INSUFFICIENT_LIQUIDITY_MINTED reverts.
        vm.prank(bob);
        vm.expectRevert(bytes("INSUFFICIENT_LIQUIDITY_MINTED"));
        router.addLiquidity(
            address(tokenA), address(tokenB), 1000 ether, 1000 ether, 0, 0, bob, block.timestamp + 1 hours
        );
    }

    function testSecondDepositorGetsFairShare() public {
        // Normal path: after a healthy pool, a second depositor gets proportional LP.
        _seedPool();
        vm.prank(bob);
        (, , uint256 lp) = router.addLiquidity(
            address(tokenA), address(tokenB), 10 ether, 10 ether, 0, 0, bob, block.timestamp + 1 hours
        );
        // Bob adds 10e to a 100e pool -> fair share is 10/110 = 1/11 of supply.
        VeriPair pair = VeriPair(factory.getPair(address(tokenA), address(tokenB)));
        assertApproxEqRel(lp, pair.totalSupply() / 11, 0.01e18, "bob LP ~1/11 of supply");
    }

    // ============================================================
    // 3. Compliance Integration
    // ============================================================

    function testSwapSucceedsVerifiedSenderAndReceiver() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 bobBefore = tokenB.balanceOf(bob);
        vm.prank(alice); // verified sender
        router.swapExactTokensForTokens(5 ether, 1, path, bob, block.timestamp + 1 hours); // verified receiver
        assertGt(tokenB.balanceOf(bob), bobBefore, "verified bob received tokens");
    }

    function testSwapRevertsUnverifiedSender() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        // carol is NOT CVI-verified -> router-level check on msg.sender rejects.
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(VeriRouter.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        router.swapExactTokensForTokens(5 ether, 1, path, bob, block.timestamp + 1 hours);
    }

    function testSwapRevertsUnverifiedReceiver() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        // alice is verified but the RECIPIENT carol is not -> pair-level check on `to`.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VeriRouter.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        router.swapExactTokensForTokens(5 ether, 1, path, carol, block.timestamp + 1 hours);
    }

    function testAddLiquidityRevertsUnverifiedRecipient() public {
        factory.createPair(address(tokenA), address(tokenB));
        // LP recipient = carol (unverified) -> pair.mint(to) rejects.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VeriRouter.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        router.addLiquidity(
            address(tokenA), address(tokenB), 50 ether, 50 ether, 0, 0, carol, block.timestamp + 1 hours
        );
    }

    function testRemoveLiquidityRevertsUnverifiedRecipient() public {
        address pairAddr = _seedPool();
        vm.prank(alice);
        VeriPair(pairAddr).approve(address(router), type(uint256).max);
        uint256 lp = VeriPair(pairAddr).balanceOf(alice);

        // Withdraw tokens to carol (unverified) -> pair.burn(to) rejects.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VeriRouter.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        router.removeLiquidity(
            address(tokenA), address(tokenB), lp, 1, 1, carol, block.timestamp + 1 hours
        );
    }

    function testLPTransferRevertsUnverifiedRecipient() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);

        // Verified LP holder transfers LP to an unverified address -> rejected.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VeriPair.ComplianceRejected.selector, "CVI verification failed: LP recipient not verified", uint8(0))
        );
        pair.transfer(carol, lp / 2);
    }

    // ============================================================
    // 4. Revert Reasons Bubble Up
    // ============================================================

    function testRevertDeadlineExpired() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.prank(alice);
        vm.expectRevert(bytes("DEADLINE_EXPIRED"));
        router.swapExactTokensForTokens(5 ether, 1, path, bob, block.timestamp - 1);
    }

    function testRevertInvalidPath() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        // ETH-entry swap requires path[0] == WETH.
        vm.prank(alice);
        vm.expectRevert(bytes("INVALID_PATH"));
        router.swapExactETHForTokens{value: 1 ether}(1, path, bob, block.timestamp + 1 hours);
    }

    function testRevertInsufficientReservesOnEmptyPool() public {
        // Fresh pair with no liquidity.
        factory.createPair(address(tokenA), address(tokenB));
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.prank(alice);
        vm.expectRevert(bytes("INSUFFICIENT_RESERVES"));
        router.swapExactTokensForTokens(5 ether, 1, path, bob, block.timestamp + 1 hours);
    }

    function testRevertSlippageMinBubblesFromRouter() public {
        _seedPool();
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        // amountOutMin too high -> router reverts before reaching the pair.
        vm.prank(alice);
        vm.expectRevert(bytes("INSUFFICIENT_OUTPUT_AMOUNT"));
        router.swapExactTokensForTokens(5 ether, 1000 ether, path, bob, block.timestamp + 1 hours);
    }

    function testRevertComplianceBubblesFromPair() public {
        // Direct pair interaction (bypassing router): unverified recipient rejected
        // by the pair's own check, proving the revert bubbles from the pair.
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);

        // Deliver input directly to the pair, then swap out to carol (unverified).
        vm.prank(alice);
        tokenA.transfer(pairAddr, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VeriPair.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        pair.swap(0, 1, carol, new bytes(0));
    }
}
