// This file defines the string constants used for IPC channel names.
// Follow naming conventions (e.g., NOUN_VERB or feature:action).
// Example: export const NOTEBOOK_SAVE = 'notebook:save';

/** Simple channel for renderer to check main process version. */
export const GET_APP_VERSION = 'get-app-version';

// Profile channels
/** Get the current user profile information. */
export const PROFILE_GET = 'profile:get';
/** Update the user profile information. */
export const PROFILE_UPDATE = 'profile:update';

// Weather channels
/** Get current weather data for Marina District, SF. */
export const WEATHER_GET = 'weather:get';

// Activity logging channels
/** Log a user activity. */
export const ACTIVITY_LOG_ADD = 'activity:log:add';

/** Start the import process for a bookmarks file (HTML/JSON). Expects temp file path. */
export const BOOKMARKS_IMPORT = 'bookmarks:import';

// URL ingestion
/** Ingest a URL into the system (add to objects table and process). */
export const INGEST_URL = 'ingestion:ingest-url';

// File operations
/** Save uploaded file data to a temporary location. Expects { fileName, data }. Returns absolute path. */
export const FILE_SAVE_TEMP = 'file:saveTemp';

/** Open URL in the default browser. */
export const OPEN_EXTERNAL_URL = 'app:openExternalUrl';

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

// --- Intent Streaming Channels ---
/** Main -> Renderer: Signal that intent streaming has started. */
export const ON_INTENT_STREAM_START = 'intent:onStreamStart';

/** Main -> Renderer: Send a chunk of the streaming intent response. */
export const ON_INTENT_STREAM_CHUNK = 'intent:onStreamChunk';

/** Main -> Renderer: Signal that the intent stream has ended successfully. */
export const ON_INTENT_STREAM_END = 'intent:onStreamEnd';

/** Main -> Renderer: Signal that an error occurred during the intent stream. */
export const ON_INTENT_STREAM_ERROR = 'intent:onStreamError';

/** Main -> Renderer: Send suggested actions based on the user's query and context. */
export const ON_SUGGESTED_ACTIONS = 'intent:on-suggested-actions';

// --- Notebook Operations ---
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
/** Renderer -> Main: Compose a new notebook from source objects. */
export const NOTEBOOK_COMPOSE = 'notebook:compose';
/** Renderer -> Main: Get recently viewed notebooks. */
export const NOTEBOOK_GET_RECENTLY_VIEWED = 'notebook:get-recently-viewed';

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

// --- To-Do Operations ---
/** Renderer -> Main: Create a new to-do item. */
export const TODO_CREATE = 'todo:create';
/** Renderer -> Main: Get all to-dos for a user. */
export const TODO_GET_ALL = 'todo:getAll';
/** Renderer -> Main: Get a specific to-do by ID. */
export const TODO_GET_BY_ID = 'todo:getById';
/** Renderer -> Main: Update a to-do item. */
export const TODO_UPDATE = 'todo:update';
/** Renderer -> Main: Delete a to-do item. */
export const TODO_DELETE = 'todo:delete';

// --- Classic Browser Channels ---
/** Renderer -> Main: create and attach a BrowserView */
export const CLASSIC_BROWSER_CREATE = 'browser:create';
/** Renderer -> Main: Request navigation action (back, forward, reload, stop, url) in a classic browser window. */
export const CLASSIC_BROWSER_NAVIGATE = 'browser:navigate';
/** Renderer -> Main: Request to load a specific URL in a classic browser window. */
export const CLASSIC_BROWSER_LOAD_URL = 'browser:loadUrl';
/** Renderer -> Main: Set BrowserView bounds */
export const CLASSIC_BROWSER_SET_BOUNDS = 'classic-browser:set-bounds';
/** Renderer -> Main: Set BrowserView visibility */
export const CLASSIC_BROWSER_SET_VISIBILITY = 'classic-browser:set-visibility';
/** Main -> Renderer: Send state updates for a classic browser window (e.g., URL change, loading status). */
export const ON_CLASSIC_BROWSER_STATE = 'on-classic-browser-state';
/** Renderer -> Main: destroy a BrowserView */
export const CLASSIC_BROWSER_DESTROY = 'browser:destroy';
/** Renderer -> Main: Get the complete state of a browser window (for state synchronization on mount). */
export const CLASSIC_BROWSER_GET_STATE = 'browser:getState';

// Added for WebContentsView focus events
export const CLASSIC_BROWSER_VIEW_FOCUSED = 'classic-browser-view-focused';

// Added for Renderer to request main process to focus a view
export const CLASSIC_BROWSER_REQUEST_FOCUS = 'classic-browser-request-focus';

// Main -> Renderer: Notify when a classic browser window navigates to a new URL
export const ON_CLASSIC_BROWSER_URL_CHANGE = 'on-classic-browser-url-change';

// Tab management channels
/** Create a new tab in a classic browser window. */
export const CLASSIC_BROWSER_CREATE_TAB = 'classic-browser:create-tab';
/** Switch to a different tab in a classic browser window. */
export const CLASSIC_BROWSER_SWITCH_TAB = 'classic-browser:switch-tab';
/** Close a tab in a classic browser window. */
export const CLASSIC_BROWSER_CLOSE_TAB = 'classic-browser:close-tab';
/** Set the background color of the WebContentsView. */
export const CLASSIC_BROWSER_SET_BACKGROUND_COLOR = 'classic-browser:set-background-color';

// Freeze/unfreeze browser views to handle z-index issues
/** Renderer -> Main: Capture snapshot and hide browser view. Returns snapshot data URL. */
export const BROWSER_FREEZE_VIEW = 'browser:freezeView';
/** Renderer -> Main: Show browser view and remove snapshot. */
export const BROWSER_UNFREEZE_VIEW = 'browser:unfreezeView';

// --- Electron Store Persistence Channels ---
/** Renderer -> Main: Get a value from the persistent store. Expects key, returns string or null. */
/** Renderer -> Main: Set a value in the persistent store. Expects key and string value. */
/** Renderer -> Main: Remove a value from the persistent store. Expects key. */

export const ON_AGENT_STATE_UPDATE = 'agent:on-state-update';

// Unique ID for the WebLayer's BrowserView instance
export const WEB_LAYER_WINDOW_ID = '__WEBLAYER_SINGLETON__';

// --- PDF Ingestion Channels ---
/** Renderer -> Main: Request to ingest PDF files. */
export const PDF_INGEST_REQUEST = 'pdf:ingest:request';

/** Main -> Renderer: Send progress updates for PDF ingestion. */
export const PDF_INGEST_PROGRESS = 'pdf:ingest:progress';

/** Main -> Renderer: Signal that batch PDF ingestion is complete. */
export const PDF_INGEST_BATCH_COMPLETE = 'pdf:ingest:batch-complete';

/** Renderer -> Main: Cancel ongoing PDF ingestion. */
export const PDF_INGEST_CANCEL = 'pdf:ingest:cancel';

// --- Object Operations ---
/** Renderer -> Main: Get an object by its ID. */
export const OBJECT_GET_BY_ID = 'object:getById';
/** Renderer -> Main: Delete objects by their IDs. */
export const OBJECT_DELETE = 'object:delete';

// --- Note Operations ---
/** Renderer -> Main: Create a new note. */
export const NOTE_CREATE = 'note:create';
/** Renderer -> Main: Get all notes for a notebook. */
export const NOTE_GET_FOR_NOTEBOOK = 'note:getForNotebook';
/** Renderer -> Main: Update a note. */
export const NOTE_UPDATE = 'note:update';
/** Renderer -> Main: Delete a note. */
export const NOTE_DELETE = 'note:delete';

// Slice / Chunk related (consider if these need more specific prefixes or are ok)

export const ON_MAIN_REQUEST_FLUSH = 'main:request-flush';

// Shortcuts
export const SHORTCUT_MINIMIZE_WINDOW = 'shortcut:minimize-window';

// Window Stack Synchronization
/** Renderer -> Main: Sync the stacking order of WebContentsViews to match window z-indices */
export const SYNC_WINDOW_STACK_ORDER = 'window:sync-stack-order';

// --- Generic Streaming Channels ---
/** Main -> Renderer: Signal that a generic stream has started. */
export const ON_STREAM_START = 'stream:onStart';

/** Main -> Renderer: Send a chunk of streaming data. */
export const ON_STREAM_CHUNK = 'stream:onChunk';

/** Main -> Renderer: Signal that the stream has ended successfully with optional payload. */
export const ON_STREAM_END = 'stream:onEnd';

/** Main -> Renderer: Signal that an error occurred during streaming. */
export const ON_STREAM_ERROR = 'stream:onError';
