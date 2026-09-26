import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves the app from /family-tree-3d/.
  base: command === 'build' ? '/family-tree-3d/' : '/',
  plugins: [react(), tailwindcss()],
}))
