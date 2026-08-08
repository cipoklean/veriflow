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
        // NEW-01: the factory must know the router so pairs can exempt
        // router-mediated calls from the CVI(msg.sender) check. The router
        // itself stays CVI-unregistered (proven by the multi-hop regression).
        factory.setRouter(address(router));

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

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        router.swapExactETHForTokens{value: 5 ether}(1, path, bob, block.timestamp + 1 hours);

        uint256 kAfter = _k(pair);
        assertGe(kAfter, kBefore, "k must never decrease after ETH swap");
        assertGt(tokenB.balanceOf(bob), 0, "bob received tokenB");
        // NEW-12: the intended invariant — alice paid exactly her 5 ether input
        // (swapExactETHForTokens spends msg.value in full; the router only
        // refunds when msg.value > amounts[0], and amounts[0] == msg.value for
        // an exact-input swap). Her ETH balance must drop by exactly 5 ether.
        assertEq(alice.balance, aliceBefore - 5 ether, "alice paid exactly her 5 ether input");
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
        // NEW-02: MINIMUM_LIQUIDITY (1000 LP) is PERMANENTLY locked at the dead
        // address — the mint-to-self-then-burn trick was a net no-op and left no
        // lock. The dead shares must stay in totalSupply forever.
        address DEAD = 0x000000000000000000000000000000000000dEaD;
        assertEq(pair.balanceOf(DEAD), 1000, "dead address holds MINIMUM_LIQUIDITY");
        assertEq(pair.totalSupply(), lp + 1000, "totalSupply includes the permanently locked shares");
    }

    function testRemoveLiquidityReturnsProportional() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);

        vm.prank(alice);
        VeriPair(pairAddr).approve(address(router), lp);
        uint256 aliceABefore = tokenA.balanceOf(alice);
        uint256 aliceBBefore = tokenB.balanceOf(alice);
        // Share math uses the PRE-removal totalSupply (which includes the 1000
        // permanently-locked dead shares, NEW-02).
        uint256 totalSupply = pair.totalSupply();

        vm.prank(alice);
        router.removeLiquidity(
            address(tokenA), address(tokenB), lp / 2, 1, 1, alice, block.timestamp + 1 hours
        );

        // ~half of each reserve returned (within rounding).
        uint256 halfA = (100 ether * (lp / 2)) / totalSupply;
        assertApproxEqAbs(tokenA.balanceOf(alice) - aliceABefore, halfA, 2, "~half tokenA returned");
        uint256 halfB = (100 ether * (lp / 2)) / totalSupply;
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
        // NEW-02: the 1000 MINIMUM_LIQUIDITY dead shares stay locked forever —
        // totalSupply can never return to 0 (or resurrect the locked liquidity).
        assertEq(pair.totalSupply(), 1000, "dead shares remain locked after full user withdrawal");
    }

    function testFirstDepositorInflationAttack() public {
        // NEW-02: with the permanent MINIMUM_LIQUIDITY lock, a one-sided
        // donation can no longer round a victim's deposit to zero (totalSupply
        // includes the 1000 dead shares), so the classic attack is neutralized.
        address pairAddr = factory.createPair(address(tokenA), address(tokenB));
        VeriPair pair = VeriPair(pairAddr);

        // Attacker seeds minimal + one-sided donation to skew the price.
        vm.prank(alice);
        router.addLiquidity(
            address(tokenA), address(tokenB), 1001, 1001, 0, 0, alice, block.timestamp + 1 hours
        );
        // Donation comes from the test contract (holds the 1M minted supply).
        tokenA.transfer(pairAddr, 2_000 ether);
        pair.sync();

        // Victim deposit must mint POSITIVE LP (not revert with
        // INSUFFICIENT_LIQUIDITY_MINTED) — the dead shares keep supply >= 1001.
        vm.prank(bob);
        (, , uint256 victimLp) = router.addLiquidity(
            address(tokenA), address(tokenB), 1000 ether, 1000 ether, 0, 0, bob, block.timestamp + 1 hours
        );
        assertGt(victimLp, 0, "victim receives positive LP - drain neutralized");
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

    // ============================================================
    // NEW-01: direct pair.swap must not bypass compliance via to == msg.sender
    // ============================================================

    function testDirectPairSwapUnverifiedReverts() public {
        // An unverified user (carol) must NOT be able to call pair.swap directly
        // with to == msg.sender to dodge every compliance check.
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);

        // Deliver input directly to the pair, then swap out to herself.
        vm.prank(carol);
        tokenA.transfer(pairAddr, 1 ether);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(VeriPair.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        pair.swap(0, 1, carol, new bytes(0));
    }

    function testDirectPairSwapVerifiedWorks() public {
        // Same direct flow with a verified user must succeed.
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);

        vm.prank(alice);
        tokenA.transfer(pairAddr, 1 ether);
        // The pair sorts token0/token1 by address, so capture BOTH balances and
        // assert the total increased by exactly the 1 wei output.
        uint256 totalBefore = tokenA.balanceOf(alice) + tokenB.balanceOf(alice);
        vm.prank(alice);
        pair.swap(0, 1, alice, new bytes(0));
        assertEq(
            tokenA.balanceOf(alice) + tokenB.balanceOf(alice),
            totalBefore + 1,
            "verified direct swap delivered exactly 1 wei"
        );
    }

    // ============================================================
    // NEW-02: first-depositor one-sided donation drain
    // ============================================================

    function testFirstDepositorDrainPoC() public {
        // Attacker (alice) seeds the minimal first deposit: 1001 + 1001 wei.
        address pairAddr = factory.createPair(address(tokenA), address(tokenB));
        VeriPair pair = VeriPair(pairAddr);
        vm.prank(alice);
        (, , uint256 attackerLp) = router.addLiquidity(
            address(tokenA), address(tokenB), 1001, 1001, 0, 0, alice, block.timestamp + 1 hours
        );
        assertEq(attackerLp, 1, "attacker mints 1 LP");

        // Victim (bob) makes a one-sided donation: pure tokenA, no LP.
        vm.prank(bob);
        tokenA.transfer(pairAddr, 1_000_000);

        // Attacker exits via the atomic exitLiquidity (pulls HER OWN 1 LP and
        // burns exactly that — the old park-then-burn is gone). Her share of
        // the now-inflated reserves is still bounded by the MINIMUM_LIQUIDITY
        // lock: 1 of 1001 totalSupply cannot extract the donation.
        uint256 aliceABefore = tokenA.balanceOf(alice);
        uint256 aliceBBefore = tokenB.balanceOf(alice);
        vm.prank(alice);
        (uint256 out0, uint256 out1) = pair.exitLiquidity(attackerLp, 0, 0, alice);

        uint256 extracted = (tokenA.balanceOf(alice) - aliceABefore) + (tokenB.balanceOf(alice) - aliceBBefore);
        // Deposited 1001 + 1001 = 2002 wei. With the permanent MINIMUM_LIQUIDITY
        // lock the attacker holds 1 of 1001 totalSupply -> cannot extract more.
        assertLe(extracted, 2002, "attacker cannot extract more than they deposited");
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
    // NEW-03: revoked-user exit path — burn-to-self is allowed, but
    // swapping and transferring LP are not.
    // ============================================================

    function testRevokedUserCanBurnToSelfButNotSwapOrTransfer() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);
        assertGt(lp, 0, "alice holds LP before revocation");

        // Simulate Cleanverse CVI revocation (attestation revoked).
        cvi.setVerified(alice, false);
        assertFalse(cvi.isVerified(alice), "alice is now revoked");

        // 1. Revoked user CANNOT swap.
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VeriRouter.ComplianceRejected.selector, CVI_FAIL, uint8(0))
        );
        router.swapExactTokensForTokens(1 ether, 1, path, alice, block.timestamp + 1 hours);

        // 2. Revoked user CANNOT transfer LP to another wallet.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeriPair.ComplianceRejected.selector,
                "CVI verification failed: LP sender not verified",
                uint8(0)
            )
        );
        pair.transfer(bob, lp / 2);

        // 3. Revoked user CAN exit atomically via exitLiquidity (NEW-13): the
        //    pair pulls HER OWN LP and burns exactly that inside one call — the
        //    underlying assets are redeemed to the same wallet. The old
        //    two-step (park then burn) is deprecated.
        uint256 aliceTokenABefore = tokenA.balanceOf(alice);
        uint256 aliceTokenBBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        (uint256 out0, uint256 out1) = pair.exitLiquidity(lp, 0, 0, alice);

        assertGt(out0, 0, "atomic exit redeemed tokenA");
        assertGt(out1, 0, "atomic exit redeemed tokenB");
        assertEq(pair.balanceOf(alice), 0, "alice's LP fully burned");
        assertEq(tokenA.balanceOf(alice), aliceTokenABefore + out0, "tokenA redeemed to alice");
        assertEq(tokenB.balanceOf(alice), aliceTokenBBefore + out1, "tokenB redeemed to alice");
    }

    // ============================================================
    // NEW-13: atomic revoked-user exit — front-run proof.
    // The old two-step exit (tx1: park LP in the pair, tx2: burn) let any
    // caller burn the pair's ENTIRE parked LP. Exit is now ONE transaction via
    // exitLiquidity(); direct pair.burn() is router-only.
    // ============================================================

    function testExitFrontRunFails() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 aliceLp = pair.balanceOf(alice);
        assertGt(aliceLp, 0, "alice holds LP");

        // Revoke alice — she still holds LP from before revocation.
        cvi.setVerified(alice, false);

        // Alice starts the OLD two-step exit: parks her LP in the pair (tx1).
        vm.prank(alice);
        pair.transfer(pairAddr, aliceLp);
        assertEq(pair.balanceOf(pairAddr), aliceLp, "LP parked in pair");

        // Attacker (bob) front-runs tx2: direct pair.burn must revert — the
        // burn entry is locked to the router now.
        vm.prank(bob);
        vm.expectRevert(bytes("FORBIDDEN"));
        pair.burn(bob);

        // Bob cannot sweep alice's parked LP via exitLiquidity either: it pulls
        // ONLY HIS OWN LP (balanceOf(msg.sender)), never the parked balance.
        vm.prank(bob);
        (, , uint256 bobLp) = router.addLiquidity(
            address(tokenA), address(tokenB), 2 ether, 2 ether, 0, 0, bob, block.timestamp + 1 hours
        );
        uint256 bobABefore = tokenA.balanceOf(bob);
        uint256 bobBBefore = tokenB.balanceOf(bob);
        vm.prank(bob);
        (uint256 out0, uint256 out1) = pair.exitLiquidity(bobLp, 0, 0, bob);

        assertGt(out0, 0, "bob redeemed tokenA");
        assertGt(out1, 0, "bob redeemed tokenB");
        // Bob's gain is bounded by his own contribution (2 ether each + fee share).
        assertLe(tokenA.balanceOf(bob) - bobABefore, 2 ether + 1, "bob gained <= his own tokenA");
        assertLe(tokenB.balanceOf(bob) - bobBBefore, 2 ether + 1, "bob gained <= his own tokenB");
        // Alice's parked LP is untouched by bob's exit — nobody can burn it.
        assertEq(pair.balanceOf(pairAddr), aliceLp, "parked LP untouched");
    }

    function testRevokedUserAtomicExitWorks() public {
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);
        assertGt(lp, 0, "alice holds LP");

        (uint112 r0, uint112 r1, ) = pair.getReserves();
        uint256 totalSupply = pair.totalSupply();
        uint256 expected0 = (lp * uint256(r0)) / totalSupply;
        uint256 expected1 = (lp * uint256(r1)) / totalSupply;
        assertGt(expected0, 0, "expected tokenA share > 0");
        assertGt(expected1, 0, "expected tokenB share > 0");

        cvi.setVerified(alice, false); // revoke alice

        // Mins enforced: ask for more than the share -> revert.
        vm.prank(alice);
        vm.expectRevert(bytes("INSUFFICIENT_A_AMOUNT"));
        pair.exitLiquidity(lp, expected0 + 1, 0, alice);

        // One-tx exit: pull + burn exactly `lp` + redeem to self.
        uint256 aliceABefore = tokenA.balanceOf(alice);
        uint256 aliceBBefore = tokenB.balanceOf(alice);
        vm.prank(alice);
        (uint256 out0, uint256 out1) = pair.exitLiquidity(lp, expected0, expected1, alice);

        assertEq(out0, expected0, "tokenA amount matches share");
        assertEq(out1, expected1, "tokenB amount matches share");
        assertEq(pair.balanceOf(alice), 0, "alice LP fully burned");
        assertEq(pair.balanceOf(pairAddr), 0, "no parked LP remains");
        assertEq(tokenA.balanceOf(alice), aliceABefore + expected0, "tokenA redeemed to alice");
        assertEq(tokenB.balanceOf(alice), aliceBBefore + expected1, "tokenB redeemed to alice");
    }

    function testRouterRemoveLiquidityStillWorks() public {
        // Regression: the router path (transferFrom + burn in ONE router tx)
        // still works after burn is locked to the router.
        address pairAddr = _seedPool();
        VeriPair pair = VeriPair(pairAddr);
        uint256 lp = pair.balanceOf(alice);
        assertGt(lp, 0, "alice holds LP");

        vm.prank(alice);
        pair.approve(address(router), type(uint256).max);
        uint256 aliceABefore = tokenA.balanceOf(alice);
        uint256 aliceBBefore = tokenB.balanceOf(alice);
        vm.prank(alice);
        (uint256 amtA, uint256 amtB) = router.removeLiquidity(
            address(tokenA), address(tokenB), lp, 0, 0, alice, block.timestamp + 1 hours
        );

        assertGt(amtA, 0, "removed tokenA");
        assertGt(amtB, 0, "removed tokenB");
        assertEq(pair.balanceOf(alice), 0, "alice LP fully removed");
        assertEq(tokenA.balanceOf(alice), aliceABefore + amtA, "tokenA returned");
        assertEq(tokenB.balanceOf(alice), aliceBBefore + amtB, "tokenB returned");
        // MINIMUM_LIQUIDITY lock untouched (dead-address shares persist).
        assertEq(pair.balanceOf(0x000000000000000000000000000000000000dEaD), 1000, "dead lock intact");
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
