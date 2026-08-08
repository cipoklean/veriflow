import { useCallback } from 'react';
import { useWriteContract, type UseWriteContractReturnType } from 'wagmi';
import { usePublicClient } from 'wagmi';
import { withGasCap } from '@/lib/utils';

/**
 * FE-21: a drop-in replacement for wagmi's useWriteContract that injects a sane
 * gas-price cap into every write. Monad testnet's base fee swings 100-460+ Gwei;
 * MetaMask multiplies gasLimit * maxFeePerGas for the "max" it shows, so during a
 * spike it quotes 0.2+ MON even though a swap only needs ~520k gas. We cap
 * maxFeePerGas at the live base fee * 1.25 with a 0 priority fee (tips are
 * meaningless on Monad testnet), so the wallet shows a realistic max. If the
 * chain has no EIP-1559 base fee (base 0), the request is passed through
 * untouched and the wallet uses its default.
 *
 * Also exposes the raw `writeContract` (uncapped) as `rawWriteContract` for any
 * call that must NOT be capped.
 */
export function useGasCappedWrite(): UseWriteContractReturnType & {
  cappedWriteContract: UseWriteContractReturnType['writeContract'];
} {
  const { writeContract, ...rest } = useWriteContract();
  const publicClient = usePublicClient();

  const cappedWriteContract = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request: Parameters<UseWriteContractReturnType['writeContract']>[0]) => {
      if (!publicClient) return writeContract(request as any);
      withGasCap(publicClient as any, request as Record<string, unknown>)
        .then((capped) => writeContract(capped as any))
        .catch(() => writeContract(request as any));
    },
    [publicClient, writeContract],
  ) as UseWriteContractReturnType['writeContract'];

  return { writeContract, ...rest, cappedWriteContract };
}
