// src/ai/ChessAI.js
import logger from '../utils/logger.js';

/**
 * A wrapper class for the Stockfish chess engine running in a Web Worker.
 * This class handles UCI communication and provides a simple getMove() method.
 */
export class ChessAI {
    constructor(enginePath, timeout = 5000) {
        // Preferred modern pattern: let bundler (Vite) resolve worker URL relative to this module.
        // If a custom enginePath is provided, use it; otherwise build a URL relative to BASE_URL/public.
        let workerUrl;
        if (enginePath) {
            workerUrl = enginePath;
        } else {
            // Use public folder asset path. In Vite, anything under public/ is served at root (respecting base at deploy)
            // We rely on base being set to '/Chess/' in production so '/Chess/stockfish/stockfish.js' is correct.
            let base = '/';
            try { if (import.meta?.env?.BASE_URL) base = import.meta.env.BASE_URL; } catch (_) {}
            if (!base.endsWith('/')) base += '/';
            workerUrl = base + 'stockfish/stockfish.js';
        }

        try {
            // Attempt module worker first (some builds of stockfish are classic scripts; if fails, fallback below)
            this.engine = new Worker(workerUrl, { type: 'classic' });
        } catch (e) {
            logger.warn('[AI] Primary worker creation failed, retrying classic mode only', e);
            this.engine = new Worker(workerUrl);
        }
        this.moveResolver = null; // A function to resolve the promise in getMove

        // Promise-based readiness with a timeout
        this.readyPromise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Engine initialization timed out after ${timeout / 1000} seconds.`));
            }, timeout);

            this._resolveReady = () => {
                clearTimeout(timeoutId);
                resolve();
            };
        });

        this.engine.onmessage = this._handleEngineMessage.bind(this);
        this.engine.onerror = (err) => {
            logger.error('[AI] Worker error', err);
            if (this.moveResolver) {
                this.moveResolver({ move: null, error: 'Worker error' });
            }
        };

        // ------------------------------
        // Dynamic Time Management State
        // ------------------------------
        this.timeManager = {
            totalTime: 0,          // Total base time at start (ms)
            timeLeft: 0,           // Updated externally per move call if desired
            increment: 0,          // Increment per move (ms)
            movesExpected: 40,     // Rough expected game length for budgeting
            moveCount: 0,          // Number of moves made (ply / 2 simplified externally)
            emergencyThreshold: 5000 // Below this, enter bullet/emergency mode (ms)
        };

        this._sendCommand('uci');
        this._sendCommand('isready');
    }

    /**
     * Handles messages received from the Stockfish worker.
     * @param {MessageEvent} event The message event from the worker.
     */
    _handleEngineMessage(event) {
        const message = event.data;
        logger.trace('[AI] <', message);

        if (message === 'uciok') {
            // Engine is acknowledging our 'uci' command. Now we can set options.
            this._sendCommand('setoption name Use NNUE value true'); // Use neural network evaluation
            this._sendCommand('setoption name Threads value 4'); // Adjust based on typical client hardware
        } else if (message === 'readyok') {
            // Engine is ready to receive commands.
            logger.info('[AI] Engine is ready.');
            if (this._resolveReady) {
                this._resolveReady();
                this._resolveReady = null; // Prevent multiple resolutions
            }
        } else if (message.startsWith('bestmove')) {
            // The engine has found a move.
            const parts = message.split(' ');
            const move = parts[1];
            if (this.moveResolver) {
                this.moveResolver({ move }); // Resolve the promise with the move
                this.moveResolver = null;
            }
        }
    }

    /**
     * Sends a command string to the Stockfish engine.
     * @param {string} command The UCI command to send.
     */
    _sendCommand(command) {
        if (!this.engine) return;
        logger.trace('[AI] >', command);
        this.engine.postMessage(command);
    }

    /**
     * Asks the engine to find the best move for a given board position.
     * @param {string} fen The FEN string of the current position.
     * @param {object} options Configuration for the search.
     * @param {number} options.time The time in milliseconds for the engine to think.
     * @param {number} options.maxDepth The maximum depth for the engine to search.
     * @returns {Promise<{move: string|null}>} A promise that resolves with the best move in UCI format (e.g., 'e2e4').
     */
    async getMove(fen, options = {}) {
        await this.readyPromise; // Wait for the engine to be ready
        // Handle dynamic time allocation if clock info included
        const { whiteTime, blackTime, increment, color, moveNumber } = options;

        let searchParams = { maxDepth: options.maxDepth, time: options.time };

        if (whiteTime !== undefined && blackTime !== undefined && color) {
            const timeLeft = color === 'w' ? whiteTime : blackTime;
            const inc = increment || 0;
            const moveNo = moveNumber || 1;
            const optimal = this._calculateOptimalTime(color, timeLeft, inc, moveNo);
            searchParams.time = optimal.time; // movetime based search for reliability in browser
            searchParams.maxDepth = optimal.depth;

            // If very low time, optionally narrow search scope (placeholder for future move filtering)
            if (timeLeft < 2000) {
                const forcing = this._getPriorityMoves(fen);
                if (forcing && forcing.length) {
                    searchParams.searchMoves = forcing; // Not currently wired into go command; reserved.
                }
            }
        }

        return new Promise((resolve) => {
            this.moveResolver = resolve; // Store the resolver function
            this._sendCommand(`position fen ${fen}`);

            let goCommand;
            if (searchParams.maxDepth && !searchParams.time) {
                goCommand = `go depth ${searchParams.maxDepth}`;
            } else if (searchParams.time) {
                // Using movetime ensures we don't accidentally blow the allocated slice.
                goCommand = `go movetime ${searchParams.time}`;
            } else if (searchParams.maxDepth && searchParams.time) {
                // If both are present, prefer a bounded time search (depth hint logged)
                goCommand = `go movetime ${searchParams.time}`;
            } else {
                goCommand = 'go depth 15';
            }
            logger.debug('[AI Search]', { goCommand, searchParams });
            this._sendCommand(goCommand);
        });
    }

    /**
     * Terminates the engine worker. Call this when the game is reset.
     */
    terminate() {
        if (this.engine) {
            this.engine.terminate();
            this.engine = null;
            if (this._resolveReady) {
                this._resolveReady(); // Unblock any pending promises
            }
            logger.info('[AI] Engine terminated.');
        }
    }

    // ---------------------------------------------------
    // Dynamic Time Management Helpers
    // ---------------------------------------------------
    _calculateOptimalTime(color, timeLeft, increment, moveNumber) {
        // Emergency bailout: leave a minimal buffer
        const emergency = this._handleTimeEmergency(color, timeLeft);
        if (emergency) return emergency;

        if (!isFinite(timeLeft) || timeLeft <= 0) {
            return { time: 2000, depth: 15 }; // Untimed / fallback
        }

        const isBullet = timeLeft < this.timeManager.emergencyThreshold;
        const isBlitz = timeLeft < 60000; // < 60s left triggers blitz urgency
        const movesRemaining = Math.max(10, 50 - moveNumber); // crude phase heuristic

        let allocatedTime;
        if (isBullet) {
            allocatedTime = Math.max(100, timeLeft / Math.max(5, movesRemaining / 2));
        } else if (isBlitz) {
            allocatedTime = Math.max(200, timeLeft / Math.max(8, movesRemaining));
        } else {
            allocatedTime = Math.max(1000, timeLeft / Math.max(12, movesRemaining));
        }

        // Incorporate increment value conservatively
        allocatedTime = Math.min(allocatedTime + (increment * 0.8), timeLeft - 100);
        allocatedTime = Math.max(50, Math.min(allocatedTime, timeLeft - 50));

        let depth;
        if (allocatedTime < 500) depth = 8;
        else if (allocatedTime < 1500) depth = 12;
        else if (allocatedTime < 5000) depth = 15;
        else depth = 18;

        logger.info('[AI Time Mgmt]', {
            color,
            timeLeft: Math.round(timeLeft),
            allocatedTime: Math.round(allocatedTime),
            depth,
            moveNumber,
            mode: isBullet ? 'bullet' : isBlitz ? 'blitz' : 'classical'
        });

        return { time: Math.round(allocatedTime), depth };
    }

    _handleTimeEmergency(color, timeLeft) {
        if (timeLeft < 2000) {
            const slice = Math.max(50, timeLeft - 100); // leave 100ms buffer
            return { time: slice, depth: 6, emergency: true };
        }
        return null;
    }

    _getPriorityMoves(fen) {
        // Placeholder for future forcing move extraction (checks, captures, promotions)
        // Returning null lets engine decide ordering.
        return null;
    }

    async getQuickMove(fen, maxTime = 1000) {
        await this.readyPromise;
        return new Promise((resolve) => {
            this.moveResolver = resolve;
            this._sendCommand(`position fen ${fen}`);
            this._sendCommand(`go movetime ${maxTime}`);
        });
    }
}
