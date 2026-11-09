import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    host: true, // reachable from phones on the same Wi-Fi via your LAN IP
    proxy: { '/api': 'http://localhost:3001' },
  },
})
