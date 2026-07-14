import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfirmDialogProvider } from './components/ConfirmDialog';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ConfirmDialogProvider>
      <App />
    </ConfirmDialogProvider>
  </React.StrictMode>
);
