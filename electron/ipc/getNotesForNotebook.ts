import { IpcMain } from 'electron';
import { NOTE_GET_FOR_NOTEBOOK } from '../../shared/ipcChannels';
import { NoteService } from '../../services/NoteService';
import { logger } from '../../utils/logger';

export function registerGetNotesForNotebookHandler(
  ipcMain: IpcMain,
  noteService: NoteService
) {
  ipcMain.handle(NOTE_GET_FOR_NOTEBOOK, async (event, notebookId: string) => {
    try {
      logger.debug('[GetNotesForNotebookHandler] Called with:', { notebookId });
      
      const notes = await noteService.getNotesForNotebook(notebookId);
      
      return notes;
    } catch (error) {
      logger.error('[GetNotesForNotebookHandler] Error:', error);
      throw error;
    }
  });
}