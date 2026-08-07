import type { Address } from 'viem';

// Contract addresses - Deployed on Monad Testnet (Chain ID: 10143) 2026-08-07
// Governor (owner of Factory/Router/Hook): 0x51b0228bd9B8BF78CEDB11Cb485BA9F80cCf4655
export const CONTRACT_ADDRESSES = {
  monadTestnet: {
    veriFactory: '0x059F2780132a1d5bb54E1cAab7675C8338124d71' as Address,
    veriRouter: '0x75F74f18B126fc3f95AFe19BB367A9a6b3a5C7fC' as Address,
    complianceHook: '0x7d59e809DB91270Dfd788956FA1E4d6E915F0E28' as Address,
    cviRegistry: '0xD47a9c1F0F9f1dD79110c0e83eF0ac40DFBF25CF' as Address,
    cvaRegistry: '0xC4A78F258fe5E97DD97C548BEAe237f202C4A37c' as Address,
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