import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    fs: { allow: ['..'] },   // locales/ lives one level up
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/comag.js': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
