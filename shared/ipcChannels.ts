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
