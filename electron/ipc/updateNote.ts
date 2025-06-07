import { IpcMain } from 'electron';
import { NOTE_UPDATE } from '../../shared/ipcChannels';
import { NoteService } from '../../services/NoteService';
import { UpdateNotePayload } from '../../shared/types';
import { logger } from '../../utils/logger';

export function registerUpdateNoteHandler(
  ipcMain: IpcMain,
  noteService: NoteService
) {
  ipcMain.handle(NOTE_UPDATE, async (event, noteId: string, payload: UpdateNotePayload) => {
    try {
      logger.debug('[UpdateNoteHandler] Called with:', { noteId, payload });
      
      const updatedNote = await noteService.updateNote(noteId, payload);
      
      return updatedNote;
    } catch (error) {
      logger.error('[UpdateNoteHandler] Error:', error);
      throw error;
    }
  });
}