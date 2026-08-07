// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "../interfaces/IVeriAMM.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @notice Mock ERC20 token for testing
 */
contract MockERC20 is IERC20Metadata, Ownable {
    string public name_;
    string public symbol_;
    uint8 public decimals_;
    uint256 public totalSupply_;
    mapping(address => uint256) public balanceOf_;
    mapping(address => mapping(address => uint256)) public allowance_;

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 initialSupply
    ) Ownable(msg.sender) {
        name_ = name;
        symbol_ = symbol;
        decimals_ = decimals_;
        totalSupply_ = initialSupply;
        balanceOf_[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function name() external view override returns (string memory) {
        return name_;
    }

    function symbol() external view override returns (string memory) {
        return symbol_;
    }

    function decimals() external view override returns (uint8) {
        return decimals_;
    }

    function totalSupply() external view override returns (uint256) {
        return totalSupply_;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return balanceOf_[account];
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return allowance_[owner][spender];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance_[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(allowance_[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");
        allowance_[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf_[from] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf_[from] -= amount;
        balanceOf_[to] += amount;
        emit Transfer(from, to, amount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        totalSupply_ += amount;
        balanceOf_[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        require(balanceOf_[from] >= amount, "INSUFFICIENT_BALANCE");
        totalSupply_ -= amount;
        balanceOf_[from] -= amount;
        emit Transfer(from, address(0), amount);
        emit Burn(from, amount);
    }
}