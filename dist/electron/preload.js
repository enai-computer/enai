"use strict";

// electron/preload.ts
var import_electron = require("electron");

// shared/ipcChannels.ts
var PROFILE_GET = "profile:get";
var BOOKMARKS_IMPORT = "bookmarks:import";
var FILE_SAVE_TEMP = "file:saveTemp";
var BOOKMARKS_PROGRESS = "bookmarks:progress";
var CHAT_STREAM_START = "chat:stream:start";
var CHAT_STREAM_STOP = "chat:stream:stop";
var ON_CHAT_RESPONSE_CHUNK = "chat:onResponseChunk";
var ON_CHAT_STREAM_END = "chat:onStreamEnd";
var ON_CHAT_STREAM_ERROR = "chat:onStreamError";
var CHAT_GET_MESSAGES = "chat:getMessages";
var GET_SLICE_DETAILS = "slices:getDetails";

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
  },
  // --- Chat Streaming --- 
  startChatStream: (sessionId, question) => {
    if (!sessionId || !question) {
      console.error("[Preload Script] startChatStream called with invalid sessionId or question.");
      return;
    }
    console.log(`[Preload Script] Sending CHAT_STREAM_START for session: ${sessionId}, question: "${question.substring(0, 30)}..."`);
    import_electron.ipcRenderer.send(CHAT_STREAM_START, { sessionId, question });
  },
  stopChatStream: () => {
    console.log(`[Preload Script] Sending CHAT_STREAM_STOP`);
    import_electron.ipcRenderer.send(CHAT_STREAM_STOP);
  },
  // Listener for incoming chat chunks (Main -> Renderer)
  onChatChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    import_electron.ipcRenderer.on(ON_CHAT_RESPONSE_CHUNK, listener);
    return () => import_electron.ipcRenderer.removeListener(ON_CHAT_RESPONSE_CHUNK, listener);
  },
  // Listener for stream end signal (Main -> Renderer)
  onChatStreamEnd: (callback) => {
    const listener = (_event, result) => callback(result);
    import_electron.ipcRenderer.on(ON_CHAT_STREAM_END, listener);
    return () => import_electron.ipcRenderer.removeListener(ON_CHAT_STREAM_END, listener);
  },
  // Listener for stream error signal (Main -> Renderer)
  onChatStreamError: (callback) => {
    const listener = (_event, errorMessage) => callback(errorMessage);
    import_electron.ipcRenderer.on(ON_CHAT_STREAM_ERROR, listener);
    return () => import_electron.ipcRenderer.removeListener(ON_CHAT_STREAM_ERROR, listener);
  },
  // --- End Chat Streaming ---
  // --- Add Chat Message Retrieval ---
  getMessages: (sessionId, limit, beforeTimestamp) => {
    console.log(`[Preload Script] Invoking getMessages for session: ${sessionId}, limit: ${limit}`);
    return import_electron.ipcRenderer.invoke(CHAT_GET_MESSAGES, { sessionId, limit, beforeTimestamp });
  },
  // --- Add Slice Detail Retrieval ---
  getSliceDetails: (chunkIds) => {
    console.log(`[Preload Script] Invoking getSliceDetails for ${chunkIds.length} IDs: [${chunkIds.slice(0, 5).join(", ")}]...`);
    if (!Array.isArray(chunkIds) || chunkIds.some((id) => typeof id !== "number")) {
      console.error("[Preload Script] getSliceDetails called with invalid input (must be array of numbers).");
      return Promise.reject(new Error("Invalid input: chunkIds must be an array of numbers."));
    }
    return import_electron.ipcRenderer.invoke(GET_SLICE_DETAILS, chunkIds);
  }
};
try {
  import_electron.contextBridge.exposeInMainWorld("api", api);
  console.log("[Preload Script] API exposed successfully.");
} catch (error) {
  console.error("[Preload Script] Failed to expose API:", error);
}
//# sourceMappingURL=preload.js.map
