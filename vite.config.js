import { defineConfig } from 'vite';
import path from 'path';

// Build to `docs/` so GitHub Pages can serve from the repository root -> /docs
export default defineConfig({
  root: '.',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
});
