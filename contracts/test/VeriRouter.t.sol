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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal WETH9 for tests (deposit/withdraw + ERC20).
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

contract VeriRouterTest is Test {
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

    uint256 constant TEN = 10 ether;

    function setUp() public {
        cvi = new MockCVIRegistry();
        cva = new MockCVARegistry();
        hook = new ComplianceHook(cvi, cva);
        factory = new VeriFactory(hook);
        weth = new MockWETH();
        tokenA = new MockERC20("Token A", "TKA", 18, 1_000_000 ether);
        tokenB = new MockERC20("Token B", "TKB", 18, 1_000_000 ether);
        router = new VeriRouter(address(factory), address(weth), hook);

        // CVA: all three assets must be verified for pairs to be created.
        cva.registerAsset(address(tokenA), address(tokenA), "TKA", "Token A", 18, false, address(0), address(0));
        cva.registerAsset(address(tokenB), address(tokenB), "TKB", "Token B", 18, false, address(0), address(0));
        cva.registerAsset(address(weth), address(weth), "WETH", "Wrapped Ether", 18, false, address(0), address(0));

        // CVI: wallets must be verified. NOTE: the ROUTER no longer needs
        // registration — pair-level checks run on the ACTUAL user (`to` for
        // swaps/adds, `from` for LP transfers), not on msg.sender (H-05).
        uint256 farFuture = block.timestamp + 365 days;
        string[] memory countries = new string[](1);
        countries[0] = "US";
        cvi.registerWallet(alice, 1, 0, "G", "SG", countries, farFuture, 1);
        cvi.registerWallet(bob, 1, 0, "G", "SG", countries, farFuture, 2);
        // The router is deliberately NOT registered — pair-level checks now run
        // on the actual user (`to`), proving H-05: msg.sender (router) is never
        // the compliance subject anymore.

        // Fund users.
        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenB.mint(bob, 1000 ether);
        tokenA.mint(bob, 1000 ether);
        deal(address(weth), alice, 0);

        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(bob);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(bob);
        tokenA.approve(address(router), type(uint256).max);
    }

    function _createPool() internal returns (address pairAddr) {
        pairAddr = factory.createPair(address(tokenA), address(tokenB));
        // Seed a 1:1 tokenA/tokenB pool via the router (both ERC20s).
        vm.startPrank(alice);
        router.addLiquidity(address(tokenA), address(tokenB), 100 ether, 100 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function testAddLiquidityPullsOnlyOptimalAmounts() public {
        address pairAddr = factory.createPair(address(tokenA), address(tokenB));

        // alice approves MORE than the optimal (excess must NOT be pulled).
        vm.prank(alice);
        tokenA.approve(address(router), 500 ether);
        vm.deal(alice, 100 ether);
        uint256 aliceBalanceBefore = tokenA.balanceOf(alice);

        vm.prank(alice);
        // First liquidity: exact amounts used.
        router.addLiquidity(address(tokenA), address(tokenB), 50 ether, 50 ether, 0, 0, alice, block.timestamp + 1 hours);

        uint256 aliceBalanceAfter = tokenA.balanceOf(alice);
        assertEq(aliceBalanceBefore - aliceBalanceAfter, 50 ether, "only optimal tokenA pulled");

        // Bob adds with a sub-optimal ratio: router must pull optimal (quote) amounts only.
        vm.prank(bob);
        tokenB.approve(address(router), 500 ether);
        uint256 bobBBefore = tokenB.balanceOf(bob);
        vm.prank(bob);
        router.addLiquidity(address(tokenA), address(tokenB), 25 ether, 100 ether, 0, 0, bob, block.timestamp + 1 hours);
        uint256 bobBAfter = tokenB.balanceOf(bob);
        // amountBOptimal = quote(25 ether, reserveA=50, reserveB=50) = 25 ether → pulls 25, NOT 100.
        assertEq(bobBBefore - bobBAfter, 25 ether, "optimal amountB pulled, excess stays with user");

        // Router must not hold any tokens (nothing stranded by refund logic).
        assertEq(IERC20(address(tokenA)).balanceOf(address(router)), 0, "router holds no tokenA");
        assertEq(IERC20(address(tokenB)).balanceOf(address(router)), 0, "router holds no tokenB");
    }

    function testAddLiquidityETHDeliversWethToPair() public {
        address pairAddr = factory.createPair(address(tokenA), address(weth));
        vm.deal(alice, 100 ether);
        uint256 pairWethBefore = IERC20(address(weth)).balanceOf(pairAddr);

        vm.prank(alice);
        router.addLiquidityETH{value: 50 ether}(address(tokenA), 100 ether, 0, 0, alice, block.timestamp + 1 hours);

        uint256 pairWethAfter = IERC20(address(weth)).balanceOf(pairAddr);
        assertEq(pairWethAfter - pairWethBefore, 50 ether, "pair received the WETH");
        // Router must not keep WETH.
        assertEq(IERC20(address(weth)).balanceOf(address(router)), 0, "router holds no WETH");
        // LP minted to alice.
        assertGt(VeriPair(pairAddr).balanceOf(alice), 0, "alice got LP");
    }

    function testSwapExactTokensForTokensUsesPairSwap() public {
        _createPool();

        uint256 bobABefore = tokenA.balanceOf(bob);
        uint256 bobBBefore = tokenB.balanceOf(bob);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 expected = router.getAmountsOut(1 ether, path)[1];
        vm.prank(bob);
        uint256[] memory amounts = router.swapExactTokensForTokens(1 ether, 0, path, bob, block.timestamp + 1 hours);

        assertEq(amounts[1], expected, "amounts from router match quote");
        assertEq(tokenB.balanceOf(bob) - bobBBefore, expected, "bob received output token");
        assertEq(tokenA.balanceOf(bob), bobABefore - 1 ether, "bob paid input token");
        // Router must not hold either token.
        assertEq(IERC20(address(tokenA)).balanceOf(address(router)), 0, "router holds no tokenA");
        assertEq(IERC20(address(tokenB)).balanceOf(address(router)), 0, "router holds no tokenB");
    }

    function testSwapExactETHForTokens() public {
        address pairAddr = factory.createPair(address(tokenA), address(weth));
        // Seed WETH side.
        vm.deal(alice, 200 ether);
        vm.startPrank(alice);
        router.addLiquidityETH{value: 100 ether}(address(tokenA), 100 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();

        uint256 pairWethBefore = IERC20(address(weth)).balanceOf(pairAddr);
        uint256 bobTokensBefore = tokenA.balanceOf(bob);
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(tokenA);

        vm.deal(bob, 10 ether);
        vm.prank(bob);
        uint256[] memory amounts = router.swapExactETHForTokens{value: 10 ether}(0, path, bob, block.timestamp + 1 hours);

        // WETH was deposited and delivered into the pair.
        assertEq(IERC20(address(weth)).balanceOf(pairAddr) - pairWethBefore, 10 ether, "pair got the WETH");
        assertEq(IERC20(address(weth)).balanceOf(address(router)), 0, "router holds no WETH");
        assertEq(tokenA.balanceOf(bob) - bobTokensBefore, amounts[1], "bob received tokens");
        // No refund expected for exact swap.
        assertEq(bob.balance, 0 ether, "bob spent exactly the ETH");
    }

    function testSwapTokensForExactETHUnwrapsOnce() public {
        address pairAddr = factory.createPair(address(tokenA), address(weth));
        vm.deal(alice, 200 ether);
        vm.startPrank(alice);
        router.addLiquidityETH{value: 100 ether}(address(tokenA), 100 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();
        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(weth);

        uint256 bobEthBefore = bob.balance;
        vm.prank(bob);
        uint256[] memory amounts = router.swapTokensForExactETH(1 ether, type(uint256).max, path, bob, block.timestamp + 1 hours);

        assertEq(bob.balance - bobEthBefore, 1 ether, "bob received ETH exactly once");
        // WETH must NOT remain in the router.
        assertEq(IERC20(address(weth)).balanceOf(address(router)), 0, "router holds no WETH");
        // Bob paid the input token (amounts[0]).
        assertEq(tokenA.balanceOf(bob), 1000 ether - amounts[0], "bob paid input tokens");
    }

    function testRemoveLiquidityETHNoDoubleSend() public {
        address pairAddr = factory.createPair(address(tokenA), address(weth));
        vm.deal(alice, 200 ether);
        vm.startPrank(alice);
        router.addLiquidityETH{value: 100 ether}(address(tokenA), 100 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();

        uint256 lp = VeriPair(pairAddr).balanceOf(alice);
        vm.prank(alice);
        VeriPair(pairAddr).approve(address(router), type(uint256).max);
        uint256 aliceTokensBefore = tokenA.balanceOf(alice);
        uint256 aliceEthBefore = alice.balance;

        vm.prank(alice);
        (uint256 amountToken, uint256 amountETH) = router.removeLiquidityETH(address(tokenA), lp, 0, 0, alice, block.timestamp + 1 hours);

        // Token delivered exactly once, ETH delivered exactly once.
        assertEq(tokenA.balanceOf(alice) - aliceTokensBefore, amountToken, "token delivered once");
        assertEq(alice.balance - aliceEthBefore, amountETH, "ETH delivered once");
        // Router holds nothing afterwards.
        assertEq(IERC20(address(tokenA)).balanceOf(address(router)), 0, "router holds no token");
        assertEq(IERC20(address(weth)).balanceOf(address(router)), 0, "router holds no WETH");
        assertEq(address(router).balance, 0, "router holds no ETH");
    }

    function testMultiHopSwap() public {
        address pairAB = factory.createPair(address(tokenA), address(tokenB));
        address pairBW = factory.createPair(address(tokenB), address(weth));

        // Seed both pools.
        vm.deal(alice, 200 ether);
        vm.prank(alice);
        tokenB.approve(address(router), type(uint256).max);
        vm.startPrank(alice);
        tokenA.transfer(pairAB, 100 ether);
        tokenB.transfer(pairAB, 100 ether);
        VeriPair(pairAB).mint(alice);
        router.addLiquidityETH{value: 100 ether}(address(tokenB), 100 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();
        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(router), type(uint256).max);

        // Bob swaps tokenA -> tokenB -> WETH across two pairs.
        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(weth);

        vm.prank(bob);
        uint256[] memory amounts = router.swapExactTokensForTokens(1 ether, 0, path, bob, block.timestamp + 1 hours);

        assertGt(amounts[2], 0, "multi-hop output > 0");
        // Final output lands as WETH in bob's wallet (path ends in WETH via tokens-for-tokens).
        assertGt(IERC20(address(weth)).balanceOf(bob), 0, "bob received WETH at path end");
        // Router holds nothing.
        assertEq(IERC20(address(tokenA)).balanceOf(address(router)), 0, "router holds no tokenA");
        assertEq(IERC20(address(tokenB)).balanceOf(address(router)), 0, "router holds no tokenB");
        assertEq(IERC20(address(weth)).balanceOf(address(router)), 0, "router holds no WETH");
    }
}
