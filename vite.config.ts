import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true },
  /* Root by default; set VITE_BASE=/repo-name/ for a GitHub Pages subpath.
     Routing itself is hash-based, so no host-side rewrite rules are needed —
     only the asset prefix changes. */
  base: process.env.VITE_BASE ?? '/',
})
