"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSaveTempFileHandler = registerSaveTempFileHandler;
const electron_1 = require("electron");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const nanoid_1 = require("nanoid"); // Make sure to install nanoid: npm install nanoid
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger"); // Assuming logger exists
const TEMP_SUBDIR = 'jeffers_uploads';
function registerSaveTempFileHandler() {
    electron_1.ipcMain.handle(ipcChannels_1.FILE_SAVE_TEMP, async (_event, args) => {
        // Validate input structure
        if (typeof args !== 'object' ||
            args === null ||
            typeof args.fileName !== 'string' ||
            !(args.data instanceof Uint8Array)) {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.FILE_SAVE_TEMP}] Invalid arguments received:`, args);
            throw new Error('Invalid arguments for saving temp file.');
        }
        const { fileName, data } = args;
        // Basic validation
        if (fileName.trim() === '') {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.FILE_SAVE_TEMP}] Empty filename received.`);
            throw new Error('Filename cannot be empty.');
        }
        if (data.length === 0) {
            logger_1.logger.warn(`[IPC Handler][${ipcChannels_1.FILE_SAVE_TEMP}] Received empty file data for: ${fileName}`);
            // Decide if empty files are allowed or should throw an error
            // For now, allowing empty files but logging a warning.
        }
        try {
            const ext = path_1.default.extname(fileName);
            // Sanitize base name slightly - remove path components just in case
            const baseName = path_1.default.basename(fileName, ext);
            const safeBase = `${baseName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${(0, nanoid_1.nanoid)(8)}`; // More robust sanitization + nanoid
            const safeFilename = `${safeBase}${ext}`;
            const tempDir = path_1.default.join(electron_1.app.getPath('temp'), TEMP_SUBDIR);
            logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.FILE_SAVE_TEMP}] Ensuring temp directory exists: ${tempDir}`);
            await fs_1.promises.mkdir(tempDir, { recursive: true });
            const absolutePath = path_1.default.join(tempDir, safeFilename);
            logger_1.logger.info(`[IPC Handler][${ipcChannels_1.FILE_SAVE_TEMP}] Writing ${data.byteLength} bytes to temp file: ${absolutePath}`);
            // Convert Uint8Array from renderer directly to Buffer for fs.writeFile
            await fs_1.promises.writeFile(absolutePath, data);
            logger_1.logger.info(`[IPC Handler][${ipcChannels_1.FILE_SAVE_TEMP}] Successfully wrote temp file: ${absolutePath}`);
            return absolutePath;
        }
        catch (error) {
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.FILE_SAVE_TEMP}] Failed to save temp file ${fileName}:`, error);
            throw new Error(`Failed to save temporary file. Please try again.`); // User-friendly error
        }
    });
    logger_1.logger.info(`[IPC Handler] Registered handler for ${ipcChannels_1.FILE_SAVE_TEMP}`);
}
//# sourceMappingURL=saveTempFile.js.map