const renderStatus = status => {
  document.querySelector('main').dataset.phase = status.phase;
  document.querySelector('#message').textContent = status.message;
  document.querySelector('#actions').hidden = status.phase !== 'error';
};
window.atelierDesktop.onStatus(renderStatus);
window.atelierDesktop.status().then(renderStatus);
for (const action of ['retry', 'logs', 'quit']) document.getElementById(action).addEventListener('click', () => window.atelierDesktop[action]());
