// src/ai/ChessAI.js
import logger from '../utils/logger.js';

/**
 * A wrapper class for the Stockfish chess engine running in a Web Worker.
 * This class handles UCI communication and provides a simple getMove() method.
 */
export class ChessAI {
    constructor(enginePath = '/stockfish/stockfish.js', timeout = 5000) {
        this.engine = new Worker(enginePath);
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

        return new Promise((resolve, reject) => {
            this.moveResolver = resolve; // Store the resolver function

            this._sendCommand(`position fen ${fen}`);

            // Prefer depth for consistent strength, but use time as a fallback/limit.
            if (options.maxDepth) {
                this._sendCommand(`go depth ${options.maxDepth}`);
            } else if (options.time) {
                this._sendCommand(`go movetime ${options.time}`);
            } else {
                // Default search if no options provided
                this._sendCommand('go depth 15');
            }
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
}
