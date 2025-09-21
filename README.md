# Chess

This repository contains a browser chess game built with vanilla JS and Vite.

## Publish to GitHub Pages (using `docs/`)

This project is configured to build static files into the `docs/` directory (GitHub Pages can serve the `docs` folder on the `main` branch).

Steps to publish:

1. Install dependencies:

```powershell
npm install
```

2. Build into `docs/`:

```powershell
npm run build
```

3. Commit and push the `docs/` directory to `main` (this repo already pushes commits to GitHub):

```powershell
git add docs -f
git commit -m "Add built site for GitHub Pages"
git push
```

4. On GitHub, go to `Settings` → `Pages` and set the source to `main` branch and `/docs` folder. Save and wait a minute — the site will be available under the URL shown.

Notes:
- If you'd prefer to host from `gh-pages` branch, consider using the `gh-pages` package or `gh` CLI.
- If your site uses absolute imports or needs a base path, update the Vite `base` option in `vite.config.js`.

