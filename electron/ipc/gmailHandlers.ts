import { IpcMain } from 'electron';
import {
  GMAIL_AUTH_URL,
  GMAIL_AUTH_CALLBACK,
  GMAIL_SYNC
} from '../../shared/ipcChannels';
import type { ServiceRegistry } from '../bootstrap/serviceBootstrap';

export function registerGmailHandlers(ipcMain: IpcMain, services: ServiceRegistry) {
  ipcMain.handle(GMAIL_AUTH_URL, async () => {
    return services.gmailAuth?.getAuthUrl();
  });

  ipcMain.handle(GMAIL_AUTH_CALLBACK, async (_event, code: string) => {
    const userId = 'default_user';
    return services.gmailAuth?.handleAuthCallback(code, userId);
  });

  ipcMain.handle(GMAIL_SYNC, async () => {
    const userId = 'default_user';
    return services.ingestionQueue?.addJob('email', 'gmail', {
      jobSpecificData: { userId }
    });
  });
}
