import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Permite que el entorno asigne el puerto (PORT); si no, usa el de Vite.
    port: Number(process.env.PORT) || 5173,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        // El editor 3D pesa: lo separamos para que el resto de la app cargue rapido.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/three|@react-three/.test(id)) return 'three';
            if (id.includes('@supabase')) return 'supabase';
            if (/react-dom|react-router|\/react\//.test(id)) return 'vendor';
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
