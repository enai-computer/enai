"use strict";
// This file defines the string constants used for IPC channel names.
// Follow naming conventions (e.g., NOUN_VERB or feature:action).
// Example: export const NOTEBOOK_SAVE = 'notebook:save';
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_SAVE_TEMP = exports.BOOKMARKS_IMPORT = exports.PROFILE_GET = exports.GET_APP_VERSION = void 0;
// Export the channel name used in the preload example
exports.GET_APP_VERSION = 'get-app-version';
// Profile channels
exports.PROFILE_GET = 'profile:get';
exports.BOOKMARKS_IMPORT = 'bookmarks:import';
// File operations
exports.FILE_SAVE_TEMP = 'file:saveTemp';
//# sourceMappingURL=ipcChannels.js.map