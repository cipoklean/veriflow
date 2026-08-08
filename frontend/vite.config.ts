import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Rolldown advanced code splitting: isolate the heavy wallet stack
        // (viem, wagmi, connectors) into named vendor chunks so no chunk
        // exceeds ~500 kB (the default chunkSizeWarningLimit). Order matters:
        // connectors match @wagmi too, so they get a higher priority group.
        codeSplitting: {
          maxSize: 480 * 1024,
          groups: [
            {
              name: 'vendor-connectors',
              test: /node_modules[\\/](@wagmi[\\/]connectors|@coinbase|@metamask|mipd|qrcode)/,
              priority: 30,
            },
            {
              name: 'vendor-wagmi',
              test: /node_modules[\\/](wagmi|@wagmi[\\/]core|@wagmi[\\/]react)/,
              priority: 20,
            },
            {
              name: 'vendor-viem',
              test: /node_modules[\\/]viem/,
              priority: 15,
            },
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router|@tanstack|scheduler)/,
              priority: 10,
            },
            {
              name: 'vendor-other',
              test: /node_modules/,
              priority: 5,
            },
          ],
        },
      },
    },
  },
})
