import type { Address } from 'viem';

// Contract addresses - Deployed on Monad Testnet (Chain ID: 10143)
// Governor (owner of Factory/Router/Hook): 0x51b0228bd9B8BF78CEDB11Cb485BA9F80cCf4655
// NOTE: 2026-08-08 06:11 UTC redeploy with NEW-01/02/03/13 fixes (atomic
// exitLiquidity + router-only burn) + NEW-14 feeToSetter=governor default;
// addresses read from broadcast/DeployVeriFlow.s.sol/10143/run-latest.json
// (single source). Pair (WMON/USDC): 0x2fD1F8B9184d4ed41CF5f1A7639847ADDe9314b7.
export const CONTRACT_ADDRESSES = {
  monadTestnet: {
    veriFactory: '0x39950C3D2998662D882D47265C7AC587EC4f65B4' as Address,
    veriRouter: '0xa39d25Db54d57f7A8193Ad6baEC12042E0988053' as Address,
    complianceHook: '0xd3A2b6D1ace97721daB341CeF5B3ac0dB6DBe755' as Address,
    cviRegistry: '0x5aa3C294b291d29aBF203c780C3C22dC43B21173' as Address,
    cvaRegistry: '0x08f78faFD91A52C1dC8cDeC89252BA0c0C13Ac2B' as Address,
    weth: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as Address, // WMON (wrapped MON) - canonical Monad testnet (verified live 2026-08)
    usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address, // Circle USDC on Monad testnet
  },
  // Local development
  localhost: {
    veriFactory: '0x0000000000000000000000000000000000000000' as Address,
    veriRouter: '0x0000000000000000000000000000000000000000' as Address,
    complianceHook: '0x0000000000000000000000000000000000000000' as Address,
    cviRegistry: '0x0000000000000000000000000000000000000000' as Address,
    cvaRegistry: '0x0000000000000000000000000000000000000000' as Address,
    weth: '0x0000000000000000000000000000000000000000' as Address,
    usdc: '0x0000000000000000000000000000000000000000' as Address,
  },
} as const;

export function getContractAddresses(chainId: number) {
  switch (chainId) {
    case 10143:
      return CONTRACT_ADDRESSES.monadTestnet;
    case 31337:
      return CONTRACT_ADDRESSES.localhost;
    default:
      return CONTRACT_ADDRESSES.monadTestnet;
  }
}

// Protocol constants
export const PROTOCOL_FEE_BPS = 30; // 0.3%
export const MIN_LIQUIDITY = 1000; // Minimum LP tokens to mint

// Supported tokens for the UI (will be expanded after deployment)
export const SUPPORTED_TOKENS = {
  monadTestnet: [
    { symbol: 'MON', name: 'Monad', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18, isNative: true },
    { symbol: 'WMON', name: 'Wrapped Monad', address: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as Address, decimals: 18, isNative: false },
    { symbol: 'USDC', name: 'USD Coin', address: '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address, decimals: 6, isNative: false },
  ],
  localhost: [
    { symbol: 'MON', name: 'Monad', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18, isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18, isNative: false },
    { symbol: 'USDC', name: 'USD Coin', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 6, isNative: false },
    { symbol: 'TKA', name: 'Test Token A', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18, isNative: false },
    { symbol: 'TKB', name: 'Test Token B', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18, isNative: false },
  ],
};

export function getSupportedTokens(chainId: number) {
  switch (chainId) {
    case 10143:
      return SUPPORTED_TOKENS.monadTestnet;
    case 31337:
      return SUPPORTED_TOKENS.localhost;
    default:
      return SUPPORTED_TOKENS.monadTestnet;
  }
}