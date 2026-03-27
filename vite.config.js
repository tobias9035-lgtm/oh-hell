import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // WICHTIG: Die "base" Option muss mit einem Schrägstrich beginnen und enden
  base: '/oh-hell/',
})