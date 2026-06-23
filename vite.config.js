import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ML_Image_Enhancement/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 10000
  }
});
