import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        water: resolve(__dirname, 'index.html'),
        paint: resolve(__dirname, 'paint.html'),
        wind: resolve(__dirname, 'wind.html'),
        fire: resolve(__dirname, 'fire.html'),
        bubble: resolve(__dirname, 'bubble.html'),
        honey: resolve(__dirname, 'honey.html'),
        sand: resolve(__dirname, 'sand.html'),
      },
    },
  },
});
