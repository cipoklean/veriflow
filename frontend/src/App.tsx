import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { BrowserRouter } from 'react-router-dom';
import { monadTestnet } from './chains';
import { VeriFlowApp } from './components/VeriFlowApp/VeriFlowApp';
import { Toaster } from './components/ui/Toaster';
import { ToastProvider } from './hooks/useToast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo';

// Use wagmi v3 MIPD auto-discovery for injected wallets (MetaMask, Coinbase,
// Brave, Rabby, etc.) instead of hand-listing SDK connectors. Hand-listing both
// `metaMask()` (MetaMask SDK) and `injected({ target: 'metaMask' })` creates two
// connectors claiming the same identity and causes connect() to fail; Coinbase's
// `smartWalletOnly` also throws on setups where the smart wallet is unavailable.
// MIPD discovers whatever EIP-1193 provider is actually installed, which is the
// reliable path. WalletConnect covers mobile wallets.
const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    walletConnect({ projectId }),
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
            <VeriFlowApp />
            <Toaster />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;