// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVeriFactory} from "../interfaces/IVeriAMM.sol";
import {VeriPair} from "./VeriPair.sol";
import {IComplianceHook} from "../interfaces/IComplianceHook.sol";
import {ICVARegistry} from "../interfaces/ICVARegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title VeriFactory
 * @notice Factory for deploying VeriPair pools with compliance hook integration
 * @dev Creates VeriPair contracts with the compliance hook pre-configured.
 * Only verified Cleanverse assets (CVA) can be paired.
 */
contract VeriFactory is IVeriFactory, Ownable2Step {
    address public complianceHook;
    address public _feeTo;
    address public _feeToSetter;

    address[] private _allPairs;
    mapping(address => mapping(address => address)) private _getPair;
    mapping(address => bool) public isPair;

    event FeeToUpdated(address indexed oldFeeTo, address indexed newFeeTo);
    event FeeToSetterUpdated(address indexed oldFeeToSetter, address indexed newFeeToSetter);
    event ComplianceHookUpdated(IComplianceHook indexed newHook);

    modifier onlyFeeToSetter() {
        require(msg.sender == _feeToSetter, "FORBIDDEN");
        _;
    }

    constructor(IComplianceHook _complianceHook) Ownable(msg.sender) {
        complianceHook = address(_complianceHook);
        _feeToSetter = msg.sender;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, "IDENTICAL_TOKENS");

        // Verify both tokens are Cleanverse verified assets (CVA)
        // This check is done at factory level to prevent non-verified pools
        ICVARegistry cvaRegistry = IComplianceHook(complianceHook).cvaRegistry();
        require(cvaRegistry.isVerifiedAsset(tokenA), "TOKEN_A_NOT_VERIFIED");
        require(cvaRegistry.isVerifiedAsset(tokenB), "TOKEN_B_NOT_VERIFIED");

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(_getPair[token0][token1] == address(0), "PAIR_EXISTS");

        VeriPair newPair = new VeriPair(token0, token1, address(this), IComplianceHook(complianceHook));
        _getPair[token0][token1] = address(newPair);
        _getPair[token1][token0] = address(newPair);
        _allPairs.push(address(newPair));
        isPair[address(newPair)] = true;

        emit PairCreated(token0, token1, address(newPair), _allPairs.length);
        return address(newPair);
    }

    function getPair(address tokenA, address tokenB) external view override returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return _getPair[token0][token1];
    }

    function allPairs(uint256 index) external view override returns (address) {
        return _allPairs[index];
    }

    function allPairsLength() external view override returns (uint256) {
        return _allPairs.length;
    }

    function setFeeTo(address _newFeeTo) external override onlyFeeToSetter {
        emit FeeToUpdated(_feeTo, _newFeeTo);
        _feeTo = _newFeeTo;
    }

    function setFeeToSetter(address _newFeeToSetter) external override onlyOwner {
        emit FeeToSetterUpdated(_feeToSetter, _newFeeToSetter);
        _feeToSetter = _newFeeToSetter;
    }

    function feeTo() external view override returns (address) {
        return _feeTo;
    }

    function feeToSetter() external view override returns (address) {
        return _feeToSetter;
    }

    /**
     * @notice Update the compliance hook (governance only) and propagate to all pairs
     * @param _complianceHook New compliance hook address
     */
    function setComplianceHook(IComplianceHook _complianceHook) external onlyOwner {
        complianceHook = address(_complianceHook);

        // Propagate to every existing pair so the new hook takes effect immediately.
        uint256 length = _allPairs.length;
        for (uint256 i = 0; i < length; i++) {
            VeriPair(_allPairs[i]).setComplianceHook(_complianceHook);
        }
        emit ComplianceHookUpdated(_complianceHook);
    }

    /**
     * @notice Get the compliance hook address
     * @return IComplianceHook address
     */
    function getComplianceHook() external view returns (IComplianceHook) {
        return IComplianceHook(complianceHook);
    }
}
