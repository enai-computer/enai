import { IpcMain } from 'electron';
import { ServiceRegistry } from '../bootstrap/serviceBootstrap';
import {
  GMAIL_AUTH_URL,
  GMAIL_AUTH_CALLBACK,
  GMAIL_SYNC
} from '../../shared/ipcChannels';

export function registerGmailHandlers(
  ipcMain: IpcMain,
  services: ServiceRegistry
) {
  ipcMain.handle(GMAIL_AUTH_URL, () => {
    return services.gmailAuth?.getAuthUrl();
  });

  ipcMain.handle(GMAIL_AUTH_CALLBACK, async (_event, code: string, userId: string) => {
    if (!services.gmailAuth) return;
    await services.gmailAuth.handleAuthCallback(code, userId);
  });

  ipcMain.handle(GMAIL_SYNC, async (_event, userId: string) => {
    return services.ingestionQueue?.addJob('email', 'gmail', {
      jobSpecificData: { userId }
    });
  });
}
