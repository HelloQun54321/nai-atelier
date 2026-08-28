import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { LanAccessGate } from './components/LanAccessGate';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanAccessGate>
        <ConfirmDialogProvider>
          <App />
        </ConfirmDialogProvider>
      </LanAccessGate>
    </ErrorBoundary>
  </React.StrictMode>
);
