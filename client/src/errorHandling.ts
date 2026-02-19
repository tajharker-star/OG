import { connectionManager } from './services/socket';

export const setupGlobalErrorHandlers = () => {
    window.onerror = (message, source, lineno, _colno, error) => {
        console.error('[Global Error]', message, source, lineno, error);
        connectionManager.updateState({
            phase: 'FAILED',
            error: message.toString(),
            details: `Source: ${source}:${lineno}\n${error?.stack || ''}`
        });
    };

    window.onunhandledrejection = (event) => {
        console.error('[GlobalErrorHandler] Unhandled Rejection:', event.reason);
        connectionManager.updateState({ 
            phase: 'FAILED', 
            error: 'Async Error', 
            details: event.reason?.toString() || 'Unknown Promise Error' 
        });
    };

    console.log('[GlobalErrorHandler] Initialized');
};
