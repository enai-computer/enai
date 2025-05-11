"use strict";
// This file defines the string constants used for IPC channel names.
// Follow naming conventions (e.g., NOUN_VERB or feature:action).
// Example: export const NOTEBOOK_SAVE = 'notebook:save';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLASSIC_BROWSER_DESTROY = exports.ON_CLASSIC_BROWSER_STATE = exports.CLASSIC_BROWSER_SET_VISIBILITY = exports.CLASSIC_BROWSER_SET_BOUNDS = exports.CLASSIC_BROWSER_LOAD_URL = exports.CLASSIC_BROWSER_NAVIGATE = exports.CLASSIC_BROWSER_CREATE = exports.RENDERER_FLUSH_COMPLETE = exports.MAIN_REQUEST_RENDERER_FLUSH = exports.STORE_REMOVE = exports.STORE_SET = exports.STORE_GET = exports.CHAT_SESSION_TRANSFER_TO_NOTEBOOK = exports.CHAT_SESSION_LIST_FOR_NOTEBOOK = exports.CHAT_SESSION_CREATE_IN_NOTEBOOK = exports.NOTEBOOK_GET_CHUNKS = exports.NOTEBOOK_DELETE = exports.NOTEBOOK_UPDATE = exports.NOTEBOOK_GET_ALL = exports.NOTEBOOK_GET_BY_ID = exports.NOTEBOOK_CREATE = exports.ON_INTENT_RESULT = exports.SET_INTENT = exports.GET_SLICE_DETAILS = exports.CHAT_GET_MESSAGES = exports.ON_CHAT_STREAM_ERROR = exports.ON_CHAT_STREAM_END = exports.ON_CHAT_RESPONSE_CHUNK = exports.CHAT_STREAM_STOP = exports.CHAT_STREAM_START = exports.BOOKMARKS_PROGRESS = exports.FILE_SAVE_TEMP = exports.BOOKMARKS_IMPORT = exports.PROFILE_GET = exports.GET_APP_VERSION = void 0;
/** Simple channel for renderer to check main process version. */
exports.GET_APP_VERSION = 'get-app-version';
// Profile channels
/** Get the current user profile information. */
exports.PROFILE_GET = 'profile:get';
/** Start the import process for a bookmarks file (HTML/JSON). Expects temp file path. */
exports.BOOKMARKS_IMPORT = 'bookmarks:import';
// File operations
/** Save uploaded file data to a temporary location. Expects { fileName, data }. Returns absolute path. */
exports.FILE_SAVE_TEMP = 'file:saveTemp';
// Bookmark ingestion progress event
/** Event channel for broadcasting bookmark import progress updates. */
exports.BOOKMARKS_PROGRESS = 'bookmarks:progress';
// --- Chat Streaming Channels ---
/** Renderer -> Main: Start a chat stream request with a question. */
exports.CHAT_STREAM_START = 'chat:stream:start';
/** Renderer -> Main: Request to stop an ongoing chat stream. */
exports.CHAT_STREAM_STOP = 'chat:stream:stop';
/** Main -> Renderer: Send a chunk of the streaming response. */
exports.ON_CHAT_RESPONSE_CHUNK = 'chat:onResponseChunk';
/** Main -> Renderer: Signal that the chat stream has ended successfully. */
exports.ON_CHAT_STREAM_END = 'chat:onStreamEnd';
/** Main -> Renderer: Signal that an error occurred during the chat stream. */
exports.ON_CHAT_STREAM_ERROR = 'chat:onStreamError';
// --- Add new channel ---
/** Renderer -> Main: Request to retrieve messages for a specific chat session. */
exports.CHAT_GET_MESSAGES = 'chat:getMessages';
// --- Add new channel for fetching slice details ---
/** Renderer -> Main: Request detailed information for specific chunk IDs (returns SliceDetail[]). */
exports.GET_SLICE_DETAILS = 'slices:getDetails';
// --- Intent Handling Channels ---
/** Renderer -> Main: Send user's intent from Welcome Page or Command Bar. */
exports.SET_INTENT = 'intent:set';
/** Main -> Renderer: Send the result/outcome of processing an intent. */
exports.ON_INTENT_RESULT = 'intent:on-result';
// --- Notebook Operations ---
/** Renderer -> Main: Create a new notebook. */
exports.NOTEBOOK_CREATE = 'notebook:create';
/** Renderer -> Main: Get a notebook by its ID. */
exports.NOTEBOOK_GET_BY_ID = 'notebook:getById';
/** Renderer -> Main: Get all notebooks. */
exports.NOTEBOOK_GET_ALL = 'notebook:getAll';
/** Renderer -> Main: Update a notebook. */
exports.NOTEBOOK_UPDATE = 'notebook:update';
/** Renderer -> Main: Delete a notebook. */
exports.NOTEBOOK_DELETE = 'notebook:delete';
/** Renderer -> Main: Get all chunks for a notebook. */
exports.NOTEBOOK_GET_CHUNKS = 'notebook:getChunks';
// --- Chat Session Operations within Notebooks ---
/** Renderer -> Main: Create a new chat session in a notebook. */
exports.CHAT_SESSION_CREATE_IN_NOTEBOOK = 'chatSession:createInNotebook';
/** Renderer -> Main: List all chat sessions for a notebook. */
exports.CHAT_SESSION_LIST_FOR_NOTEBOOK = 'chatSession:listForNotebook';
/** Renderer -> Main: Transfer a chat session to a different notebook. */
exports.CHAT_SESSION_TRANSFER_TO_NOTEBOOK = 'chatSession:transferToNotebook';
// --- Zustand Store Persistence Channels ---
/** Renderer -> Main: Get a value from the persistent store. Expects key, returns string or null. */
exports.STORE_GET = 'store:get';
/** Renderer -> Main: Set a value in the persistent store. Expects key and string value. */
exports.STORE_SET = 'store:set';
/** Renderer -> Main: Remove a value from the persistent store. Expects key. */
exports.STORE_REMOVE = 'store:remove';
// Add these for flushing stores on quit
exports.MAIN_REQUEST_RENDERER_FLUSH = 'main:request-renderer-flush';
exports.RENDERER_FLUSH_COMPLETE = 'renderer:flush-complete';
// --- Classic Browser Channels ---
/** Renderer -> Main: create and attach a BrowserView */
exports.CLASSIC_BROWSER_CREATE = 'browser:create';
/** Renderer -> Main: Request navigation action (back, forward, reload, stop, url) in a classic browser window. */
exports.CLASSIC_BROWSER_NAVIGATE = 'browser:navigate';
/** Renderer -> Main: Request to load a specific URL in a classic browser window. */
exports.CLASSIC_BROWSER_LOAD_URL = 'browser:loadUrl';
/** Renderer -> Main: Set BrowserView bounds */
exports.CLASSIC_BROWSER_SET_BOUNDS = 'classic-browser:set-bounds';
/** Renderer -> Main: Set BrowserView visibility */
exports.CLASSIC_BROWSER_SET_VISIBILITY = 'classic-browser:set-visibility';
/** Main -> Renderer: Send state updates for a classic browser window (e.g., URL change, loading status). */
exports.ON_CLASSIC_BROWSER_STATE = 'browser:onState';
/** Renderer -> Main: destroy a BrowserView */
exports.CLASSIC_BROWSER_DESTROY = 'browser:destroy';
// --- Electron Store Persistence Channels ---
/** Renderer -> Main: Get a value from the persistent store. Expects key, returns string or null. */
/** Renderer -> Main: Set a value in the persistent store. Expects key and string value. */
/** Renderer -> Main: Remove a value from the persistent store. Expects key. */
//# sourceMappingURL=ipcChannels.js.map