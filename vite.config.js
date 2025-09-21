import { defineConfig } from 'vite';
import path from 'path';

// GitHub Pages settings:
// If your repository is Orangedrewce/Chess then pages will be served at https://orangedrewce.github.io/Chess/
// Set base to '/Chess/' so asset links resolve correctly when deployed.
// Build to `docs/` so GitHub Pages can serve from the repository root -> /docs
export default defineConfig({
  root: '.',
  base: '/Chess/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
});
