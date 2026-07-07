import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative base เพื่อให้ asset โหลดถูกต้องเมื่อ deploy ขึ้น GitHub Pages ที่ /<repo-name>/
  base: './',
  server: {
    port: 5173,
    open: true,
  },
})
