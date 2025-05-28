import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { SET_INTENT, ON_INTENT_RESULT } from '../../shared/ipcChannels';
import { IntentResultPayload } from '../../shared/types';
import { SetIntentPayloadSchema } from '../../shared/schemas/ipcSchemas';
import { validateIpcPayload } from './validatePayload';
import { logger } from '../../utils/logger';
import { IntentService } from '../../services/IntentService'; // Import the actual IntentService

/**
 * Registers the IPC handler for the SET_INTENT channel.
 * This handler is responsible for receiving the user's intent from the renderer process
 * and passing it to the IntentService for processing.
 * @param serviceInstance - The actual instance of IntentService.
 */
export function registerSetIntentHandler(serviceInstance: IntentService) {
  ipcMain.handle(SET_INTENT, async (event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
    const validated = validateIpcPayload(SetIntentPayloadSchema, payload);
    logger.info(`[IPC Handler][${SET_INTENT}] Received intent: "${validated.intentText.substring(0, 100)}..."`);
    
    if (!serviceInstance) {
      logger.error(`[IPC Handler][${SET_INTENT}] IntentService instance is not available.`);
      event.sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Intent processing service not available.' } as IntentResultPayload);
      throw new Error('IntentService not available. Cannot process intent.');
    }

    try {
      await serviceInstance.handleIntent(validated as any, event.sender);
      return;
    } catch (error: any) {
      logger.error(`[IPC Handler][${SET_INTENT}] Error calling IntentService.handleIntent:`, error);
      event.sender.send(ON_INTENT_RESULT, { 
        type: 'error', 
        message: error.message || 'An unexpected error occurred while processing your request.' 
      } as IntentResultPayload);
      throw error; 
    }
  });
} 