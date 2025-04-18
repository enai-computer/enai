"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// dist/shared/ipcChannels.js
var require_ipcChannels = __commonJS({
  "dist/shared/ipcChannels.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.INGESTION_PROGRESS = exports2.BOOKMARKS_PROGRESS = exports2.FILE_SAVE_TEMP = exports2.BOOKMARKS_IMPORT = exports2.PROFILE_GET = exports2.GET_APP_VERSION = void 0;
    exports2.GET_APP_VERSION = "get-app-version";
    exports2.PROFILE_GET = "profile:get";
    exports2.BOOKMARKS_IMPORT = "bookmarks:import";
    exports2.FILE_SAVE_TEMP = "file:saveTemp";
    exports2.BOOKMARKS_PROGRESS = "bookmarks:progress";
    exports2.INGESTION_PROGRESS = "ingestion:progress";
  }
});

// dist/electron/preload.js
Object.defineProperty(exports, "__esModule", { value: true });
var electron_1 = require("electron");
var ipcChannels_1 = require_ipcChannels();
console.log("[Preload Script] Loading...");
var api = {
  // Example function structure (uncomment and adapt when needed):
  /*
  exampleAction: (args: ExampleType): Promise<any> => {
    console.log('[Preload Script] Calling exampleAction via IPC');
    return ipcRenderer.invoke(CHANNEL_NAME_EXAMPLE, args);
  },
  */
  // --- Add actual API functions here as features are implemented ---
  // Simple example to confirm preload is working
  getAppVersion: () => {
    console.log("[Preload Script] Requesting app version via IPC");
    return electron_1.ipcRenderer.invoke("get-app-version");
  },
  getProfile: () => {
    console.log("[Preload Script] Requesting profile via IPC");
    return electron_1.ipcRenderer.invoke(ipcChannels_1.PROFILE_GET);
  },
  // Add importBookmarks function
  importBookmarks: (filePath) => {
    console.log("[Preload Script] Invoking bookmarks import via IPC");
    return electron_1.ipcRenderer.invoke(ipcChannels_1.BOOKMARKS_IMPORT, filePath);
  },
  // Add saveTempFile function
  saveTempFile: (fileName, data) => {
    console.log("[Preload Script] Invoking save temp file via IPC");
    return electron_1.ipcRenderer.invoke(ipcChannels_1.FILE_SAVE_TEMP, { fileName, data });
  },
  // Add listener for bookmark progress
  onBookmarksProgress: (callback) => {
    console.log("[Preload Script] Setting up listener for", ipcChannels_1.BOOKMARKS_PROGRESS);
    const listener = (_event, event) => {
      callback(event);
    };
    electron_1.ipcRenderer.on(ipcChannels_1.BOOKMARKS_PROGRESS, listener);
    return () => {
      console.log("[Preload Script] Removing listener for", ipcChannels_1.BOOKMARKS_PROGRESS);
      electron_1.ipcRenderer.removeListener(ipcChannels_1.BOOKMARKS_PROGRESS, listener);
    };
  }
};
try {
  electron_1.contextBridge.exposeInMainWorld("api", api);
  console.log("[Preload Script] API exposed successfully.");
} catch (error) {
  console.error("[Preload Script] Failed to expose API:", error);
}
