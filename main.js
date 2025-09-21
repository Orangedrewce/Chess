import { Chess } from 'chess.js';
import './assets/styles/main.css';
import logger from './src/utils/logger.js';
import { ChessAI } from './src/ai/ChessAI.js';

// ============================================================================
// GLOBAL STATE & UI ELEMENTS
// ============================================================================

const chess = new Chess();

/**
 * All mutable game state is consolidated into this single object.
 * This makes state management clearer, and resetting the game is simpler.
 */
const gameState = {
    fromSquare: null,
    premove: null,
    settings: {
        opponent: 'human',
        timeControl: '10+0',
        playerColor: 'w',
    },
    isBoardFlipped: false,
    isGameOver: false,
    // New: indicates if a game has been started (setupNewGame called) so we can block interaction prior to start
    isStarted: false,
    lastMove: null,
    timers: {
        white: null, // Interval ID
        black: null, // Interval ID
        whiteTime: 600,
        blackTime: 600,
        incrementSeconds: 0,
        whiteStartSeconds: Infinity,
        blackStartSeconds: Infinity,
    },
    ai: {
        isThinking: false,
        timeoutId: null, // legacy (random AI) – retained in case of fallback
        engine: null,    // instance of ChessAI
        config: { timeMs: 1500, maxDepth: 6, randomness: 0.02 }, // default tunables
    },
};

// ============================================================================
// AI PERSONALITIES
// ----------------------------------------------------------------------------
// Each personality defines:
//  - type: 'random' | 'engine'
//  - timeMs / depth: search constraints for engine (if type === 'engine')
//  - thinkTime: { min, max } artificial delay window to simulate "thinking"
//  - blunderChance: probability (0..1) to intentionally choose a sub‑optimal (random) move
//  - notes: descriptive string for logging/debug
// For now "blunder" = pick a random legal move different from the engine's best.
// (Could be improved later using MultiPV and picking from lower ranked PVs.)
// ----------------------------------------------------------------------------
const AI_PERSONALITIES = {
    monkey: {
        id: 'monkey',
        label: 'A Literal Monkey',
        type: 'random',
        thinkTime: { min: 250, max: 1600 },
        notes: 'Pure random legal move. No engine used.'
    },
    'geriatric-patient': {
        id: 'geriatric-patient',
        label: 'Geriatric Patient',
        type: 'engine',
        depth: 4,          // Low depth => weak play
        timeMs: 900,       // Small time constraint
        thinkTime: { min: 800, max: 2400 },
        blunderChance: 0.28,
        notes: 'Low ELO with frequent blunders.'
    },
    'nut-twister': {
        id: 'nut-twister',
        label: 'Nut Twister',
        type: 'engine',
        depth: 10,
        timeMs: 1500,
        thinkTime: { min: 900, max: 2300 },
        blunderChance: 0.06,
        notes: 'Approx ~1500 ELO feel (rough heuristic).'
    },
    wizard: {
        id: 'wizard',
        label: 'Wizard',
        type: 'engine',
        depth: 18,         // Push depth high – limited by timeMs cap
        timeMs: 3200,       // Generous move time
        thinkTime: { min: 700, max: 1700 },
        blunderChance: 0.0,
        notes: 'As strong as feasible within browser constraints.'
    }
};

function getPersonality(key) {
    return AI_PERSONALITIES[key] || AI_PERSONALITIES.wizard;
}

function randomInRange(min, max) {
    return min + Math.random() * (max - min);
}

// Central object for all HTML element references
const uiElements = {
    board: document.getElementById('chess-board'),
    statusText: document.getElementById('game-status'),
    promotionModal: document.getElementById('promotion-modal'),
    promotionOptions: document.querySelector('.promotion-options'),
    moveList: document.getElementById('move-list'),
    setupCard: document.getElementById('game-setup'),
    startGameButton: document.getElementById('start-game'),
    opponentSelect: document.getElementById('opponent-select'),
    timeControlSelect: document.getElementById('time-control'),
    playWhiteButton: document.getElementById('play-white'),
    playBlackButton: document.getElementById('play-black'),
    playerInfoCard: document.getElementById('player-info'),
    moveHistoryCard: document.getElementById('move-history'),
    gameControls: document.getElementById('game-controls'),
    newGameButton: document.getElementById('new-game'),
    flipBoardButton: document.getElementById('flip-board'),
    resignButton: document.getElementById('resign'),
    copyPgnButton: document.getElementById('copy-pgn'),
    whitePlayerCard: document.getElementById('white-player-card'),
    blackPlayerCard: document.getElementById('black-player-card'),
    blackPlayerName: document.getElementById('black-player-name'),
    whitePlayerName: document.getElementById('white-player-name'),
    whiteClock: document.getElementById('white-clock'),
    blackClock: document.getElementById('black-clock'),
};


// ============================================================================
// GAME INITIALIZATION & RESET
// ============================================================================

function setupNewGame() {
    try {
        logger.info('Initializing new game');
    const opponent = uiElements.opponentSelect.value;
    const timeControl = uiElements.timeControlSelect.value;
    const playerColor = uiElements.playWhiteButton.classList.contains('selected') ? 'w' : 'b';

    gameState.settings = { opponent, timeControl, playerColor };
    gameState.isBoardFlipped = (gameState.settings.playerColor === 'b');
    gameState.isStarted = true;


    uiElements.setupCard.style.display = 'none';
    uiElements.playerInfoCard.style.display = 'flex';
    uiElements.moveHistoryCard.style.display = 'flex';
    uiElements.gameControls.style.display = 'grid';
    uiElements.board.classList.remove('inactive');

    logger.debug('Settings', gameState.settings);

    setupClocks();
    updatePlayerInfo();
    renderBoard();
    updateStatus();

    // Apply default strength preset if opponent is AI and no explicit custom modifications made.
    if (gameState.settings.opponent !== 'human') {
        const oppKey = gameState.settings.opponent;
        const personality = getPersonality(oppKey);
        gameState.ai.personality = personality;
        // Maintain backward compatibility for existing logging/structures
        if (personality.type === 'engine') {
            gameState.ai.config = { timeMs: personality.timeMs, maxDepth: personality.depth, level: personality.id };
        } else {
            gameState.ai.config = { level: personality.id };
        }
        logger.info(`[AI] Personality set: ${personality.id}`, personality);

        if (personality.type === 'engine') {
            // Lazy init engine
            if (!gameState.ai.engine) {
                try {
                    // Let ChessAI determine correct path (GitHub Pages base aware)
                    gameState.ai.engine = new ChessAI();
                    logger.info('[AI] Stockfish engine worker initializing...');
                    gameState.ai.engine.readyPromise.then(() => {
                        logger.info('[AI] Stockfish engine is ready.');
                        if (chess.turn() !== gameState.settings.playerColor) {
                            makeAIMove();
                        }
                    });
                } catch (e) {
                    logger.error('[AI] Engine init failed – fallback random', e);
                    gameState.ai.personality = getPersonality('monkey');
                }
            } else if (chess.turn() !== gameState.settings.playerColor) {
                makeAIMove();
            }
        } else {
            // Random personality may need to move immediately if it's its turn
            if (chess.turn() !== gameState.settings.playerColor) {
                makeAIMove();
            }
        }
    }
    } catch (err) {
        logger.error('Failed to setup new game', err);
    }
}

function resetGame() {
    try {
        logger.info('Resetting game');

    // Reset game logic state
    chess.reset();
    cancelPendingAI();
    if (gameState.ai.engine) {
        try { gameState.ai.engine.terminate(); } catch(_) {}
        gameState.ai.engine = null;
    }
    gameState.isGameOver = false;
    gameState.fromSquare = null;
    gameState.lastMove = null;
    gameState.premove = null;
    gameState.isStarted = false;

    // Reset UI
    uiElements.moveList.innerHTML = '';
    clearHighlights();
    Arrows.clear();
    clearPremoveUI();
    
    // Stop and reset timers
    stopTimer('w');
    stopTimer('b');
    const [startTime] = (gameState.settings.timeControl || '10+0').split('+').map(Number);
    const startSeconds = (startTime > 0) ? startTime * 60 : 600;
    gameState.timers.whiteTime = startSeconds;
    gameState.timers.blackTime = startSeconds;
    updateClockDisplay();
    
    // Show setup screen
    uiElements.playerInfoCard.style.display = 'none';
    uiElements.moveHistoryCard.style.display = 'none';
    uiElements.gameControls.style.display = 'none';
    uiElements.setupCard.style.display = 'block';
    uiElements.statusText.textContent = 'Select Color, Opponent, Time';
    uiElements.statusText.className = 'status-text';
    uiElements.board.classList.add('inactive');
    } catch (err) {
        logger.error('Error during resetGame', err);
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// --- Game Setup ---
uiElements.startGameButton.addEventListener('click', () => {
    try {
        const opponentVal = uiElements.opponentSelect?.value;
        const timeVal = uiElements.timeControlSelect?.value;
        if (!opponentVal || opponentVal === 'Select') {
            logger.warn('Start blocked: opponent not selected');
            uiElements.statusText.textContent = 'Select an opponent';
            uiElements.statusText.className = 'status-text';
            uiElements.statusText.classList.add('warn');
            return;
        }
        if (!timeVal || timeVal === 'Select') {
            logger.warn('Start blocked: time control not selected');
            uiElements.statusText.textContent = 'Select a time control';
            uiElements.statusText.className = 'status-text';
            uiElements.statusText.classList.add('warn');
            return;
        }
        setupNewGame();
    } catch (e) { logger.error('startGame click handler', e); }
});
uiElements.newGameButton.addEventListener('click', () => {
    try { resetGame(); } catch (e) { logger.error('newGame click handler', e); }
});

// --- In-Game Board Interaction ---
uiElements.board.addEventListener('click', (event) => {
    const squareElement = event.target.closest('.square');
    if (squareElement) {
        try { handleSquareClick(squareElement.dataset.square); } catch (e) { logger.error('Error handling board click', e); }
    }
});

// --- Game Controls ---
uiElements.flipBoardButton.addEventListener('click', () => {
    gameState.isBoardFlipped = !gameState.isBoardFlipped;
    renderBoard();
    renderCoordinates();
    logger.info('Board flipped', { isBoardFlipped: gameState.isBoardFlipped });
});

uiElements.resignButton.addEventListener('click', () => {
    if (gameState.isGameOver) return;
    gameState.isGameOver = true;
    cancelPendingAI();
    const winner = gameState.settings.playerColor === 'w' ? 'Black' : 'White';
    uiElements.statusText.textContent = `You resigned. ${winner} wins.`;
    uiElements.statusText.classList.add('game-over');
    stopTimer('w');
    stopTimer('b');
        logger.warn('Player resigned');
});

if (uiElements.copyPgnButton) {
    uiElements.copyPgnButton.addEventListener('click', () => {
        navigator.clipboard.writeText(chess.pgn())
            .then(() => {
                const originalText = uiElements.copyPgnButton.textContent;
                uiElements.copyPgnButton.textContent = 'Copied!';
                setTimeout(() => { uiElements.copyPgnButton.textContent = originalText; }, 2000);
                logger.info('PGN copied to clipboard');
            })
            .catch(err => logger.error('PGN copy failed', err));
    });
}

// --- Setup Screen Toggles ---
if (uiElements.playWhiteButton && uiElements.playBlackButton) {
    const handleColorSelection = (selectedColor) => {
        const isWhite = selectedColor === 'w';
        uiElements.playWhiteButton.classList.toggle('selected', isWhite);
        uiElements.playBlackButton.classList.toggle('selected', !isWhite);
        updateOpponentName();
        // Auto-flip board to match selected color perspective
        if (gameState.isBoardFlipped === isWhite) {
            gameState.isBoardFlipped = !isWhite;
            renderBoard();
            renderCoordinates();
        }
    };
    uiElements.playWhiteButton.addEventListener('click', () => handleColorSelection('w'));
    uiElements.playBlackButton.addEventListener('click', () => handleColorSelection('b'));
}

// Combined validation for opponent and time control
function validateStartConditions() {
    const opponentValid = uiElements.opponentSelect && uiElements.opponentSelect.value !== 'Select';
    const timeValid = uiElements.timeControlSelect && uiElements.timeControlSelect.value !== 'Select';
    const enable = opponentValid && timeValid;
    uiElements.startGameButton.disabled = !enable;
    uiElements.startGameButton.classList.toggle('disabled', !enable);
    if (opponentValid) updateOpponentName();
}
if (uiElements.opponentSelect) uiElements.opponentSelect.addEventListener('change', validateStartConditions);
if (uiElements.timeControlSelect) uiElements.timeControlSelect.addEventListener('change', validateStartConditions);
validateStartConditions();

// ============================================================================
// GAME LOGIC & PLAYER INTERACTION
// ============================================================================

function handleSquareClick(square) {
    try {
        if (!gameState.isStarted || gameState.isGameOver) return; // Block interaction before game start
        Arrows.clear(); // Clear drawn arrows on any board interaction

        logger.trace('Square clicked', square, { turn: chess.turn(), isGameOver: gameState.isGameOver });

        if (gameState.settings.opponent === 'human') {
            // In a Human vs. Human game, any piece can be moved on its turn.
            // The logic in handlePlayerTurn already checks if the piece color matches the current turn.
            handlePlayerTurn(square);
        } else {
            // In a game vs. AI, we differentiate between the player's turn and the AI's turn.
            const isPlayerTurn = (chess.turn() === gameState.settings.playerColor);
            if (isPlayerTurn) {
                handlePlayerTurn(square);
            } else {
                // Allow the player to queue a premove while the AI is "thinking".
                handlePremove(square);
            }
        }
    } catch (err) {
        logger.error('Error in handleSquareClick', err, { square });
    }
}

/**
 * Handles clicks during the player's turn.
 */
function handlePlayerTurn(square) {
    try {
        const piece = chess.get(square);
        logger.trace('handlePlayerTurn start', { square, fromSquare: gameState.fromSquare, piece });
        if (gameState.fromSquare === null) {
            if (piece && piece.color === chess.turn()) {
                gameState.fromSquare = square;
                highlightMoves(gameState.fromSquare);
                logger.info('Piece selected', { square, piece });
            }
        } else {
            // If clicking the same square again: allow deselect
            if (square === gameState.fromSquare) {
                gameState.fromSquare = null;
                clearHighlights();
                logger.trace('Selection cleared (same square)');
                return;
            }
            // If clicking another piece of same color: switch selection (persist concept)
            if (piece && piece.color === chess.turn()) {
                gameState.fromSquare = square;
                highlightMoves(gameState.fromSquare);
                logger.trace('Selection switched', { fromSquare: gameState.fromSquare });
                return;
            }
            const pieceToMove = chess.get(gameState.fromSquare);
            const promotionRank = pieceToMove.color === 'w' ? '8' : '1';
            if (pieceToMove.type === 'p' && square.endsWith(promotionRank)) {
                handlePromotion(gameState.fromSquare, square);
                return;
            }
            const move = chess.move({ from: gameState.fromSquare, to: square });
            if (move) {
                logger.info('Move executed', move.san, move);
                processMove(move);
                // After a successful move, clear selection (piece moved)
                gameState.fromSquare = null;
                if (gameState.settings.opponent !== 'human' && !gameState.isGameOver) {
                    makeAIMove();
                }
            } else {
                logger.warn('Invalid move attempted', { from: gameState.fromSquare, to: square });
            }
            clearHighlights();
            renderBoard();
            updateStatus();
            // Explicit premove execution attempt after completing player move UI updates
            attemptPremoveExecution();
        }
    } catch (err) {
        logger.error('Error in handlePlayerTurn', err, { square });
    }
}

/**
 * REFACTORED: Handles clicks when it's the opponent's turn (queuing a premove).
 */
function handlePremove(square) {
    try {
        if (gameState.fromSquare && gameState.fromSquare !== square) {
            // Second click: setting the premove
            gameState.premove = { from: gameState.fromSquare, to: square };
            renderPremoveUI(gameState.premove);
            logger.info('PREMOVE set', gameState.premove);
            gameState.fromSquare = null;
            clearHighlights();
        } else {
            // First click: selecting the piece to premove
            const piece = chess.get(square);
            if (piece && piece.color === gameState.settings.playerColor) {
                gameState.fromSquare = square;
                clearHighlights();
                document.querySelector(`[data-square="${square}"]`)?.classList.add('selected');
                logger.trace('Premove selection', { square });
            } else {
                // Clicked empty square or opponent piece, clear selection/premove
                gameState.fromSquare = null;
                gameState.premove = null;
                clearHighlights();
                clearPremoveUI();
            }
        }
    } catch (err) {
        logger.error('Error in handlePremove', err, { square });
    }
}

function handlePromotion(from, to) {
    try {
        uiElements.promotionModal.style.display = 'flex';
        uiElements.promotionOptions.innerHTML = ''; // Clear previous options

        ['q', 'r', 'b', 'n'].forEach(piece => {
            const option = document.createElement('div');
            option.classList.add('promotion-piece');
            option.textContent = getPieceSymbol({ type: piece, color: chess.turn() });
            option.addEventListener('click', () => {
                try {
                    const move = chess.move({ from, to, promotion: piece });
                    if (move) {
                        processMove(move);
                        // If playing vs AI, immediately schedule AI reply after promotion
                        if (gameState.settings.opponent !== 'human' && !gameState.isGameOver) {
                            // Small timeout ensures UI (board render/status) finishes before AI search logging
                            setTimeout(() => {
                                try { makeAIMove(); } catch(e) { logger.error('[AI] Post-promotion move failed', e); }
                            }, 50);
                        }
                    }
                } catch (err) {
                    logger.error('Promotion move failed', err, { from, to, promotion: piece });
                }
                uiElements.promotionModal.style.display = 'none';
                gameState.fromSquare = null;
                clearHighlights();
                renderBoard();
                updateStatus();
                // Explicit premove execution attempt after promotion flow completes
                attemptPremoveExecution();
            });
            uiElements.promotionOptions.appendChild(option);
        });
    } catch (err) {
        logger.error('Error in handlePromotion', err, { from, to });
    }
}

function attemptPremoveExecution() {
    try {
        if (!gameState.premove || gameState.isGameOver || chess.turn() !== gameState.settings.playerColor) {
            return;
        }

        logger.info('Attempting premove execution', gameState.premove);

        // Auto-promote to queen for premoves
        const moveObject = { ...gameState.premove };
        const piece = chess.get(moveObject.from);
        if (piece && piece.type === 'p') {
            const promotionRank = piece.color === 'w' ? '8' : '1';
            if (moveObject.to.endsWith(promotionRank)) {
                moveObject.promotion = 'q';
            }
        }

        const moveResult = chess.move(moveObject);
        gameState.premove = null; // Clear premove regardless of success
        clearPremoveUI();

        if (moveResult) {
            logger.info('PREMOVE executed', moveResult);
            processMove(moveResult);
            renderBoard();
            updateStatus();

            // Immediately trigger AI response
            if (gameState.settings.opponent !== 'human' && !gameState.isGameOver) {
                setTimeout(makeAIMove, 100);
            }
        } else {
            logger.warn('PREMOVE no longer legal');
        }
    } catch (err) {
        logger.error('Error in attemptPremoveExecution', err);
    }
}

/**
 * A central function to process a successful move, whether it's from a player, AI, or premove.
 */
function processMove(move) {
    try {
        gameState.lastMove = move;

        logger.debug('Processing move', move);

        // Handle time increment
        if (gameState.timers.incrementSeconds > 0) {
            if (move.color === 'w') {
                gameState.timers.whiteTime += gameState.timers.incrementSeconds;
            } else {
                gameState.timers.blackTime += gameState.timers.incrementSeconds;
            }
        }

        addMoveToHistory(move);
        updatePlayerInfo();
    } catch (err) {
        logger.error('Error in processMove', err, move);
    }
}

// ============================================================================
// AI LOGIC
// ============================================================================

/**
 * IMPLEMENTED: A simple AI that makes a random legal move.
 */
async function makeAIMove() {
    try {
        if (gameState.isGameOver || gameState.ai.isThinking) return;
        if (gameState.settings.opponent === 'human') return;
        const isAITurn = chess.turn() !== gameState.settings.playerColor;
        if (!isAITurn) return; // guard

    gameState.ai.isThinking = true;
    updateStatus();
        const personality = gameState.ai.personality || getPersonality(gameState.settings.opponent);
        const level = personality.id;
        logger.info('[AI] Thinking start', { turn: chess.turn(), fen: chess.fen(), personality });

        const legalMoves = chess.moves({ verbose: true });
        if (!legalMoves.length) {
            logger.warn('[AI] No legal moves available');
            return;
        }

        // Determine artificial thinking delay
        const thinkDelay = personality.thinkTime ? Math.round(randomInRange(personality.thinkTime.min, personality.thinkTime.max)) : 0;
        const delayPromise = new Promise(res => setTimeout(res, thinkDelay));

        if (personality.type === 'random') {
            await delayPromise; // Just wait then pick a random move
            if (gameState.isGameOver) return; // Game may have ended during delay
            const mv = legalMoves[Math.floor(Math.random() * legalMoves.length)];
            const moveObj = chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
            if (moveObj) {
                logger.info('[AI][random] Move played', { san: moveObj.san, delayMs: thinkDelay });
                processMove(moveObj);
            }
            return;
        }

        // ENGINE PERSONALITY
        // Ensure engine exists
        if (!gameState.ai.engine) {
            try {
                // Create engine using internal dynamic resolution
                gameState.ai.engine = new ChessAI();
                await gameState.ai.engine.readyPromise;
            } catch (e) {
                logger.error('[AI] Engine missing & init failed; fallback random this turn', e);
                await delayPromise;
                if (gameState.isGameOver) return;
                const mv = legalMoves[Math.floor(Math.random() * legalMoves.length)];
                const moveObj = chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
                if (moveObj) { logger.warn('[AI] Fallback random move (engine init failure)', moveObj.san); processMove(moveObj); }
                return;
            }
        }

        const fen = chess.fen();
        const searchOpts = { maxDepth: personality.depth, time: personality.timeMs };
        const tStart = performance.now();
        let aiResult; let firstError = null;
        const searchPromise = (async () => {
            try {
                aiResult = await gameState.ai.engine.getMove(fen, searchOpts);
            } catch (engineErr) {
                firstError = engineErr;
                logger.warn('[AI] Primary search failed – retrying reduced depth', { err: engineErr.message });
                try {
                    aiResult = await gameState.ai.engine.getMove(fen, { maxDepth: Math.max(2, Math.floor((personality.depth || 4)/2)), time: Math.min((personality.timeMs||1000)*1.3, (personality.timeMs||1000)+500) });
                } catch (retryErr) {
                    logger.error('[AI] Retry failed – using random', { retryErr: retryErr.message, firstError: firstError?.message });
                    const mv = legalMoves[Math.floor(Math.random() * legalMoves.length)];
                    const uci = mv.from + mv.to + (mv.promotion || '');
                    aiResult = { move: uci };
                }
            }
        })();

        // Wait for both artificial delay and (at least) one completed search attempt
        await Promise.all([delayPromise, searchPromise]);
        if (!aiResult || !aiResult.move) {
            logger.warn('[AI] No move result after search');
            return;
        }
        if (gameState.isGameOver) return; // Game ended mid-think

        let chosenMoveUci = aiResult.move;

        // Blunder logic: with probability choose alternative random legal move (excluding best if possible)
        if (personality.blunderChance && Math.random() < personality.blunderChance) {
            const altMoves = legalMoves.filter(m => (m.from + m.to + (m.promotion || '')) !== chosenMoveUci);
            if (altMoves.length) {
                const pick = altMoves[Math.floor(Math.random() * altMoves.length)];
                chosenMoveUci = pick.from + pick.to + (pick.promotion || '');
                logger.info('[AI] Intentional blunder applied', { personality: personality.id, chosenMoveUci });
            }
        }

        const from = chosenMoveUci.slice(0,2);
        const to = chosenMoveUci.slice(2,4);
        const promotion = chosenMoveUci.length > 4 ? chosenMoveUci[4] : undefined;
        const moveObj = chess.move({ from, to, promotion });
        if (moveObj) {
            const dt = (performance.now() - tStart).toFixed(0);
            logger.info('[AI] Move played', { san: moveObj.san, uci: chosenMoveUci, timeMs: dt, thinkDelay });
            processMove(moveObj);
        } else {
            logger.warn('[AI] Move became illegal before execution', { uci: chosenMoveUci });
        }
    } catch (err) {
        logger.error('[AI] Fatal error in makeAIMove', err);
    } finally {
        gameState.ai.isThinking = false;
        gameState.ai.timeoutId = null; // legacy compatibility
        renderBoard();
        updateClockDisplay();
        updateStatus();
        attemptPremoveExecution();
    }
}

function cancelPendingAI() {
    if (gameState.ai.timeoutId) {
        clearTimeout(gameState.ai.timeoutId);
        gameState.ai.timeoutId = null;
    }
    // Attempt to stop current search gracefully (best-effort) – current worker code checks only time, so just flag.
    gameState.ai.isThinking = false;
}


// ============================================================================
// UI RENDERING & UPDATES
// ============================================================================

function renderBoard() {
    uiElements.board.innerHTML = '';
    // Apply inactive class if game not started
    uiElements.board.classList.toggle('inactive', !gameState.isStarted);
    const isCheck = chess.inCheck();
    const ranks = gameState.isBoardFlipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const files = gameState.isBoardFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    
    ranks.forEach(rankIndex => {
        files.forEach(fileIndex => {
            const squareDiv = document.createElement('div');
            const isLight = (rankIndex + fileIndex) % 2 !== 0;
            squareDiv.className = `square ${isLight ? 'light' : 'dark'}`;

            const file = 'abcdefgh'[fileIndex];
            const rank = rankIndex + 1;
            const squareName = `${file}${rank}`;
            squareDiv.dataset.square = squareName;
            
            // Drag and drop listeners
            squareDiv.addEventListener('dragover', handleDragOver);
            squareDiv.addEventListener('drop', handleDrop);
            squareDiv.addEventListener('dragenter', e => { e.preventDefault(); squareDiv.classList.add('drop-target'); });
            squareDiv.addEventListener('dragleave', () => squareDiv.classList.remove('drop-target'));

            // Highlight last move
            if (gameState.lastMove && (squareName === gameState.lastMove.from || squareName === gameState.lastMove.to)) {
                squareDiv.classList.add(squareName === gameState.lastMove.from ? 'last-move-from' : 'last-move-to');
            }

            const piece = chess.board()[7 - rankIndex][fileIndex];
            if (piece) {
                const pieceSpan = document.createElement('span');
                pieceSpan.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
                const sym = getPieceSymbol(piece);
                pieceSpan.textContent = sym;
                pieceSpan.dataset.symbol = sym; // store for recovery if DOM text lost
                
                if (gameState.isStarted && !gameState.isGameOver && piece.color === gameState.settings.playerColor) {
                    pieceSpan.draggable = true;
                    pieceSpan.addEventListener('dragstart', handleDragStart);
                }
                squareDiv.appendChild(pieceSpan);
                // Defensive: if glyph fails to render (e.g., font load race) schedule a microtask to re-set
                queueMicrotask(() => {
                    if (pieceSpan && !pieceSpan.textContent) {
                        pieceSpan.textContent = pieceSpan.dataset.symbol || sym;
                    }
                });

                if (isCheck && piece.type === 'k' && piece.color === chess.turn()) {
                    squareDiv.classList.add('in-check');
                }
            }
            uiElements.board.appendChild(squareDiv);
        });
    });
    renderCoordinates();

    // Re-apply selection & legal move dots if we still have a selected square whose piece belongs to player
    if (gameState.fromSquare) {
        const piece = chess.get(gameState.fromSquare);
        if (piece && piece.color === gameState.settings.playerColor && !gameState.isGameOver) {
            highlightMoves(gameState.fromSquare);
        } else {
            // Stale selection (piece captured or changed) – clear it
            gameState.fromSquare = null;
            clearHighlights();
        }
    }
}

function updateStatus() {
    let status = '';
    const turn = chess.turn() === 'w' ? 'White' : 'Black';

    if (chess.isCheckmate()) {
        status = `Checkmate! ${turn === 'White' ? 'Black' : 'White'} wins.`;
        gameState.isGameOver = true;
    } else if (chess.isDraw()) {
        status = 'Draw!';
        gameState.isGameOver = true;
    } else {
        const isAITurn = gameState.settings.opponent !== 'human' && chess.turn() !== gameState.settings.playerColor;
        if (isAITurn && gameState.ai.isThinking) {
            status = 'Thinking…';
        } else {
            status = `${turn} to move`;
            if (chess.inCheck()) status += ' - Check!';
        }
    }
    
    if (gameState.isGameOver) {
        stopTimer('w');
        stopTimer('b');
        cancelPendingAI();
    }
    
    uiElements.statusText.textContent = status;
    uiElements.statusText.className = 'status-text'; // Reset classes
    if (gameState.isGameOver) uiElements.statusText.classList.add('game-over');
    if (status.includes('Check')) uiElements.statusText.classList.add('check');
    if (status.startsWith('Thinking')) uiElements.statusText.classList.add('thinking');

    logger.info('Status', status);
}

function updatePlayerInfo() {
    const turn = chess.turn();
    uiElements.whitePlayerCard.classList.toggle('active', turn === 'w');
    uiElements.blackPlayerCard.classList.toggle('active', turn === 'b');
    
    if (gameState.settings.timeControl !== "0+0" && !gameState.isGameOver) {
        if (turn === 'w') {
            startTimer('w');
            stopTimer('b');
        } else {
            startTimer('b');
            stopTimer('w');
        }
    }
}

function addMoveToHistory(move) {
    // Defer coordinate highlight until after any subsequent renderBoard() call
    // (renderBoard is invoked synchronously AFTER processMove in calling contexts).
    setTimeout(() => lightUpCoordinates(move), 0);

    if (move.color === 'w') {
        const moveElement = document.createElement('div');
        moveElement.className = 'move-pair';
        moveElement.innerHTML = `
            <div class="move-number">${chess.moveNumber()}.</div>
            <div class="move-notation white">${move.san}</div>
            <div class="move-notation black"></div>
        `;
        uiElements.moveList.appendChild(moveElement);
    } else {
        const lastMovePair = uiElements.moveList.lastElementChild;
        if (lastMovePair) {
            const blackDiv = lastMovePair.querySelector('.move-notation.black');
            if (blackDiv) blackDiv.textContent = move.san;
        }
    }
    uiElements.moveList.scrollTop = uiElements.moveList.scrollHeight;
}


// ============================================================================
// DRAG AND DROP LOGIC
// ============================================================================
let draggedPiece = null;
let sourceSquare = null;

function handleDragStart(event) {
    const sq = event.target.closest('.square');
    if (!sq) return;
    if (!gameState.isStarted || gameState.isGameOver) return; // Prevent drag before game starts or after over
    sourceSquare = sq.dataset.square;
    draggedPiece = event.target;
    
    try {
        event.dataTransfer.setData('text/plain', sourceSquare);
        event.dataTransfer.effectAllowed = 'move';
    } catch (e) {}
    
    // Reordered for clarity
    const pieceToDrag = draggedPiece;

    const onDragEnd = () => {
        const srcEl = document.querySelector(`[data-square="${sourceSquare}"]`);
        if (srcEl) srcEl.classList.remove('drag-source');
        if (pieceToDrag) {
            pieceToDrag.style.display = 'block';
            pieceToDrag.removeEventListener('dragend', onDragEnd);
        }
        draggedPiece = null;
        sourceSquare = null;
    };

    if (pieceToDrag) {
        pieceToDrag.addEventListener('dragend', onDragEnd);
        setTimeout(() => {
            pieceToDrag.style.display = 'none';
            sq.classList.add('drag-source');
        }, 0);
    }
}

function handleDragOver(event) {
    event.preventDefault();
}

function handleDrop(event) {
    event.preventDefault();
    if (!gameState.isStarted || gameState.isGameOver) return;
    
    const targetSquareElement = event.target.closest('.square');
    if (!targetSquareElement) {
        renderBoard(); // Restore piece if dropped outside
        return;
    }
    const toSquare = targetSquareElement.dataset.square;
    
    // Simulate clicks to reuse existing logic
    if (sourceSquare) {
        try { handleSquareClick(sourceSquare); } catch (e) { logger.error('Error during drag drop (source click)', e); }
        try { handleSquareClick(toSquare); } catch (e) { logger.error('Error during drag drop (target click)', e); }
    }
    document.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
}


// ============================================================================
// CLOCK & TIMER LOGIC
// ============================================================================

function setupClocks() {
    const [startTime, increment] = gameState.settings.timeControl.split('+').map(Number);
    if (startTime > 0) {
        gameState.timers.whiteStartSeconds = startTime * 60;
        gameState.timers.blackStartSeconds = startTime * 60;
        gameState.timers.whiteTime = gameState.timers.whiteStartSeconds;
        gameState.timers.blackTime = gameState.timers.blackStartSeconds;
        gameState.timers.incrementSeconds = increment || 0;
    } else {
        // Unlimited time
        gameState.timers.whiteTime = Infinity;
        gameState.timers.blackTime = Infinity;
        uiElements.whiteClock.textContent = '∞';
        uiElements.blackClock.textContent = '∞';
        return;
    }
    updateClockDisplay();
}

function startTimer(color) {
    if (color === 'w' && !gameState.timers.white) {
        gameState.timers.white = setInterval(() => {
            gameState.timers.whiteTime--;
            updateClockDisplay();
            if (gameState.timers.whiteTime <= 0) {
                gameState.isGameOver = true;
                uiElements.statusText.textContent = "Time's up! Black wins.";
                uiElements.statusText.classList.add('game-over');
                stopTimer('w'); stopTimer('b');
            }
        }, 1000);
    } else if (color === 'b' && !gameState.timers.black) {
        gameState.timers.black = setInterval(() => {
            gameState.timers.blackTime--;
            updateClockDisplay();
            if (gameState.timers.blackTime <= 0) {
                gameState.isGameOver = true;
                uiElements.statusText.textContent = "Time's up! White wins.";
                uiElements.statusText.classList.add('game-over');
                stopTimer('w'); stopTimer('b');
            }
        }, 1000);
    }
}

function stopTimer(color) {
    if (color === 'w' && gameState.timers.white) {
        clearInterval(gameState.timers.white);
        gameState.timers.white = null;
    } else if (color === 'b' && gameState.timers.black) {
        clearInterval(gameState.timers.black);
        gameState.timers.black = null;
    }
}

function formatTime(seconds) {
    if (!isFinite(seconds)) return '∞';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateClockDisplay() {
    uiElements.whiteClock.textContent = formatTime(gameState.timers.whiteTime);
    uiElements.blackClock.textContent = formatTime(gameState.timers.blackTime);

    uiElements.whiteClock.classList.toggle('warning', gameState.timers.whiteTime <= 60 && gameState.timers.whiteTime > 10);
    uiElements.whiteClock.classList.toggle('danger', gameState.timers.whiteTime <= 10);
    uiElements.blackClock.classList.toggle('warning', gameState.timers.blackTime <= 60 && gameState.timers.blackTime > 10);
    uiElements.blackClock.classList.toggle('danger', gameState.timers.blackTime <= 10);
}


// ============================================================================
// UI HELPER FUNCTIONS
// ============================================================================

function clearHighlights() {
    document.querySelectorAll('.selected, .possible-move, .capture').forEach(el => {
        el.classList.remove('selected', 'possible-move', 'capture');
    });
}

function highlightMoves(square) {
    clearHighlights();
    if (!square) return;

    // chess.moves() correctly returns ONLY legal moves.
    // For a pinned piece, this will be an empty array.
    const moves = chess.moves({ square, verbose: true });
    
    document.querySelector(`[data-square="${square}"]`)?.classList.add('selected');

    moves.forEach(move => {
        const el = document.querySelector(`[data-square="${move.to}"]`);
        if (el) {
            // This class creates the blue dot.
            el.classList.add('possible-move');
            // This class can be styled differently for captures.
            if (move.flags.includes('c')) el.classList.add('capture');
        }
    });
}

function getPieceSymbol(piece) {
    if (!piece || !piece.type) return '?';
    const symbols = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' };
    return symbols[piece.type.toLowerCase()] || '?';
}

function renderPremoveUI(premove) {
    clearPremoveUI();
    if (!premove || premove.from === premove.to) return;
    const wrapper = uiElements.board.closest('.board-wrapper');
    const fromEl = uiElements.board.querySelector(`[data-square="${premove.from}"]`);
    const toEl = uiElements.board.querySelector(`[data-square="${premove.to}"]`);
    if (!wrapper || !fromEl || !toEl) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add('premove-svg');
    const wrapperRect = wrapper.getBoundingClientRect();
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width / 2 - wrapperRect.left;
    const y1 = fromRect.top + fromRect.height / 2 - wrapperRect.top;
    const x2 = toRect.left + toRect.width / 2 - wrapperRect.left;
    const y2 = toRect.top + toRect.height / 2 - wrapperRect.top;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute('class', 'premove-line');
    svg.appendChild(line);
    wrapper.appendChild(svg);
}

function clearPremoveUI() {
    document.querySelectorAll('.premove-svg').forEach(el => el.remove());
}

function renderCoordinates() {
    const files = ['a','b','c','d','e','f','g','h'];
    const rankContainer = document.querySelector('.rank-labels');
    const fileContainer = document.querySelector('.file-labels');

    if (rankContainer) {
        rankContainer.innerHTML = '';
        const ranks = gameState.isBoardFlipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
        ranks.forEach(r => {
            const el = document.createElement('div');
            el.className = 'coordinates'; el.textContent = r;
            rankContainer.appendChild(el);
        });
    }
    if (fileContainer) {
        fileContainer.innerHTML = '';
        const orderedFiles = gameState.isBoardFlipped ? files.slice().reverse() : files;
        orderedFiles.forEach(f => {
            const el = document.createElement('div');
            el.className = 'coordinates'; el.textContent = f;
            fileContainer.appendChild(el);
        });
    }
}

function lightUpCoordinates(move) {
    if (!move || !move.to || typeof move.to !== 'string') return;
    const square = move.to.trim();
    if (square.length < 2) return;
    const toFile = square.charAt(0);
    const toRank = square.charAt(1);

    const els = document.querySelectorAll('.file-labels .coordinates, .rank-labels .coordinates');
    let matched = 0;
    els.forEach(el => {
        const txt = (el.textContent || '').trim();
        if (txt === toFile || txt === toRank) {
            el.classList.add('highlight');
            matched++;
            setTimeout(() => el.classList.remove('highlight'), 1500);
        }
    });
    try { logger.debug('[COORD-HILITE]', { move: move.san || move.to, square, toFile, toRank, matched }); } catch(_) {}
}

function updateOpponentName() {
    const opponentName = uiElements.opponentSelect.options[uiElements.opponentSelect.selectedIndex].text;
    const playerIsWhite = uiElements.playWhiteButton.classList.contains('selected');
    if (playerIsWhite) {
        uiElements.blackPlayerName.textContent = opponentName;
        uiElements.whitePlayerName.textContent = 'Player';
    } else {
        uiElements.whitePlayerName.textContent = opponentName;
        uiElements.blackPlayerName.textContent = 'Player';
    }
}

// ============================================================================
// ARROW DRAWING LOGIC (Self-contained module)
// ============================================================================
const Arrows = {
    _initialized: false, boardEl: null, svg: null, curArrow: null, startSq: null,
    drawing: false, colorIdx: 0, palette: ['#00ffff', '#ff0080', '#80ff00', '#ff4000'],

    init() {
        if (this._initialized) return;
        this.boardEl = document.getElementById('chess-board');
        this.wrapperEl = this.boardEl?.closest('.board-wrapper');
        if (!this.boardEl || !this.wrapperEl) return;

        if (getComputedStyle(this.wrapperEl).position === 'static') {
            this.wrapperEl.style.position = 'relative';
        }
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svg.classList.add('arrow-svg');
        this.svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "defs"));
        this.wrapperEl.appendChild(this.svg);
        this.boardEl.addEventListener('contextmenu', e => e.preventDefault());
        this.boardEl.addEventListener('mousedown', this.down.bind(this));
        window.addEventListener('mousemove', this.move.bind(this));
        window.addEventListener('mouseup', this.up.bind(this));
        this._initialized = true;
    },
    down(e) {
        if (e.button !== 2) return;
        e.preventDefault();
        this.drawing = true;
        this.startSq = this.eventSquare(e);
        if (!this.startSq) return;
        this.colorIdx = (e.shiftKey) ? (this.colorIdx + this.palette.length - 1) % this.palette.length : this.colorIdx;
        const { x, y } = this.coords(this.startSq);
        this.curArrow = this.createArrow(x, y);
    },
    move(e) {
        if (!this.drawing || !this.curArrow) return;
        const endSq = this.eventSquare(e);
        const { x, y } = endSq ? this.coords(endSq) : this.pointerXY(e);
        this.curArrow.setAttribute('x2', x); this.curArrow.setAttribute('y2', y);
    },
    up(e) {
        if (!this.drawing) return;
        const endSqName = this.eventSquare(e);
        if (this.startSq === endSqName) {
            this.svg.removeChild(this.curArrow);
            const { x, y } = this.coords(this.startSq);
            this.createCircle(x, y);
        } else if (this.curArrow && endSqName) {
            const [startFile, startRank] = [this.startSq.charCodeAt(0), parseInt(this.startSq[1])];
            const [endFile, endRank] = [endSqName.charCodeAt(0), parseInt(endSqName[1])];
            const [dx, dy] = [Math.abs(startFile - endFile), Math.abs(startRank - endRank)];
            if ((dx === 1 && dy === 2) || (dx === 2 && dy === 1)) {
                this.svg.removeChild(this.curArrow);
                this.createKnightArrow(this.startSq, endSqName);
            }
        }
        this.drawing = false; this.curArrow = null;
    },
    clear() {
        if (!this.svg) return;
        const children = Array.from(this.svg.children);
        children.forEach(c => { if (c.tagName.toLowerCase() !== 'defs') this.svg.removeChild(c); });
        this.drawing = false;
    },
    // ADDED: Method to cycle through arrow colors
    cycleColor() {
        this.colorIdx = (this.colorIdx + 1) % this.palette.length;
        logger.info('[ARROWS] Color changed');
    },
    ensureMarker(color, markerId) {
        if (this.svg.querySelector(`#${markerId}`)) return;
        const defs = this.svg.querySelector('defs');
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.id = markerId;
        marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '5');
        marker.setAttribute('markerHeight', '5'); marker.setAttribute('orient', 'auto-start-reverse');
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute('points', '0 0, 10 5, 0 10'); polygon.setAttribute('fill', color);
        marker.appendChild(polygon); defs.appendChild(marker);
    },
    createArrow(x, y) {
        const color = this.palette[this.colorIdx];
        const markerId = `arrowhead-${this.colorIdx}`;
        this.ensureMarker(color, markerId);
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "line");
        arrow.setAttribute('class', 'arrow-line'); arrow.setAttribute('stroke', color);
        arrow.setAttribute('marker-end', `url(#${markerId})`);
        arrow.setAttribute('x1', x); arrow.setAttribute('y1', y);
        arrow.setAttribute('x2', x); arrow.setAttribute('y2', y);
        this.svg.appendChild(arrow); return arrow;
    },
    createKnightArrow(from, to) {
        const color = this.palette[this.colorIdx];
        const markerId = `arrowhead-${this.colorIdx}`;
        this.ensureMarker(color, markerId);
        const fromCoords = this.coords(from); const toCoords = this.coords(to);
        const dxFile = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
        const midCoords = (dxFile === 2) ? { x: toCoords.x, y: fromCoords.y } : { x: fromCoords.x, y: toCoords.y };
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute('d', `M ${fromCoords.x} ${fromCoords.y} L ${midCoords.x} ${midCoords.y} L ${toCoords.x} ${toCoords.y}`);
        path.setAttribute('class', 'arrow-knight-path'); path.setAttribute('stroke', color);
        path.setAttribute('marker-end', `url(#${markerId})`); this.svg.appendChild(path);
    },
    createCircle(x, y) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const squareSize = this.boardEl.querySelector('.square').offsetWidth;
        circle.setAttribute('class', 'square-highlight'); circle.setAttribute('cx', x); circle.setAttribute('cy', y);
        circle.setAttribute('r', squareSize * 0.4); circle.setAttribute('stroke', this.palette[this.colorIdx]);
        this.svg.appendChild(circle);
    },
    eventSquare(e) { const el = e.target.closest('.square'); return el ? el.dataset.square : null; },
    coords(squareName) {
        const el = this.boardEl.querySelector(`[data-square="${squareName}"]`);
        if (!el) return { x: 0, y: 0 };
        const wrapperRect = this.wrapperEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        return { x: elRect.left - wrapperRect.left + elRect.width / 2, y: elRect.top - wrapperRect.top + elRect.height / 2 };
    },
    pointerXY(e) {
        const wrapperRect = this.wrapperEl.getBoundingClientRect();
        return { x: e.clientX - wrapperRect.left, y: e.clientY - wrapperRect.top };
    }
};


// ============================================================================
// APP INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    logger.info('Game loaded. Waiting for user to start.');
    try { updateOpponentName(); } catch (e) { logger.error('updateOpponentName failed on DOMContentLoaded', e); }
    try { Arrows.init(); } catch (e) { logger.error('Arrows.init failed on DOMContentLoaded', e); }
    try { uiElements.board.classList.add('inactive'); } catch(_) {}

    // Keybinds for arrows
    window.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
        if (e.key === 'c' || e.key === 'C') Arrows.clear();
        else if (e.key === 'x' || e.key === 'X') Arrows.cycleColor();
    });

    // --- Board Resizing Logic ---
    const handle = document.querySelector('.board-resize-handle');
    const root = document.documentElement;
    const getCurrentSquareSize = () => parseInt(getComputedStyle(root).getPropertyValue('--square-size')); // may yield computed px
    let resizing = false;
    let startX = 0, startY = 0, startSize = 0;
    const MIN_SIZE = 40; // px per square
    const MAX_SIZE = 110; // px per square
    const persistKey = 'chess.squareSize';
    // Load persisted size
    try {
        const saved = localStorage.getItem(persistKey);
        if (saved) {
            root.style.setProperty('--square-size', saved + 'px');
            // Re-render board if already built
            try { renderBoard(); } catch(_){}
        }
    } catch(_) {}

    function applySize(newSize) {
        const clamped = Math.min(MAX_SIZE, Math.max(MIN_SIZE, newSize));
        root.style.setProperty('--square-size', clamped + 'px');
        try { renderBoard(); } catch(_) {}
        try { localStorage.setItem(persistKey, clamped); } catch(_) {}
    }

    if (handle) {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            resizing = true;
            startX = e.clientX; startY = e.clientY;
            startSize = getCurrentSquareSize();
            document.body.classList.add('resizing-board');
        });
        window.addEventListener('mousemove', (e) => {
            if (!resizing) return;
            const dx = e.clientX - startX; // horizontal drag influences size
            const dy = e.clientY - startY; // allow combined direction; average for smoother feel
            const delta = (dx + (-dy)) / 4; // up or right increases
            applySize(startSize + delta);
        });
        window.addEventListener('mouseup', () => { if (resizing) { resizing = false; document.body.classList.remove('resizing-board'); }});
    }

    // Integrity check: ensure board grid did not collapse (should have width ~ 8 * square-size)
    setTimeout(() => {
        const boardEl = document.getElementById('chess-board');
        if (boardEl) {
            const style = getComputedStyle(boardEl);
            const cols = style.getPropertyValue('grid-template-columns').split(' ').length;
            if (cols < 8) {
                logger.warn('Board grid appears collapsed; resetting size to 60px');
                document.documentElement.style.setProperty('--square-size', '60px');
                try { renderBoard(); } catch(_) {}
            }
        }
    }, 50);
});

// -------------------------------------------------------------
// PIECE GLYPH INTEGRITY WATCHDOG (handles rare font/glyph drops)
// -------------------------------------------------------------
function restoreMissingPieceGlyphs() {
    const pieces = document.querySelectorAll('.piece');
    let repaired = 0;
    pieces.forEach(p => {
        if ((!p.textContent || p.textContent.trim() === '') && p.dataset.symbol) {
            p.textContent = p.dataset.symbol;
            repaired++;
        }
    });
    if (repaired) {
        try { logger.warn(`[INTEGRITY] Restored ${repaired} missing piece glyph${repaired===1?'':'s'}.`); } catch(_) {}
    }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) restoreMissingPieceGlyphs(); });
setInterval(restoreMissingPieceGlyphs, 7000);