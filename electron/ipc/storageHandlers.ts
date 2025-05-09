import { ipcMain, app } from 'electron';
import fs from 'fs-extra'; // Using fs-extra for convenient file operations like ensureDirSync
import path from 'path';
import { STORE_GET, STORE_SET, STORE_REMOVE } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

const STORAGE_SUBDIR = 'notebook_layouts';

function getStorageFilePath(key: string): string {
    // Basic sanitization for the key to prevent directory traversal or invalid filenames
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!sanitizedKey) {
        throw new Error('Invalid storage key provided after sanitization.');
    }
    const userDataPath = app.getPath('userData');
    const storageDir = path.join(userDataPath, STORAGE_SUBDIR);
    // Conditional logging for development
    if (process.env.NODE_ENV === 'development') {
        logger.debug(`[Storage Handlers] Storage directory for layouts: ${storageDir}`);
    }
    return path.join(storageDir, `${sanitizedKey}.json`);
}

export function registerStorageHandlers(): void {
    logger.info('[Storage Handlers] Registering IPC handlers for persistent storage...');

    ipcMain.handle(STORE_GET, async (_event, key: string): Promise<string | null> => {
        if (typeof key !== 'string' || !key.trim()) {
            logger.error(`[Storage Handlers][${STORE_GET}] Invalid key received: ${key}`);
            throw new Error('Invalid key provided to storeGet.');
        }
        const filePath = getStorageFilePath(key);
        logger.debug(`[Storage Handlers][${STORE_GET}] Attempting to read key: '${key}' from file: ${filePath}`);
        try {
            if (await fs.pathExists(filePath)) {
                const data = await fs.readFile(filePath, 'utf-8');
                logger.info(`[Storage Handlers][${STORE_GET}] Successfully read key: '${key}'`);
                // Conditional logging for development
                if (process.env.NODE_ENV === 'development') {
                    logger.debug(`[Storage Handlers][${STORE_GET}] File path for key '${key}': ${filePath}`);
                }
                return data;
            } else {
                logger.info(`[Storage Handlers][${STORE_GET}] No data found for key: '${key}' (file not found: ${filePath})`);
                return null;
            }
        } catch (error) {
            logger.error(`[Storage Handlers][${STORE_GET}] Error reading key '${key}' from ${filePath}:`, error);
            throw new Error(`Failed to get data for key '${key}'.`);
        }
    });

    ipcMain.handle(STORE_SET, async (_event, { key, value }: { key: string; value: string }): Promise<void> => {
        if (typeof key !== 'string' || !key.trim()) {
            logger.error(`[Storage Handlers][${STORE_SET}] Invalid key received: ${key}`);
            throw new Error('Invalid key provided to storeSet.');
        }
        if (typeof value !== 'string') {
            logger.error(`[Storage Handlers][${STORE_SET}] Invalid value received for key '${key}': not a string`);
            throw new Error('Invalid value (must be string) provided to storeSet.');
        }

        const filePath = getStorageFilePath(key);
        logger.debug(`[Storage Handlers][${STORE_SET}] Attempting to write key: '${key}' to file: ${filePath}`);
        try {
            await fs.ensureDir(path.dirname(filePath)); // Ensure directory exists
            await fs.writeFile(filePath, value, 'utf-8');
            logger.info(`[Storage Handlers][${STORE_SET}] Successfully wrote key: '${key}'`);
            // Conditional logging for development
            if (process.env.NODE_ENV === 'development') {
                logger.debug(`[Storage Handlers][${STORE_SET}] File path for key '${key}': ${filePath}`);
            }
        } catch (error) {
            logger.error(`[Storage Handlers][${STORE_SET}] Error writing key '${key}' to ${filePath}:`, error);
            throw new Error(`Failed to set data for key '${key}'.`);
        }
    });

    ipcMain.handle(STORE_REMOVE, async (_event, key: string): Promise<void> => {
        if (typeof key !== 'string' || !key.trim()) {
            logger.error(`[Storage Handlers][${STORE_REMOVE}] Invalid key received: ${key}`);
            throw new Error('Invalid key provided to storeRemove.');
        }
        const filePath = getStorageFilePath(key);
        logger.debug(`[Storage Handlers][${STORE_REMOVE}] Attempting to remove key: '${key}' from file: ${filePath}`);
        try {
            if (await fs.pathExists(filePath)) {
                await fs.remove(filePath);
                logger.info(`[Storage Handlers][${STORE_REMOVE}] Successfully removed key: '${key}'`);
                // Conditional logging for development
                if (process.env.NODE_ENV === 'development') {
                    logger.debug(`[Storage Handlers][${STORE_REMOVE}] File path for key '${key}': ${filePath}`);
                }
            } else {
                logger.info(`[Storage Handlers][${STORE_REMOVE}] No data found to remove for key: '${key}' (file not found: ${filePath})`);
            }
        } catch (error) {
            logger.error(`[Storage Handlers][${STORE_REMOVE}] Error removing key '${key}' from ${filePath}:`, error);
            throw new Error(`Failed to remove data for key '${key}'.`);
        }
    });

    logger.info('[Storage Handlers] IPC handlers for persistent storage registered.');
} 