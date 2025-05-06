import { ipcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { SET_INTENT, ON_INTENT_RESULT } from '../../shared/ipcChannels';
import { IntentPayload, IntentResultPayload } from '../../shared/types';
import { logger } from '../../utils/logger';
import { IntentService } from '../../services/IntentService'; // Import the actual IntentService

/**
 * Registers the IPC handler for the SET_INTENT channel.
 * This handler is responsible for receiving the user's intent from the renderer process
 * and passing it to the IntentService for processing.
 * @param serviceInstance - The actual instance of IntentService.
 */
export function registerSetIntentHandler(serviceInstance: IntentService) { // Changed parameter type
  ipcMain.handle(SET_INTENT, async (event: IpcMainInvokeEvent, payload: IntentPayload): Promise<void> => {
    logger.info(`[IPC Handler][${SET_INTENT}] Received intent: "${payload.intentText.substring(0, 100)}..."`);
    
    if (!serviceInstance) { // Check the passed instance
      logger.error(`[IPC Handler][${SET_INTENT}] IntentService instance is not available.`);
      event.sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Intent processing service not available.' } as IntentResultPayload);
      throw new Error('IntentService not available. Cannot process intent.');
    }

    try {
      await serviceInstance.handleIntent(payload, event.sender); // Use the passed serviceInstance directly
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