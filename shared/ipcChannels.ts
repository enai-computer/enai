// This file defines the string constants used for IPC channel names.
// Follow naming conventions (e.g., NOUN_VERB or feature:action).
// Example: export const NOTEBOOK_SAVE = 'notebook:save';

/** Simple channel for renderer to check main process version. */
export const GET_APP_VERSION = 'get-app-version';

// Profile channels
/** Get the current user profile information. */
export const PROFILE_GET = 'profile:get';

/** Start the import process for a bookmarks file (HTML/JSON). Expects temp file path. */
export const BOOKMARKS_IMPORT = 'bookmarks:import';

// File operations
/** Save uploaded file data to a temporary location. Expects { fileName, data }. Returns absolute path. */
export const FILE_SAVE_TEMP = 'file:saveTemp';

// Bookmark ingestion progress event
/** Event channel for broadcasting bookmark import progress updates. */
export const BOOKMARKS_PROGRESS = 'bookmarks:progress';

// --- Chat Streaming Channels ---
/** Renderer -> Main: Start a chat stream request with a question. */
export const CHAT_STREAM_START = 'chat:stream:start';

/** Renderer -> Main: Request to stop an ongoing chat stream. */
export const CHAT_STREAM_STOP = 'chat:stream:stop';

/** Main -> Renderer: Send a chunk of the streaming response. */
export const ON_CHAT_RESPONSE_CHUNK = 'chat:onResponseChunk';

/** Main -> Renderer: Signal that the chat stream has ended successfully. */
export const ON_CHAT_STREAM_END = 'chat:onStreamEnd';

/** Main -> Renderer: Signal that an error occurred during the chat stream. */
export const ON_CHAT_STREAM_ERROR = 'chat:onStreamError';

// --- Add new channel ---
/** Renderer -> Main: Request to retrieve messages for a specific chat session. */
export const CHAT_GET_MESSAGES = 'chat:getMessages';

// --- Add new channel for fetching slice details ---
/** Renderer -> Main: Request detailed information for specific chunk IDs (returns SliceDetail[]). */
export const GET_SLICE_DETAILS = 'slices:getDetails';

// --- Intent Handling Channels ---
/** Renderer -> Main: Send user's intent from Welcome Page or Command Bar. */
export const SET_INTENT = 'intent:set';

/** Main -> Renderer: Send the result/outcome of processing an intent. */
export const ON_INTENT_RESULT = 'intent:on-result';

// --- Notebook Operations ---
/** Renderer -> Main: Create a new notebook. */
export const NOTEBOOK_CREATE = 'notebook:create';
/** Renderer -> Main: Get a notebook by its ID. */
export const NOTEBOOK_GET_BY_ID = 'notebook:getById';
/** Renderer -> Main: Get all notebooks. */
export const NOTEBOOK_GET_ALL = 'notebook:getAll';
/** Renderer -> Main: Update a notebook. */
export const NOTEBOOK_UPDATE = 'notebook:update';
/** Renderer -> Main: Delete a notebook. */
export const NOTEBOOK_DELETE = 'notebook:delete';
/** Renderer -> Main: Get all chunks for a notebook. */
export const NOTEBOOK_GET_CHUNKS = 'notebook:getChunks';

// --- Chat Session Operations within Notebooks ---
/** Renderer -> Main: Create a new chat session in a notebook. */
export const CHAT_SESSION_CREATE_IN_NOTEBOOK = 'chatSession:createInNotebook';
/** Renderer -> Main: List all chat sessions for a notebook. */
export const CHAT_SESSION_LIST_FOR_NOTEBOOK = 'chatSession:listForNotebook';
/** Renderer -> Main: Transfer a chat session to a different notebook. */
export const CHAT_SESSION_TRANSFER_TO_NOTEBOOK = 'chatSession:transferToNotebook';

// --- Zustand Store Persistence Channels ---
/** Renderer -> Main: Get a value from the persistent store. Expects key, returns string or null. */
export const STORE_GET = 'store:get';
/** Renderer -> Main: Set a value in the persistent store. Expects key and string value. */
export const STORE_SET = 'store:set';
/** Renderer -> Main: Remove a value from the persistent store. Expects key. */
export const STORE_REMOVE = 'store:remove';

// Add these for flushing stores on quit
export const MAIN_REQUEST_RENDERER_FLUSH = 'main:request-renderer-flush';
export const RENDERER_FLUSH_COMPLETE = 'renderer:flush-complete';

// --- Classic Browser Channels ---
/** Renderer -> Main: create and attach a BrowserView */
export const CLASSIC_BROWSER_INIT_VIEW = 'classicBrowser:initView';
/** Renderer -> Main: Request to load a URL in a classic browser window. */
export const CLASSIC_BROWSER_LOAD_URL = 'classicBrowser:loadUrl';
/** Renderer -> Main: Request navigation action (back, forward, reload, stop) in a classic browser window. */
export const CLASSIC_BROWSER_NAVIGATE = 'classicBrowser:navigate';
/** Renderer -> Main: synchronize BrowserView bounds/visibility */
export const CLASSIC_BROWSER_SYNC_VIEW = 'classicBrowser:syncView';
/** Main -> Renderer: Send state updates for a classic browser window (e.g., URL change, loading status). */
export const ON_CLASSIC_BROWSER_STATE_UPDATE = 'classicBrowser:onStateUpdate';
/** Renderer -> Main: destroy a BrowserView */
export const CLASSIC_BROWSER_DESTROY = 'classicBrowser:destroy';

// --- Electron Store Persistence Channels ---
/** Renderer -> Main: Get a value from the persistent store. Expects key, returns string or null. */
/** Renderer -> Main: Set a value in the persistent store. Expects key and string value. */
/** Renderer -> Main: Remove a value from the persistent store. Expects key. */
