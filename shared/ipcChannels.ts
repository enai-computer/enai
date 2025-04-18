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
