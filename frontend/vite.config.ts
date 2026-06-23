import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// snarkjs + @stellar/stellar-sdk + circomlibjs expect Node globals (Buffer/process)
// in the browser; the polyfill plugin shims them.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, process: true }, protocolImports: true }),
  ],
  optimizeDeps: { exclude: ['snarkjs'] },
  server: { port: 5173 },
})
