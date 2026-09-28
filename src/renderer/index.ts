import './style.css';
window.electron?.ipcRenderer.once('ipc-example', (message) => {
  console.log(message);
});
window.electron?.ipcRenderer.sendMessage('ipc-example', 'ping');
