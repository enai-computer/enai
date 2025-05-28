import { ipcMain, app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid'; // Make sure to install nanoid: npm install nanoid
import { FILE_SAVE_TEMP } from '../../shared/ipcChannels';
import { SaveTempFilePayload } from '../../shared/types';
import { logger } from '../../utils/logger'; // Assuming logger exists

const TEMP_SUBDIR = 'jeffers_uploads';

export function registerSaveTempFileHandler() {
  ipcMain.handle(FILE_SAVE_TEMP, async (_event, args: SaveTempFilePayload) => {
    const { fileName, data } = args;

    // Basic validation
    if (fileName.trim() === '') {
      logger.error(`[IPC Handler][${FILE_SAVE_TEMP}] Empty filename received.`);
      throw new Error('Filename cannot be empty.');
    }
    if (data.length === 0) {
      logger.warn(`[IPC Handler][${FILE_SAVE_TEMP}] Received empty file data for: ${fileName}`);
      // Decide if empty files are allowed or should throw an error
      // For now, allowing empty files but logging a warning.
    }

    try {
      const ext = path.extname(fileName);
      // Sanitize base name slightly - remove path components just in case
      const baseName = path.basename(fileName, ext);
      const safeBase = `${baseName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${nanoid(8)}`; // More robust sanitization + nanoid
      const safeFilename = `${safeBase}${ext}`;

      const tempDir = path.join(app.getPath('temp'), TEMP_SUBDIR);
      logger.debug(`[IPC Handler][${FILE_SAVE_TEMP}] Ensuring temp directory exists: ${tempDir}`);
      await fs.mkdir(tempDir, { recursive: true });

      const absolutePath = path.join(tempDir, safeFilename);
      logger.info(`[IPC Handler][${FILE_SAVE_TEMP}] Writing ${data.byteLength} bytes to temp file: ${absolutePath}`);

      // Convert Uint8Array from renderer directly to Buffer for fs.writeFile
      await fs.writeFile(absolutePath, data);

      logger.info(`[IPC Handler][${FILE_SAVE_TEMP}] Successfully wrote temp file: ${absolutePath}`);
      return absolutePath;
    } catch (error) {
      logger.error(`[IPC Handler Error][${FILE_SAVE_TEMP}] Failed to save temp file ${fileName}:`, error);
      throw new Error(`Failed to save temporary file. Please try again.`); // User-friendly error
    }
  });

  logger.info(`[IPC Handler] Registered handler for ${FILE_SAVE_TEMP}`);
} 