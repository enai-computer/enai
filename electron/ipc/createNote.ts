import { IpcMain } from 'electron';
import { NOTE_CREATE } from '../../shared/ipcChannels';
import { NoteService } from '../../services/NoteService';
import { CreateNotePayload } from '../../shared/types';
import { logger } from '../../utils/logger';

export function registerCreateNoteHandler(
  ipcMain: IpcMain,
  noteService: NoteService
) {
  ipcMain.handle(NOTE_CREATE, async (event, payload: CreateNotePayload) => {
    try {
      logger.debug('[CreateNoteHandler] Called with:', payload);
      
      const note = await noteService.createNote(
        payload.notebookId,
        payload.content,
        payload.type || 'text',
        payload.metadata
      );
      
      return note;
    } catch (error) {
      logger.error('[CreateNoteHandler] Error:', error);
      throw error;
    }
  });
}