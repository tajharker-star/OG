const { contextBridge, ipcRenderer } = require('electron');

const api = {
    onStatus: (callback) => ipcRenderer.on('status-update', (event, text) => callback(text)),
    onProgress: (callback) => ipcRenderer.on('progress-update', (event, percent) => callback(percent)),
    onError: (callback) => ipcRenderer.on('error-update', (event, text) => callback(text))
};

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', api);
} else {
    window.api = api;
}
