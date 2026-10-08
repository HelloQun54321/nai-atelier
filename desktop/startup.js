const renderStatus = status => {
  document.documentElement.lang = status.language || 'zh-CN';
  for (const action of ['retry', 'logs', 'quit']) if (status.labels?.[action]) document.getElementById(action).textContent = status.labels[action];
  document.querySelector('main').dataset.phase = status.phase;
  document.querySelector('#message').textContent = status.message;
  document.querySelector('#actions').hidden = status.phase !== 'error';
};
window.atelierDesktop.onStatus(renderStatus);
window.atelierDesktop.status().then(renderStatus);
for (const action of ['retry', 'logs', 'quit']) document.getElementById(action).addEventListener('click', () => window.atelierDesktop[action]());
