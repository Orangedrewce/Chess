
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

## GitHub Pages Configuration
`vite.config.js` uses `base: '/Chess/'`. If you rename the repo, update that base to match new `/<RepoName>/` or set it to `/` if using a custom domain.

## Project Structure
```
├─ index.html              # App entry
├─ main.js                 # Main UI + game logic
├─ src/ai/ChessAI.js       # Stockfish wrapper & time mgmt
├─ src/utils/logger.js     # Central logger
├─ assets/styles/          # CSS
├─ public/stockfish/       # Engine binaries (copied to build)
├─ docs/                   # Production build output
```

## AI Personalities
Defined in `main.js` (`AI_PERSONALITIES`). Personalities vary depth, time slice, blunder chance, and thinking delay. The engine falls back to random if initialization fails.

## Future Ideas
- PGN download & analysis panel
- Opening explorer / book moves
- Engine multi-PV display
- Unit tests for time management heuristics
- Dark mode / themes

## Contributing
Fork or clone locally. Please format code consistently; consider adding ESLint/Prettier in a future enhancement.

## License
ISC (Feel free to adapt.)

---
Generated as part of repository recovery & cleanup after resolving merge conflicts.

