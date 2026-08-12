(() => {
  const PAGE_SOURCE = 'npm-pixiv-gallery';
  const EXTENSION_SOURCE = 'npm-pixiv-callback-bridge';

  const announce = () => window.postMessage({ source: EXTENSION_SOURCE, type: 'ready' }, window.location.origin);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE) return;
    if (message.type === 'probe') {
      announce();
      return;
    }
    if (message.type !== 'set-session') return;
    const id = String(message.id || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return;
    chrome.runtime.sendMessage({ type: 'set-session', id, origin: window.location.origin });
  });

  announce();
})();
