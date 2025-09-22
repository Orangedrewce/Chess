/* Centralized logger to standardize console output across the app.
 * Exports a default `logger` object with methods: info, warn, error, debug, trace.
 * Each method prefixes messages with a level tag and uses colors for easier filtering.
 * Additionally stores the last 100 log calls (level, timestamp, original args) in memory
 * via a lightweight circular buffer for potential UI/debug inspection.
 *
 * NOTE: Arguments are stored by reference (no serialization) to avoid performance cost.
 * Avoid logging extremely large objects you don't want retained in memory for a short time.
 */

// Define the maximum number of messages to retain.
const MAX_MESSAGES = 100;

// Simple array used as a capped queue (given small size, shift() cost is negligible here).
const messages = [];

const makeLoggerMethod = (label, cssColor, method = 'log') => {
    return (...args) => {
        // Store message metadata
        try {
            messages.push({
                level: label,
                timestamp: new Date().toISOString(),
                content: args,
            });
            if (messages.length > MAX_MESSAGES) {
                messages.shift();
            }
        } catch (_) {
            // Swallow storage errors silently (e.g., if pushing somehow fails)
        }

        // Original console emission logic
        try {
            const prefix = `%c[${label}]`;
            const style = `color: ${cssColor}; font-weight: 600`;
            if (console && console[method]) {
                console[method](prefix, style, ...args);
            } else {
                console.log(`[${label}]:`, ...args);
            }
        } catch (e) {
            // Never throw from the logger to avoid cascading failures.
            try { console.log(`[${label}]:`, ...args); } catch (err) {}
        }
    };
};

const logger = {
    info: makeLoggerMethod('INFO', 'dodgerblue', 'log'),
    warn: makeLoggerMethod('WARN', 'orange', 'warn'),
    error: makeLoggerMethod('ERROR', 'crimson', 'error'),
    debug: makeLoggerMethod('DEBUG', 'purple', 'log'),
    trace: makeLoggerMethod('TRACE', 'gray', 'log'),
    /**
     * Returns a shallow copy of the stored log message objects.
     * @returns {Array<{level:string,timestamp:string,content:Array}>}
     */
    getMessages: () => [...messages],
};

export default logger;
