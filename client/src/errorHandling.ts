import { connectionManager } from './services/socket';

const emitBootError = (message: string) => {
    window.dispatchEvent(new CustomEvent('ag:boot-error', {
        detail: { message }
    }));
};

export const setupGlobalErrorHandlers = () => {
    window.onerror = (message, source, lineno, _colno, error) => {
        console.error('[Global Error]', message, source, lineno, error);
        emitBootError(`Renderer error: ${message.toString()}\n${source}:${lineno}`);
        connectionManager.updateState({
            phase: 'FAILED',
            error: message.toString(),
            details: `Source: ${source}:${lineno}\n${error?.stack || ''}`
        });
    };

    window.onunhandledrejection = (event) => {
        console.error('[GlobalErrorHandler] Unhandled Rejection:', event.reason);
        emitBootError(`Unhandled startup error: ${event.reason?.toString() || 'Unknown Promise Error'}`);
        connectionManager.updateState({ 
            phase: 'FAILED', 
            error: 'Async Error', 
            details: event.reason?.toString() || 'Unknown Promise Error' 
        });
    };

    console.log('[GlobalErrorHandler] Initialized');
};
