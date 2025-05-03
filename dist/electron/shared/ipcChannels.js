"use strict";
// This file defines the string constants used for IPC channel names.
// Follow naming conventions (e.g., NOUN_VERB or feature:action).
// Example: export const NOTEBOOK_SAVE = 'notebook:save';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET_SLICE_DETAILS = exports.CHAT_GET_MESSAGES = exports.ON_CHAT_STREAM_ERROR = exports.ON_CHAT_STREAM_END = exports.ON_CHAT_RESPONSE_CHUNK = exports.CHAT_STREAM_STOP = exports.CHAT_STREAM_START = exports.BOOKMARKS_PROGRESS = exports.FILE_SAVE_TEMP = exports.BOOKMARKS_IMPORT = exports.PROFILE_GET = exports.GET_APP_VERSION = void 0;
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
//# sourceMappingURL=ipcChannels.js.map