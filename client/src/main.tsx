import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setupGlobalErrorHandlers } from './errorHandling'

const runtimeDebugLogsEnabled =
  !import.meta.env.PROD ||
  new URLSearchParams(window.location.search).has('debugLogs') ||
  window.localStorage.getItem('ag_debug_logs') === '1';

if (!runtimeDebugLogsEnabled) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// Initialize Error Handlers
setupGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
