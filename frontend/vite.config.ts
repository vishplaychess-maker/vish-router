import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Tailwind v4 runs as a Vite plugin and is configured in CSS (src/index.css),
  // so there is no tailwind.config.js in this project.
  plugins: [react(), tailwindcss()],
  server: {
    // Pinned: the backend's CORS allow-list names 5173 explicitly, so silently
    // falling back to 5174 would break every request with an opaque CORS error.
    port: 5173,
    strictPort: true,
  },
})
