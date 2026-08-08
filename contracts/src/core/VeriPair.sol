// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20, IVeriPair, IVeriFactory} from "../interfaces/IVeriAMM.sol";
import {IComplianceHook} from "../interfaces/IComplianceHook.sol";
import {ICVARegistry} from "../interfaces/ICVARegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20 as OZIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VeriPair
 * @notice Uniswap V2 style AMM pair with Cleanverse compliance integration
 * @dev Implements x*y=k constant product formula with compliance checks on all operations.
 * Only verified Cleanverse assets (CVA) can be traded, and only verified users (CVI) can interact.
 */
contract VeriPair is IVeriPair, ERC20, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for OZIERC20;

    // Token addresses
    address public immutable token0;
    address public immutable token1;

    // Factory and compliance hook
    address public immutable factory;
    IComplianceHook public complianceHook;

    // Reserves and price tracking
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    // Price accumulators for TWAP
    uint256 private _price0CumulativeLast;
    uint256 private _price1CumulativeLast;

    // For permit (EIP-2612)
    bytes32 private _domainSeparator;
    bytes32 public constant PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
    mapping(address => uint256) private _nonces;

    // Minimum liquidity to prevent pool draining
    uint256 public constant MINIMUM_LIQUIDITY = 10**3;

    // kLast for detecting manipulation
    uint256 private _kLast;

    // Events
    event ComplianceCheckFailed(address indexed caller, string reason, uint8 checkType);
    event ComplianceHookUpdated(IComplianceHook indexed newHook);

    // Errors
    error InsufficientLiquidity();
    error InsufficientReserves();
    error InvalidToken();
    error ComplianceRejected(string reason, uint8 checkType);
    error PairNotInitialized();
    error DeadlineExpired();
    error InsufficientOutputAmount();
    error InsufficientInputAmount();
    error UnsafeRatio();

    constructor(
        address _token0,
        address _token1,
        address _factory,
        IComplianceHook _complianceHook
    ) ERC20("VeriFlow LP", "VFLP") Ownable(msg.sender) {
        require(_token0 != _token1, "IDENTICAL_TOKENS");
        require(_token0 < _token1, "TOKEN_ORDER");

        token0 = _token0;
        token1 = _token1;
        factory = _factory;
        complianceHook = _complianceHook;

        // Initialize permit domain separator
        _domainSeparator = _buildDomainSeparator();
    }

    // ============================================================
    // Initialization
    // ============================================================

    function initialize(address _token0, address _token1) external override {
        require(msg.sender == factory, "FORBIDDEN");
        // Already initialized in constructor
    }

    /**
     * @notice Update the compliance hook (factory only — used when the factory's
     * setComplianceHook propagates a new hook to all existing pairs).
     */
    function setComplianceHook(IComplianceHook _complianceHook) external override {
        require(msg.sender == factory, "FORBIDDEN");
        complianceHook = _complianceHook;
        emit ComplianceHookUpdated(_complianceHook);
    }

    // ============================================================
    // ERC20 Permit (EIP-2612) - Additional functions on top of ERC20
    // ============================================================

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparator;
    }

    // PERMIT_TYPEHASH is a public constant, no getter needed

    function nonces(address owner) external view override returns (uint256) {
        return _nonces[owner];
    }

    function name() public view override(ERC20, IVeriPair) returns (string memory) {
        return ERC20.name();
    }

    function symbol() public view override(ERC20, IVeriPair) returns (string memory) {
        return ERC20.symbol();
    }

    function decimals() public view override(ERC20, IVeriPair) returns (uint8) {
        return ERC20.decimals();
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        require(deadline >= block.timestamp, "EXPIRED");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _nonces[owner]++, deadline))
            )
        );
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == owner, "INVALID_SIGNATURE");
        _approve(owner, spender, value);
    }

    // ============================================================
    // Core AMM Functions
    // ============================================================

    function getReserves() external view override returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function price0CumulativeLast() external view override returns (uint256) {
        return _price0CumulativeLast;
    }

    function price1CumulativeLast() external view override returns (uint256) {
        return _price1CumulativeLast;
    }

    function kLast() external view override returns (uint256) {
        return _kLast;
    }

    // ============================================================
    // Mint (Add Liquidity)
    // ============================================================

    function mint(address to) external override nonReentrant returns (uint256 liquidity) {
        // NEW-01: enforce CVI(msg.sender) UNLESS msg.sender == router (a direct
        // caller — e.g. an unverified user — is always checked); enforce
        // CVI(to) unless isPair(to).
        address routerAddr = IVeriFactory(factory).router();
        if (msg.sender != routerAddr) {
            _checkComplianceAddLiquidity(msg.sender);
        }
        if (!IVeriFactory(factory).isPair(to)) {
            _checkComplianceAddLiquidity(to);
        }
        (uint112 _reserve0, uint112 _reserve1, ) = this.getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            uint256 product = amount0 * amount1;
            liquidity = Math.sqrt(product) - MINIMUM_LIQUIDITY;
            // NEW-02: PERMANENT lock at the dead address. The old
            // mint-to-self-then-burn was a NET NO-OP (supply +1000 then -1000,
            // ending at the same totalSupply) and re-enabled the first-depositor
            // one-sided donation drain. OZ v5 forbids `_mint` to address(0), so
            // use the canonical 0xdEaD burn address — those 1000 shares stay in
            // totalSupply forever and can never be withdrawn.
            _mint(0x000000000000000000000000000000000000dEaD, MINIMUM_LIQUIDITY);
        } else {
            liquidity = (amount0 * _totalSupply) / _reserve0;
            uint256 liquidityB = (amount1 * _totalSupply) / _reserve1;
            if (liquidityB < liquidity) liquidity = liquidityB;
        }

        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) _kLast = uint256(reserve0) * reserve1;

        emit Mint(msg.sender, amount0, amount1);
    }

    // ============================================================
    // Burn (Remove Liquidity)
    // ============================================================

    /**
     * @notice Router-only burn entry: burns the LP the router just parked in
     * this same transaction (removeLiquidity / removeLiquidityETH).
     * @dev NEW-13: direct burns by arbitrary users REVERT ("FORBIDDEN").
     * The old two-step exit (tx1: park LP in the pair, tx2: burn) is
     * deprecated — it let any caller burn the pair's ENTIRE parked LP and
     * steal a revoked user's parked shares. Users exit in ONE transaction via
     * exitLiquidity() (see below); the router path stays atomic because the
     * router parks LP and burns it inside a single tx.
     */
    function burn(address to) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(msg.sender == IVeriFactory(factory).router(), "FORBIDDEN");

        // H-05: check the ACTUAL user (token recipient `to`), not msg.sender
        // (router). Self-delivery (removeLiquidityETH burns to the router,
        // which already checked the user at router level) is skipped.
        if (to != msg.sender) {
            _checkComplianceRemoveLiquidity(to);
        }
        (amount0, amount1) = _burnLiquidity(balanceOf(address(this)), to);
    }

    /**
     * @notice Atomic one-transaction exit for LP holders — including revoked
     * users. Pulls the caller's OWN LP into the pair, burns exactly
     * `liquidity`, and redeems the underlying assets to `to` — all in one call,
     * so there is no parked balance for anyone to front-run.
     * @dev NEW-13: the pair NEVER reads the parked balance; the amount burned
     * is exactly the `liquidity` pulled from msg.sender's balance. Compliance:
     * the caller (from) is allowed even if revoked (exit right), but a
     * recipient other than the caller must be CVI-verified.
     */
    function exitLiquidity(
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(to != address(0), "INVALID_TO");

        // Exit right: a revoked user may redeem their own LP. The recipient
        // check mirrors burn(): to != msg.sender requires CVI(to).
        if (to != msg.sender) {
            _checkComplianceRemoveLiquidity(to);
        }

        // Pull the caller's own LP into the pair (to == address(this) is the
        // exit sink — exempt from the peer-transfer CVI gate in _update).
        _transfer(msg.sender, address(this), liquidity);

        (amount0, amount1) = _burnLiquidity(liquidity, to);

        require(amount0 >= amount0Min, "INSUFFICIENT_A_AMOUNT");
        require(amount1 >= amount1Min, "INSUFFICIENT_B_AMOUNT");
    }

    /**
     * @dev Internal burn: burns exactly `liquidity` (which must already sit in
     * the pair's balance — either parked by the router in this tx, or pulled
     * by exitLiquidity moments ago). Never reads the parked balance, so a
     * caller can only redeem the LP it actually deposited.
     */
    function _burnLiquidity(uint256 liquidity, address to) internal returns (uint256 amount0, uint256 amount1) {
        (uint112 _reserve0, uint112 _reserve1, ) = this.getReserves();
        address _token0 = token0;
        address _token1 = token1;
        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint256 _totalSupply = totalSupply();
        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;
        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_LIQUIDITY_BURNED");

        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);

        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);
        if (feeOn) _kLast = uint256(reserve0) * reserve1;

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ============================================================
    // Swap
    // ============================================================

    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external override nonReentrant {
        // NEW-01: an unverified user must NOT bypass compliance by calling the
        // pair directly with to == msg.sender. The old `to != msg.sender` skip
        // let anyone call pair.swap(to=self) and dodge every check.
        // New rule:
        //   - CVI(msg.sender) UNLESS msg.sender == router  (closes the bypass:
        //     a direct caller is always checked; the router is trusted)
        //   - CVI(to) UNLESS isPair(to) (multi-hop intermediate hops) or
        //     self-delivery (to == msg.sender — the router's ETH-unwrap path,
        //     where the caller was just verified above, or is the router).
        address routerAddr = IVeriFactory(factory).router();
        if (msg.sender != routerAddr) {
            _checkComplianceSwap(msg.sender);
        }
        if (to != msg.sender && !IVeriFactory(factory).isPair(to)) {
            _checkComplianceSwap(to);
        }

        require(amount0Out > 0 || amount1Out > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 _reserve0, uint112 _reserve1, ) = this.getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "INSUFFICIENT_RESERVES");

        address _token0 = token0;
        address _token1 = token1;

        if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out);
        if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out);

        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));

        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "INSUFFICIENT_INPUT_AMOUNT");

        // x*y=k check with 0.3% fee (997/1000)
        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;
        require(balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * _reserve1 * 1000 * 1000, "K");

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // ============================================================
    // Skim & Sync
    // ============================================================

    function skim(address to) external override {
        address _token0 = token0;
        address _token1 = token1;
        _safeTransfer(_token0, to, IERC20(_token0).balanceOf(address(this)) - reserve0);
        _safeTransfer(_token1, to, IERC20(_token1).balanceOf(address(this)) - reserve1);
    }

    function sync() external override {
        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this)),
            reserve0,
            reserve1
        );
        emit Sync(reserve0, reserve1);
    }

    // ============================================================
    // Compliance Checks
    // ============================================================

    function _checkComplianceSwap(address sender) internal {
        IComplianceHook.ComplianceResult memory result = complianceHook.checkSwap(
            sender,
            token0,
            token1,
            0, // amountIn not known at this level
            0  // amountOutMin not known
        );

        if (!result.allowed) {
            emit ComplianceCheckFailed(sender, result.reason, result.checkType);
            revert ComplianceRejected(result.reason, result.checkType);
        }
    }

    function _checkComplianceAddLiquidity(address sender) internal {
        IComplianceHook.ComplianceResult memory result = complianceHook.checkAddLiquidity(
            sender,
            token0,
            token1,
            0,
            0
        );

        if (!result.allowed) {
            emit ComplianceCheckFailed(sender, result.reason, result.checkType);
            revert ComplianceRejected(result.reason, result.checkType);
        }
    }

    function _checkComplianceRemoveLiquidity(address sender) internal {
        IComplianceHook.ComplianceResult memory result = complianceHook.checkRemoveLiquidity(
            sender,
            token0,
            token1,
            0
        );

        if (!result.allowed) {
            emit ComplianceCheckFailed(sender, result.reason, result.checkType);
            revert ComplianceRejected(result.reason, result.checkType);
        }
    }

    /**
     * @dev H-05: LP token transfers must involve verified wallets. The actual
     * user is `from` (the LP sender); the recipient `to` is also verified so a
     * verified user cannot hand LP to an unverified address.
     */
    function _checkComplianceTransfer(address from, address to) internal view {
        if (!complianceHook.checkCVI(from, address(this))) {
            revert ComplianceRejected("CVI verification failed: LP sender not verified", 0);
        }
        if (to != address(this) && !complianceHook.checkCVI(to, address(this))) {
            revert ComplianceRejected("CVI verification failed: LP recipient not verified", 0);
        }
    }

    /**
     * @dev Override ERC20._update to enforce CVI on real LP transfers.
     * Mint (from=0) and burn (to=0) are internal flows handled by mint()/burn().
     *
     * NEW-03: a transfer whose destination is the PAIR ITSELF (to ==
     * address(this)) is the documented redemption path for revoked users —
     * depositing LP into the pair is how a revoked wallet gets its shares to
     * burn(to = itself). It is exempt from the peer-transfer CVI checks so the
     * exit path cannot be blocked; the burn() recipient check still gates where
     * the underlying assets go. Transfers to any other address require both
     * parties CVI-verified.
     */
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && to != address(this)) {
            _checkComplianceTransfer(from, to);
        }
        super._update(from, to, value);
    }

    // ============================================================
    // Internal Helpers
    // ============================================================

    function _update(
        uint256 balance0,
        uint256 balance1,
        uint112 _reserve0,
        uint112 _reserve1
    ) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "OVERFLOW");
        uint32 blockTimestamp = uint32(block.timestamp);
        uint32 timeElapsed = blockTimestamp - blockTimestampLast;

        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            _price0CumulativeLast += uint256(_reserve1) * timeElapsed / _reserve0;
            _price1CumulativeLast += uint256(_reserve0) * timeElapsed / _reserve1;
        }

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;
    }

    function _mintFee(uint112 _reserve0, uint112 _reserve1) internal returns (bool feeOn) {
        IVeriFactory factoryInstance = IVeriFactory(factory);
        address feeTo = factoryInstance.feeTo();
        feeOn = feeTo != address(0);
        uint256 kLastLocal = _kLast;

        if (feeOn) {
            if (kLastLocal != 0) {
                uint256 rootK = Math.sqrt(uint256(_reserve0) * _reserve1);
                uint256 rootKLast = Math.sqrt(kLastLocal);
                if (rootK > rootKLast) {
                    uint256 numerator = totalSupply() * (rootK - rootKLast);
                    uint256 denominator = rootK * 5 + rootKLast;
                    uint256 liquidity = numerator / denominator;
                    if (liquidity > 0) _mint(feeTo, liquidity);
                }
            }
        } else if (kLastLocal != 0) {
            _kLast = 0;
        }
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        OZIERC20(token).safeTransfer(to, value);
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }
}