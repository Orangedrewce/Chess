
# Chess (Browser Chess with Stockfish)

A feature-rich browser chess application using `chess.js` for rules and a Web Worker powered Stockfish engine for AI opponents. Built with Vite and deployed via GitHub Pages (`docs/` output).

## Features
- Multiple AI "personalities" (random to strong engine with adaptive time usage)
- Premove support (queue moves while AI is thinking)
- Drag & drop piece movement + click movement
- Timers with increment (supports bullet, blitz, rapid, untimed)
- Adaptive engine time management & emergency fast-play logic
- SVG arrows & square highlights (right-click to draw, knight path support)
- Coordinate highlighting of destination file/rank
- Responsive board sizing & manual resize handle (desktop)
- Fallback glyph restoration watchdog

## Tech Stack
- Vite (build tooling)
- `chess.js` (move legality & game state)
- Stockfish Web Worker (UCI engine)
- Vanilla JS + minimal CSS

## Getting Started
```bash
npm install
npm run dev
```
Open the printed local URL. During development the base path is `/`, in production it's `/Chess/` (configured in `vite.config.js`).

## Build
```bash
npm run build
```
Output goes to `docs/` (for GitHub Pages). Preview production build locally:
```bash
npm run preview
```

## Deploy (Manual)
1. Build: `npm run build`
2. Commit docs: `git add docs && git commit -m "build: update docs"`
3. Push: `git push`
4. Ensure GitHub Pages is set to serve from `main` branch `/docs`.

Or use the convenience script:
```bash
npm run deploy
```
(Will create a commit if there are changes in `docs/`.)
