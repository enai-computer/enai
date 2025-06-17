import { NoteModel } from '../models/NoteModel';
import { Note, NoteType, NoteMetadata } from '../shared/types';
import { logger } from '../utils/logger';
import Database from 'better-sqlite3';
import { BaseService } from './base/BaseService';

interface NoteServiceDeps {
  db: Database.Database;
  noteModel: NoteModel;
}

export class NoteService extends BaseService<NoteServiceDeps> {
  constructor(deps: NoteServiceDeps) {
    super('NoteService', deps);
  }

  /**
   * Creates a new note in a notebook.
   */
  async createNote(
    notebookId: string,
    content: string,
    type: NoteType = 'text',
    metadata?: NoteMetadata
  ): Promise<Note> {
    return this.execute('createNote', async () => {
      const note = this.deps.noteModel.create({
        notebookId,
        content,
        type,
        metadata,
      });
      
      return note;
    });
  }

  /**
   * Gets all notes for a notebook.
   */
  async getNotesForNotebook(notebookId: string): Promise<Note[]> {
    return this.execute('getNotesForNotebook', async () => {
      const notes = this.deps.noteModel.getByNotebookId(notebookId);
      return notes;
    });
  }

  /**
   * Updates a note.
   */
  async updateNote(noteId: string, payload: { content: string }): Promise<Note | null> {
    return this.execute('updateNote', async () => {
      const updated = this.deps.noteModel.update(noteId, payload);
      
      if (!updated) {
        this.logWarn('Note not found for update', { noteId });
      }
      
      return updated;
    });
  }

  /**
   * Deletes a note.
   */
  async deleteNote(noteId: string): Promise<boolean> {
    return this.execute('deleteNote', async () => {
      const deleted = this.deps.noteModel.delete(noteId);
      
      if (!deleted) {
        this.logWarn('Note not found for deletion', { noteId });
      }
      
      return deleted;
    });
  }


  /**
   * Creates an AI-generated note in a notebook.
   */
  async injectAINote(
    notebookId: string,
    content: string,
    metadata?: NoteMetadata
  ): Promise<Note> {
    return this.execute('injectAINote', async () => {
      const aiMetadata: NoteMetadata = {
        ...metadata,
        aiModel: metadata?.aiModel || 'gpt-4o',
      };
      
      const note = await this.createNote(notebookId, content, 'ai_generated', aiMetadata);
      return note;
    });
  }
}