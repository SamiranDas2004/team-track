const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    let validChannels = ['tracking-state', 'timer-control'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    let validChannels = ['timer-update'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  getPath: (relativePath) => {
    return path.join(__dirname, relativePath);
  },
  loadHaarCascade: () => {
    return ipcRenderer.invoke('load-haar-cascade');
  },
});