const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__TAURI__', { core: { invoke: (command, args) => ipcRenderer.invoke('test:command', command, args) } });
