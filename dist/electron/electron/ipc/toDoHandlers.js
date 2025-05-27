"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCreateToDoHandler = registerCreateToDoHandler;
exports.registerGetAllToDosHandler = registerGetAllToDosHandler;
exports.registerGetToDoByIdHandler = registerGetToDoByIdHandler;
exports.registerUpdateToDoHandler = registerUpdateToDoHandler;
exports.registerDeleteToDoHandler = registerDeleteToDoHandler;
exports.registerToDoHandlers = registerToDoHandlers;
const ipcChannels_1 = require("../../shared/ipcChannels");
const ToDoService_1 = require("../../services/ToDoService");
const logger_1 = require("../../utils/logger");
/**
 * Register handler for creating a to-do.
 */
function registerCreateToDoHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.TODO_CREATE, async (_event, payload) => {
        try {
            logger_1.logger.debug("[ToDoHandler] Creating todo:", payload);
            const todo = await (0, ToDoService_1.getToDoService)().createToDo('default_user', payload);
            return todo;
        }
        catch (error) {
            logger_1.logger.error("[ToDoHandler] Error creating todo:", error);
            throw new Error('Failed to create todo.');
        }
    });
}
/**
 * Register handler for getting all to-dos.
 */
function registerGetAllToDosHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.TODO_GET_ALL, async (_event, userId) => {
        try {
            logger_1.logger.debug("[ToDoHandler] Getting all todos for user:", userId);
            const todos = await (0, ToDoService_1.getToDoService)().getToDos(userId || 'default_user');
            return todos;
        }
        catch (error) {
            logger_1.logger.error("[ToDoHandler] Error getting todos:", error);
            throw new Error('Failed to get todos.');
        }
    });
}
/**
 * Register handler for getting a to-do by ID.
 */
function registerGetToDoByIdHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.TODO_GET_BY_ID, async (_event, id) => {
        try {
            logger_1.logger.debug("[ToDoHandler] Getting todo by ID:", id);
            const todo = await (0, ToDoService_1.getToDoService)().getToDoById(id);
            return todo;
        }
        catch (error) {
            logger_1.logger.error("[ToDoHandler] Error getting todo:", error);
            throw new Error('Failed to get todo.');
        }
    });
}
/**
 * Register handler for updating a to-do.
 */
function registerUpdateToDoHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.TODO_UPDATE, async (_event, { id, payload }) => {
        try {
            logger_1.logger.debug("[ToDoHandler] Updating todo:", { id, payload });
            const updatedTodo = await (0, ToDoService_1.getToDoService)().updateToDo(id, payload);
            return updatedTodo;
        }
        catch (error) {
            logger_1.logger.error("[ToDoHandler] Error updating todo:", error);
            throw new Error('Failed to update todo.');
        }
    });
}
/**
 * Register handler for deleting a to-do.
 */
function registerDeleteToDoHandler(ipcMain) {
    ipcMain.handle(ipcChannels_1.TODO_DELETE, async (_event, id) => {
        try {
            logger_1.logger.debug("[ToDoHandler] Deleting todo:", id);
            const deleted = await (0, ToDoService_1.getToDoService)().deleteToDo(id);
            return deleted;
        }
        catch (error) {
            logger_1.logger.error("[ToDoHandler] Error deleting todo:", error);
            throw new Error('Failed to delete todo.');
        }
    });
}
/**
 * Register all to-do related IPC handlers.
 */
function registerToDoHandlers(ipcMain) {
    registerCreateToDoHandler(ipcMain);
    registerGetAllToDosHandler(ipcMain);
    registerGetToDoByIdHandler(ipcMain);
    registerUpdateToDoHandler(ipcMain);
    registerDeleteToDoHandler(ipcMain);
    logger_1.logger.info("[ToDoHandler] All to-do handlers registered.");
}
//# sourceMappingURL=toDoHandlers.js.map