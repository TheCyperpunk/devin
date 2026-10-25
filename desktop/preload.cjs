// The setup window's bridge: a few named calls to the main process, nothing else from Node reaches the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pralayam', {
  onState: (cb) => ipcRenderer.on('setup:state', (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on('setup:log', (_e, line) => cb(line)),
  state: () => ipcRenderer.invoke('setup:state'),
  save: (s) => ipcRenderer.invoke('setup:save', s),
  makeCerts: (s) => ipcRenderer.invoke('setup:certs', s),
  start: (s) => ipcRenderer.invoke('setup:start', s),
  open: (url) => ipcRenderer.invoke('setup:open-url', url),
});
