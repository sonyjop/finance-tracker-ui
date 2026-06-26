import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // 1. Import the v4 engine

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
