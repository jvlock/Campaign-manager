import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// Some browser layout errors have a message but no Error object. Preserve the
// native details without swallowing the event or disabling error reporting.
window.addEventListener('error', (event) => {
  if (!event.error && event.message) {
    console.error('Browser runtime error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  }
});

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
