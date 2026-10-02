import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { LanAccessGate } from './components/LanAccessGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { restoreRememberedNaiKey } from './services/naiKeyStorage';
import { restoreAppearancePreferences } from './services/appearancePreferences';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

restoreAppearancePreferences();
// 门禁和错误边界在 App 外层，系统变化时仍需更新；App 挂载后继续管理即时修改。
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restoreAppearancePreferences);
restoreRememberedNaiKey();
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
