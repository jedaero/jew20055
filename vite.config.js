import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: '/',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        campus: resolve(root, 'campus.html'),
        community: resolve(root, 'community.html'),
        game: resolve(root, 'game/index.html'),
      },
    },
  },
})
