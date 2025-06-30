// test_chrome_preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  switchTab: (tabNum) => {
    console.log('Tab switch requested:', tabNum);
    // In a real implementation, this would use IPC to communicate with main process
    if (global.switchTab) {
      global.switchTab(tabNum);
    }
  }
});