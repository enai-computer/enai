import { IpcMain } from 'electron';
import {
  TODO_CREATE,
  TODO_GET_ALL,
  TODO_GET_BY_ID,
  TODO_UPDATE,
  TODO_DELETE,
} from '../../shared/ipcChannels';
import { ToDoService } from '../../services/ToDoService';
import { ToDoCreatePayload, ToDoUpdatePayload } from '../../shared/types';
import { logger } from '../../utils/logger';

/**
 * Register handler for creating a to-do.
 */
export function registerCreateToDoHandler(ipcMain: IpcMain, toDoService: ToDoService) {
  ipcMain.handle(TODO_CREATE, async (_event, payload: ToDoCreatePayload) => {
    try {
      logger.debug("[ToDoHandler] Creating todo:", payload);
      const todo = await toDoService.createToDo('default_user', payload);
      return todo;
    } catch (error) {
      logger.error("[ToDoHandler] Error creating todo:", error);
      throw new Error('Failed to create todo.');
    }
  });
}

/**
 * Register handler for getting all to-dos.
 */
export function registerGetAllToDosHandler(ipcMain: IpcMain, toDoService: ToDoService) {
  ipcMain.handle(TODO_GET_ALL, async (_event, userId?: string) => {
    try {
      logger.debug("[ToDoHandler] Getting all todos for user:", userId);
      const todos = await toDoService.getToDos(userId || 'default_user');
      return todos;
    } catch (error) {
      logger.error("[ToDoHandler] Error getting todos:", error);
      throw new Error('Failed to get todos.');
    }
  });
}

/**
 * Register handler for getting a to-do by ID.
 */
export function registerGetToDoByIdHandler(ipcMain: IpcMain, toDoService: ToDoService) {
  ipcMain.handle(TODO_GET_BY_ID, async (_event, id: string) => {
    try {
      logger.debug("[ToDoHandler] Getting todo by ID:", id);
      const todo = await toDoService.getToDoById(id);
      return todo;
    } catch (error) {
      logger.error("[ToDoHandler] Error getting todo:", error);
      throw new Error('Failed to get todo.');
    }
  });
}

/**
 * Register handler for updating a to-do.
 */
export function registerUpdateToDoHandler(ipcMain: IpcMain, toDoService: ToDoService) {
  ipcMain.handle(
    TODO_UPDATE,
    async (_event, { id, payload }: { id: string; payload: ToDoUpdatePayload }) => {
      try {
        logger.debug("[ToDoHandler] Updating todo:", { id, payload });
        const updatedTodo = await toDoService.updateToDo(id, payload);
        return updatedTodo;
      } catch (error) {
        logger.error("[ToDoHandler] Error updating todo:", error);
        throw new Error('Failed to update todo.');
      }
    }
  );
}

/**
 * Register handler for deleting a to-do.
 */
export function registerDeleteToDoHandler(ipcMain: IpcMain, toDoService: ToDoService) {
  ipcMain.handle(TODO_DELETE, async (_event, id: string) => {
    try {
      logger.debug("[ToDoHandler] Deleting todo:", id);
      const deleted = await toDoService.deleteToDo(id);
      return deleted;
    } catch (error) {
      logger.error("[ToDoHandler] Error deleting todo:", error);
      throw new Error('Failed to delete todo.');
    }
  });
}

/**
 * Register all to-do related IPC handlers.
 */
export function registerToDoHandlers(ipcMain: IpcMain, toDoService: ToDoService) {
  registerCreateToDoHandler(ipcMain, toDoService);
  registerGetAllToDosHandler(ipcMain, toDoService);
  registerGetToDoByIdHandler(ipcMain, toDoService);
  registerUpdateToDoHandler(ipcMain, toDoService);
  registerDeleteToDoHandler(ipcMain, toDoService);
  logger.info("[ToDoHandler] All to-do handlers registered.");
}