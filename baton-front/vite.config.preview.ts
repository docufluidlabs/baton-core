/**
 * Vite Config — Preview (single-file HTML build)
 *
 * Builds the entire frontend into one self-contained HTML file
 * with Clerk replaced by mocks and API calls returning sample data.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: {
    // Override VITE_DEV_AUTH so the production guard in api.ts doesn't fire
    'import.meta.env.VITE_DEV_AUTH': JSON.stringify(''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Replace Clerk with mock implementation
      '@clerk/clerk-react': path.resolve(__dirname, './src/preview/clerk-mock.tsx'),
    },
  },
  build: {
    outDir: 'dist-preview',
    rollupOptions: {
      input: path.resolve(__dirname, 'preview.html'),
    },
  },
});
