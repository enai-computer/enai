"use strict";

// electron/preload.ts
var import_electron = require("electron");

// shared/ipcChannels.ts
var PROFILE_GET = "profile:get";
var BOOKMARKS_IMPORT = "bookmarks:import";
var FILE_SAVE_TEMP = "file:saveTemp";
var BOOKMARKS_PROGRESS = "bookmarks:progress";

// electron/preload.ts
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
    return import_electron.ipcRenderer.invoke("get-app-version");
  },
  getProfile: () => {
    console.log("[Preload Script] Requesting profile via IPC");
    return import_electron.ipcRenderer.invoke(PROFILE_GET);
  },
  // Add importBookmarks function
  importBookmarks: (filePath) => {
    console.log("[Preload Script] Invoking bookmarks import via IPC");
    return import_electron.ipcRenderer.invoke(BOOKMARKS_IMPORT, filePath);
  },
  // Add saveTempFile function
  saveTempFile: (fileName, data) => {
    console.log("[Preload Script] Invoking save temp file via IPC");
    return import_electron.ipcRenderer.invoke(FILE_SAVE_TEMP, { fileName, data });
  },
  // Add listener for bookmark progress
  onBookmarksProgress: (callback) => {
    console.log("[Preload Script] Setting up listener for", BOOKMARKS_PROGRESS);
    const listener = (_event, event) => {
      callback(event);
    };
    import_electron.ipcRenderer.on(BOOKMARKS_PROGRESS, listener);
    return () => {
      console.log("[Preload Script] Removing listener for", BOOKMARKS_PROGRESS);
      import_electron.ipcRenderer.removeListener(BOOKMARKS_PROGRESS, listener);
    };
  }
};
try {
  import_electron.contextBridge.exposeInMainWorld("api", api);
  console.log("[Preload Script] API exposed successfully.");
} catch (error) {
  console.error("[Preload Script] Failed to expose API:", error);
}
//# sourceMappingURL=preload.js.map
