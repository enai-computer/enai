import { IpcMain } from 'electron';
import { NOTE_DELETE } from '../../shared/ipcChannels';
import { NoteService } from '../../services/NoteService';
import { logger } from '../../utils/logger';

export function registerDeleteNoteHandler(
  ipcMain: IpcMain,
  noteService: NoteService
) {
  ipcMain.handle(NOTE_DELETE, async (event, noteId: string) => {
    try {
      logger.debug('[DeleteNoteHandler] Called with:', { noteId });
      
      const deleted = await noteService.deleteNote(noteId);
      
      return deleted;
    } catch (error) {
      logger.error('[DeleteNoteHandler] Error:', error);
      throw error;
    }
  });
}