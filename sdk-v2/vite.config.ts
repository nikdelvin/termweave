import process from 'node:process'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  clearScreen: false,
  // Re-minifying xterm 6 corrupts the local enum in InputHandler.requestMode
  // and causes WebKit production builds to throw during terminal negotiation.
  build: {
    minify: false,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/app/**',
        '**/termweave/components/**',
        '**/termweave/index.ts',
        '**/termweave/sidecar.tsx',
      ],
    },
  },
})
