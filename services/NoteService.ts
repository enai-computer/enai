import { NoteModel } from '../models/NoteModel';
import { Note, NoteType, NoteMetadata } from '../shared/types';
import { logger } from '../utils/logger';
import Database from 'better-sqlite3';

export class NoteService {
  private readonly noteModel: NoteModel;
  private readonly db: Database.Database;

  constructor(noteModel: NoteModel, db: Database.Database) {
    this.noteModel = noteModel;
    this.db = db;
    logger.info('[NoteService] Initialized');
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
    logger.debug('[NoteService] Creating note', { notebookId, type });
    
    try {
      const note = this.noteModel.create({
        notebookId,
        content,
        type,
        metadata,
      });
      
      logger.info('[NoteService] Created note', { noteId: note.id, notebookId });
      return note;
    } catch (error) {
      logger.error('[NoteService] Failed to create note:', error);
      throw error;
    }
  }

  /**
   * Gets all notes for a notebook.
   */
  async getNotesForNotebook(notebookId: string): Promise<Note[]> {
    logger.debug('[NoteService] Getting notes for notebook', { notebookId });
    
    try {
      const notes = this.noteModel.getByNotebookId(notebookId);
      logger.debug('[NoteService] Retrieved notes', { notebookId, count: notes.length });
      return notes;
    } catch (error) {
      logger.error('[NoteService] Failed to get notes:', error);
      throw error;
    }
  }

  /**
   * Updates a note.
   */
  async updateNote(noteId: string, payload: { content: string }): Promise<Note | null> {
    logger.debug('[NoteService] Updating note', { noteId });
    
    try {
      const updated = this.noteModel.update(noteId, payload);
      
      if (updated) {
        logger.info('[NoteService] Updated note', { noteId });
      } else {
        logger.warn('[NoteService] Note not found for update', { noteId });
      }
      
      return updated;
    } catch (error) {
      logger.error('[NoteService] Failed to update note:', error);
      throw error;
    }
  }

  /**
   * Deletes a note.
   */
  async deleteNote(noteId: string): Promise<boolean> {
    logger.debug('[NoteService] Deleting note', { noteId });
    
    try {
      const deleted = this.noteModel.delete(noteId);
      
      if (deleted) {
        logger.info('[NoteService] Deleted note', { noteId });
      } else {
        logger.warn('[NoteService] Note not found for deletion', { noteId });
      }
      
      return deleted;
    } catch (error) {
      logger.error('[NoteService] Failed to delete note:', error);
      throw error;
    }
  }


  /**
   * Creates an AI-generated note in a notebook.
   */
  async injectAINote(
    notebookId: string,
    content: string,
    metadata?: NoteMetadata
  ): Promise<Note> {
    logger.debug('[NoteService] Injecting AI note', { notebookId });
    
    const aiMetadata: NoteMetadata = {
      ...metadata,
      aiModel: metadata?.aiModel || 'gpt-4o',
    };
    
    try {
      const note = await this.createNote(notebookId, content, 'ai_generated', aiMetadata);
      logger.info('[NoteService] Injected AI note', { noteId: note.id, notebookId });
      return note;
    } catch (error) {
      logger.error('[NoteService] Failed to inject AI note:', error);
      throw error;
    }
  }
}