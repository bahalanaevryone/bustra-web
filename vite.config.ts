import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/leaflet/.test(id)) return 'maps'
          if (/@supabase/.test(id)) return 'supabase'
          if (/[/\\]zod[/\\]/.test(id)) return 'validation'
          if (/[/\\](react|react-dom|react-router|react-router-dom|scheduler)[/\\]/.test(id))
            return 'react-vendor'
        },
      },
    },
  },
})
