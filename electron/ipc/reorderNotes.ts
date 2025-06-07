import { IpcMain } from 'electron';
import { NOTE_REORDER } from '../../shared/ipcChannels';
import { NoteService } from '../../services/NoteService';
import { ReorderNotesPayload } from '../../shared/types';
import { logger } from '../../utils/logger';

export function registerReorderNotesHandler(
  ipcMain: IpcMain,
  noteService: NoteService
) {
  ipcMain.handle(NOTE_REORDER, async (event, payload: ReorderNotesPayload) => {
    try {
      logger.debug('[ReorderNotesHandler] Called with:', payload);
      
      await noteService.reorderNotes(payload.notebookId, payload.noteIds);
      
      return;
    } catch (error) {
      logger.error('[ReorderNotesHandler] Error:', error);
      throw error;
    }
  });
}