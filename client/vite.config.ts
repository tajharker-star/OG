import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for Electron
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        unitPreview: resolve(__dirname, 'unit-preview.html'),
        buildingPreview: resolve(__dirname, 'building-preview.html')
      }
    }
  }
})
