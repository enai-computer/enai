import { IpcMain } from 'electron';
import {
  GMAIL_AUTH_URL,
  GMAIL_AUTH_CALLBACK,
  GMAIL_SYNC
} from '../../shared/ipcChannels';
import { GmailAuthService } from '../../services/GmailAuthService';
import { IngestionQueueService } from '../../services/ingestion/IngestionQueueService';
import { logger } from '../../utils/logger';

export function registerGmailHandlers(
  ipcMain: IpcMain,
  gmailAuthService: GmailAuthService,
  ingestionQueueService: IngestionQueueService
) {
  ipcMain.handle(GMAIL_AUTH_URL, async () => {
    return gmailAuthService.getAuthUrl();
  });

  ipcMain.handle(GMAIL_AUTH_CALLBACK, async (_event, code: string) => {
    const userId = 'default_user';
    await gmailAuthService.handleAuthCallback(code, userId);
  });

  ipcMain.handle(GMAIL_SYNC, async () => {
    const userId = 'default_user';
    await ingestionQueueService.addJob('email', 'gmail', {
      jobSpecificData: { userId }
    });
    logger.info('[GmailHandler] Gmail sync job queued');
  });
}
