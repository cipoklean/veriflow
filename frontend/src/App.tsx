import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { BrowserRouter } from 'react-router-dom';
import { monadTestnet } from './chains';
import { VeriFlowApp } from './components/VeriFlowApp/VeriFlowApp';
import { WalletModalProvider } from './components/VeriFlowApp/WalletModalProvider';
import { Toaster } from './components/ui/Toaster';
import { ToastProvider } from './hooks/useToast';
import { TxDockProvider } from './components/ui/TxDock';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

// FE-06: real WalletConnect projectId lives in .env.local as
// VITE_WALLETCONNECT_PROJECT_ID (create one at https://cloud.walletconnect.com).
// Until one is configured we SKIP the WalletConnect connector entirely — the
// old 'demo' fallback made the connect modal list a connector that errors out.
// Injected wallets (MetaMask, Rabby, Brave…) are still discovered via MIPD.
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

// Use wagmi v3 MIPD auto-discovery for injected wallets (MetaMask, Coinbase,
// Brave, Rabby, etc.) instead of hand-listing SDK connectors. Hand-listing both
// `metaMask()` (MetaMask SDK) and `injected({ target: 'metaMask' })` creates two
// connectors claiming the same identity and causes connect() to fail; Coinbase's
// `smartWalletOnly` also throws on setups where the smart wallet is unavailable.
// MIPD discovers whatever EIP-1193 provider is actually installed, which is the
// reliable path. WalletConnect covers mobile wallets (only when projectId set).
const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  multiInjectedProviderDiscovery: true,
  transports: {
    [monadTestnet.id]: http(),
  },
});

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <TxDockProvider>
              <WalletModalProvider>
                <VeriFlowApp />
                <Toaster />
              </WalletModalProvider>
            </TxDockProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;