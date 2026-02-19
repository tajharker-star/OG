const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onStatus: (callback) => ipcRenderer.on('status-update', (event, text) => callback(text)),
    onProgress: (callback) => ipcRenderer.on('progress-update', (event, percent) => callback(percent)),
    onError: (callback) => ipcRenderer.on('error-update', (event, text) => callback(text))
});
