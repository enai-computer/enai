import { IpcMain } from 'electron';
import {
  GMAIL_AUTH_URL,
  GMAIL_AUTH_CALLBACK,
  GMAIL_SYNC
} from '../../shared/ipcChannels';
import { ServiceRegistry } from '../bootstrap/serviceBootstrap';

export function registerGmailHandlers(ipcMain: IpcMain, services: ServiceRegistry) {
  ipcMain.handle(GMAIL_AUTH_URL, () => {
    return services.gmailAuth?.getAuthUrl();
  });

  ipcMain.handle(GMAIL_AUTH_CALLBACK, async (_e, code: string, userId: string) => {
    if (!services.gmailAuth) return;
    await services.gmailAuth.handleAuthCallback(code, userId);
  });

  ipcMain.handle(GMAIL_SYNC, async (_e, userId: string) => {
    return services.ingestionQueue?.addJob('email', 'gmail', {
      jobSpecificData: { userId, syncType: 'recent' }
    });
  });
}

