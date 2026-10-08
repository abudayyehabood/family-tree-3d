import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves the app from /family-tree-3d/, and the preview-limbs branch from /family-tree-3d/preview/.
  base: command === 'build' ? (process.env.BASE_PATH ?? '/family-tree-3d/') : '/',
  plugins: [react(), tailwindcss()],
}))
