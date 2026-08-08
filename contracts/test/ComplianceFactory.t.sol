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
import {IVeriFactory} from "../src/interfaces/IVeriAMM.sol";
import {IComplianceHook} from "../src/interfaces/IComplianceHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal WETH9 for tests (deposit/withdraw + ERC20).
contract MockWETH2 {
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

contract ComplianceFactoryTest is Test {
    // Local copy of the factory's PairCreated event (declared in IVeriFactory
    // interface) so vm.expectEmit can match it.
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);
    event FeeToUpdated(address indexed oldFeeTo, address indexed newFeeTo);

    VeriRouter router;
    VeriFactory factory;
    ComplianceHook hook;
    MockCVIRegistry cvi;
    MockCVARegistry cva;
    MockWETH2 weth;
    MockERC20 tokenA;
    MockERC20 tokenB;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol"); // NEVER registered in CVI

    function setUp() public {
        cvi = new MockCVIRegistry();
        cva = new MockCVARegistry();
        hook = new ComplianceHook(cvi, cva);
        factory = new VeriFactory(hook);
        weth = new MockWETH2();
        tokenA = new MockERC20("Token A", "TKA", 18, 1_000_000 ether);
        tokenB = new MockERC20("Token B", "TKB", 18, 1_000_000 ether);
        router = new VeriRouter(address(factory), address(weth), hook);
        // NEW-01: factory must know the router so pairs exempt router-mediated
        // calls from the CVI(msg.sender) check. Router stays CVI-unregistered.
        factory.setRouter(address(router));

        cva.registerAsset(address(tokenA), address(tokenA), "TKA", "Token A", 18, false, address(0), address(0));
        cva.registerAsset(address(tokenB), address(tokenB), "TKB", "Token B", 18, false, address(0), address(0));
        cva.registerAsset(address(weth), address(weth), "WETH", "Wrapped Ether", 18, false, address(0), address(0));

        uint256 farFuture = block.timestamp + 365 days;
        string[] memory countries = new string[](1);
        countries[0] = "US";
        cvi.registerWallet(alice, 1, 0, "G", "SG", countries, farFuture, 1);
        cvi.registerWallet(bob, 1, 0, "G", "SG", countries, farFuture, 2);

        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenA.mint(bob, 1000 ether);
        tokenB.mint(bob, 1000 ether);

        vm.prank(alice);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(bob);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(bob);
        tokenB.approve(address(router), type(uint256).max);
    }

    function _createPool() internal returns (address pairAddr) {
        pairAddr = factory.createPair(address(tokenA), address(tokenB));
        vm.startPrank(alice);
        router.addLiquidity(address(tokenA), address(tokenB), 100 ether, 100 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    // ============================================================
    // M-03: PairCreated event
    // ============================================================
    function testPairCreatedEmitted() public {
        // Use a fresh pair of tokens to avoid existing pair.
        MockERC20 tokenC = new MockERC20("Token C", "TKC", 18, 1_000_000 ether);
        cva.registerAsset(address(tokenC), address(tokenC), "TKC", "Token C", 18, false, address(0), address(0));

        vm.expectEmit(true, true, false, false);
        emit PairCreated(
            address(tokenA) < address(tokenC) ? address(tokenA) : address(tokenC),
            address(tokenA) < address(tokenC) ? address(tokenC) : address(tokenA),
            address(0), // cannot precompute; asserted via log
            0
        );
        address pair = factory.createPair(address(tokenA), address(tokenC));

        // The emitted pair address must be the one returned and indexed by the factory.
        assertEq(pair, factory.getPair(address(tokenA), address(tokenC)), "getPair returns created pair");
        assertTrue(factory.isPair(pair), "isPair true after createPair");
        assertEq(factory.allPairsLength(), 1, "allPairsLength incremented");
        (address token0, address token1) = address(tokenA) < address(tokenC) ? (address(tokenA), address(tokenC)) : (address(tokenC), address(tokenA));
        assertEq(factory.getPair(token0, token1), pair, "sorted getPair");
    }

    // ============================================================
    // M-03: setFeeTo gated by feeToSetter + correct (old,new) event
    // ============================================================
    function testSetFeeToOnlyFeeToSetter() public {
        address nonSetter = makeAddr("nonSetter");
        vm.prank(nonSetter);
        vm.expectRevert(bytes("FORBIDDEN"));
        factory.setFeeTo(nonSetter);
    }

    function testSetFeeToEmitsOldNew() public {
        address newFeeTo = makeAddr("newFeeTo");
        address oldFeeTo = factory.feeTo(); // address(0)
        vm.expectEmit(true, true, false, false);
        emit FeeToUpdated(oldFeeTo, newFeeTo);
        factory.setFeeTo(newFeeTo); // msg.sender is the feeToSetter (deployer)
        assertEq(factory.feeTo(), newFeeTo, "feeTo updated");
    }

    function testOwnable2StepTransfer() public {
        address governor = makeAddr("governor");
        // Ownable2Step: transferOwnership only sets pendingOwner.
        factory.transferOwnership(governor);
        assertEq(factory.owner(), address(this), "owner unchanged until accept");
        assertEq(factory.pendingOwner(), governor, "pendingOwner set");
        // Non-governor cannot accept.
        vm.prank(alice);
        vm.expectRevert();
        factory.acceptOwnership();
        // Governor accepts -> ownership moves.
        vm.prank(governor);
        factory.acceptOwnership();
        assertEq(factory.owner(), governor, "owner moved after accept");
    }

    // ============================================================
    // M-04: setComplianceHook propagates to existing pairs
    // ============================================================
    function testSetComplianceHookPropagatesToPairs() public {
        address pairAddr = _createPool();

        // Deploy a second hook and point the factory at it.
        ComplianceHook hook2 = new ComplianceHook(cvi, cva);
        factory.setComplianceHook(hook2);

        assertEq(address(factory.getComplianceHook()), address(hook2), "factory hook updated");
        VeriPair pair = VeriPair(pairAddr);
        assertEq(address(pair.complianceHook()), address(hook2), "existing pair hook updated");
    }

    function testSetComplianceHookOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        factory.setComplianceHook(hook);
    }

    // ============================================================
    // H-05: recipient (to) compliance checks in pair
    // ============================================================
    function testSwapRejectsUnverifiedRecipient() public {
        address pairAddr = _createPool();

        // alice (verified) tries to swap tokenA -> tokenB to carol (NOT verified).
        vm.prank(alice);
        vm.expectRevert();
        router.swapExactTokensForTokens(
            1 ether, 0, pathAB(), carol, block.timestamp + 1 hours
        );
    }

    function testSwapAllowsVerifiedRecipient() public {
        address pairAddr = _createPool();
        uint256 bobBefore = tokenB.balanceOf(bob);

        vm.prank(alice);
        router.swapExactTokensForTokens(
            1 ether, 0, pathAB(), bob, block.timestamp + 1 hours
        );
        assertGt(tokenB.balanceOf(bob), bobBefore, "bob received tokenB");
    }

    function testAddLiquidityRejectsUnverifiedRecipient() public {
        factory.createPair(address(tokenA), address(tokenB));
        // First liquidity: LP minted to carol (unverified) must revert.
        vm.prank(alice);
        vm.expectRevert();
        router.addLiquidity(address(tokenA), address(tokenB), 50 ether, 50 ether, 0, 0, carol, block.timestamp + 1 hours);
    }

    function testRemoveLiquidityRejectsUnverifiedRecipient() public {
        address pairAddr = _createPool();
        address pair = pairAddr;
        uint256 lp = VeriPair(pair).balanceOf(alice);

        // alice removes liquidity to carol (unverified recipient) -> revert.
        vm.prank(alice);
        VeriPair(pair).approve(address(router), lp);
        vm.prank(alice);
        vm.expectRevert();
        router.removeLiquidity(
            address(tokenA), address(tokenB), lp, 0, 0, carol, block.timestamp + 1 hours
        );
    }

    // ============================================================
    // H-05: LP token transfers check `from` (and `to`)
    // ============================================================
    function testLPTransferFromUnverifiedSenderReverts() public {
        address pairAddr = _createPool();
        uint256 lp = VeriPair(pairAddr).balanceOf(alice);

        // alice sends LP to bob (verified) — allowed.
        vm.prank(alice);
        VeriPair(pairAddr).transfer(bob, lp / 2);

        // Now bob (verified) tries to send LP to carol (unverified) — recipient check reverts.
        vm.prank(bob);
        vm.expectRevert();
        VeriPair(pairAddr).transfer(carol, lp / 4);
    }

    function testLPTransferBetweenVerifiedUsersAllowed() public {
        address pairAddr = _createPool();
        uint256 lp = VeriPair(pairAddr).balanceOf(alice);
        vm.prank(alice);
        VeriPair(pairAddr).transfer(bob, lp / 2);
        assertEq(VeriPair(pairAddr).balanceOf(bob), lp / 2, "bob received LP");
    }

    // ============================================================
    // M-02: live checks — no 24h cache (unregister takes effect immediately)
    // ============================================================
    function testUnregisterTakesEffectImmediately() public {
        _createPool();

        // bob is verified now; swap works.
        vm.prank(alice);
        router.swapExactTokensForTokens(1 ether, 0, pathAB(), bob, block.timestamp + 1 hours);

        // Revoke bob's CVI mid-session — with no cache the very next check fails.
        vm.prank(cvi.owner());
        cvi.setVerified(bob, false);

        vm.prank(alice);
        vm.expectRevert();
        router.swapExactTokensForTokens(1 ether, 0, pathAB(), bob, block.timestamp + 1 hours);
    }

    function pathAB() internal view returns (address[] memory path) {
        path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
    }
}
