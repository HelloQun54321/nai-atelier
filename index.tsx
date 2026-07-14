import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { LanAccessGate } from './components/LanAccessGate';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanAccessGate>
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </LanAccessGate>
  </React.StrictMode>
);
