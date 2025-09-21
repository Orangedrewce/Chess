/* Centralized logger to standardize console output across the app.
 * Exports a default `logger` object with methods: info, warn, error, debug, trace.
 * Each method prefixes messages with a level tag and uses colors for easier filtering.
 */
const makeLoggerMethod = (label, cssColor, method = 'log') => {
    return (...args) => {
        try {
            const prefix = `%c[${label}]`;
            const style = `color: ${cssColor}; font-weight: 600`;
            if (console && console[method]) {
                console[method](prefix, style, ...args);
            } else {
                // Fallback
                console.log(`${label}:`, ...args);
            }
        } catch (e) {
            // Never throw from the logger
            try { console.log(`${label}:`, ...args); } catch (err) {}
        }
    };
};

const logger = {
    info: makeLoggerMethod('INFO', 'dodgerblue', 'log'),
    warn: makeLoggerMethod('WARN', 'orange', 'warn'),
    error: makeLoggerMethod('ERROR', 'crimson', 'error'),
    debug: makeLoggerMethod('DEBUG', 'purple', 'log'),
    trace: makeLoggerMethod('TRACE', 'gray', 'log'),
};

export default logger;
