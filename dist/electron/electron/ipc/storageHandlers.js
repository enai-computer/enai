"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStorageHandlers = registerStorageHandlers;
const electron_1 = require("electron");
const fs_extra_1 = __importDefault(require("fs-extra")); // Using fs-extra for convenient file operations like ensureDirSync
const path_1 = __importDefault(require("path"));
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
const STORAGE_SUBDIR = 'notebook_layouts';
function getStorageFilePath(key) {
    // Basic sanitization for the key to prevent directory traversal or invalid filenames
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!sanitizedKey) {
        throw new Error('Invalid storage key provided after sanitization.');
    }
    const userDataPath = electron_1.app.getPath('userData');
    const storageDir = path_1.default.join(userDataPath, STORAGE_SUBDIR);
    // Conditional logging for development
    if (process.env.NODE_ENV === 'development') {
        logger_1.logger.debug(`[Storage Handlers] Storage directory for layouts: ${storageDir}`);
    }
    return path_1.default.join(storageDir, `${sanitizedKey}.json`);
}
function registerStorageHandlers() {
    logger_1.logger.info('[Storage Handlers] Registering IPC handlers for persistent storage...');
    electron_1.ipcMain.handle(ipcChannels_1.STORE_GET, async (_event, key) => {
        if (typeof key !== 'string' || !key.trim()) {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_GET}] Invalid key received: ${key}`);
            throw new Error('Invalid key provided to storeGet.');
        }
        const filePath = getStorageFilePath(key);
        logger_1.logger.debug(`[Storage Handlers][${ipcChannels_1.STORE_GET}] Attempting to read key: '${key}' from file: ${filePath}`);
        try {
            if (await fs_extra_1.default.pathExists(filePath)) {
                const data = await fs_extra_1.default.readFile(filePath, 'utf-8');
                logger_1.logger.info(`[Storage Handlers][${ipcChannels_1.STORE_GET}] Successfully read key: '${key}'`);
                // Conditional logging for development
                if (process.env.NODE_ENV === 'development') {
                    logger_1.logger.debug(`[Storage Handlers][${ipcChannels_1.STORE_GET}] File path for key '${key}': ${filePath}`);
                }
                return data;
            }
            else {
                logger_1.logger.info(`[Storage Handlers][${ipcChannels_1.STORE_GET}] No data found for key: '${key}' (file not found: ${filePath})`);
                return null;
            }
        }
        catch (error) {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_GET}] Error reading key '${key}' from ${filePath}:`, error);
            throw new Error(`Failed to get data for key '${key}'.`);
        }
    });
    electron_1.ipcMain.handle(ipcChannels_1.STORE_SET, async (_event, { key, value }) => {
        if (typeof key !== 'string' || !key.trim()) {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_SET}] Invalid key received: ${key}`);
            throw new Error('Invalid key provided to storeSet.');
        }
        if (typeof value !== 'string') {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_SET}] Invalid value received for key '${key}': not a string`);
            throw new Error('Invalid value (must be string) provided to storeSet.');
        }
        const filePath = getStorageFilePath(key);
        logger_1.logger.debug(`[Storage Handlers][${ipcChannels_1.STORE_SET}] Attempting to write key: '${key}' to file: ${filePath}`);
        try {
            await fs_extra_1.default.ensureDir(path_1.default.dirname(filePath)); // Ensure directory exists
            await fs_extra_1.default.writeFile(filePath, value, 'utf-8');
            logger_1.logger.info(`[Storage Handlers][${ipcChannels_1.STORE_SET}] Successfully wrote key: '${key}'`);
            // Conditional logging for development
            if (process.env.NODE_ENV === 'development') {
                logger_1.logger.debug(`[Storage Handlers][${ipcChannels_1.STORE_SET}] File path for key '${key}': ${filePath}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_SET}] Error writing key '${key}' to ${filePath}:`, error);
            throw new Error(`Failed to set data for key '${key}'.`);
        }
    });
    electron_1.ipcMain.handle(ipcChannels_1.STORE_REMOVE, async (_event, key) => {
        if (typeof key !== 'string' || !key.trim()) {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_REMOVE}] Invalid key received: ${key}`);
            throw new Error('Invalid key provided to storeRemove.');
        }
        const filePath = getStorageFilePath(key);
        logger_1.logger.debug(`[Storage Handlers][${ipcChannels_1.STORE_REMOVE}] Attempting to remove key: '${key}' from file: ${filePath}`);
        try {
            if (await fs_extra_1.default.pathExists(filePath)) {
                await fs_extra_1.default.remove(filePath);
                logger_1.logger.info(`[Storage Handlers][${ipcChannels_1.STORE_REMOVE}] Successfully removed key: '${key}'`);
                // Conditional logging for development
                if (process.env.NODE_ENV === 'development') {
                    logger_1.logger.debug(`[Storage Handlers][${ipcChannels_1.STORE_REMOVE}] File path for key '${key}': ${filePath}`);
                }
            }
            else {
                logger_1.logger.info(`[Storage Handlers][${ipcChannels_1.STORE_REMOVE}] No data found to remove for key: '${key}' (file not found: ${filePath})`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[Storage Handlers][${ipcChannels_1.STORE_REMOVE}] Error removing key '${key}' from ${filePath}:`, error);
            throw new Error(`Failed to remove data for key '${key}'.`);
        }
    });
    logger_1.logger.info('[Storage Handlers] IPC handlers for persistent storage registered.');
}
//# sourceMappingURL=storageHandlers.js.map