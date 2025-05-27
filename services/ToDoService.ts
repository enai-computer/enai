import { ToDoModel } from '../models/ToDoModel';
import { ToDoItem, ToDoCreatePayload, ToDoUpdatePayload, ToDoStatus } from '../shared/types';
import { getActivityLogService } from './ActivityLogService';
import { logger } from '../utils/logger';
import { getDb } from '../models/db';

export class ToDoService {
  private toDoModel: ToDoModel;

  constructor(toDoModel?: ToDoModel) {
    const db = getDb();
    this.toDoModel = toDoModel || new ToDoModel(db);
    logger.info("[ToDoService] Initialized.");
  }

  /**
   * Create a new to-do item.
   */
  async createToDo(
    userId: string = 'default_user',
    payload: ToDoCreatePayload
  ): Promise<ToDoItem> {
    try {
      logger.debug("[ToDoService] Creating todo:", { userId, payload });

      const todo = this.toDoModel.createToDo(
        userId,
        payload.title,
        payload.description,
        payload.dueDate,
        payload.priority,
        payload.parentTodoId,
        payload.projectOrGoalId,
        payload.relatedObjectIds
      );

      // Log activity
      await getActivityLogService().logActivity({
        activityType: 'todo_created',
        details: {
          todoId: todo.id,
          title: todo.title,
          dueDate: todo.dueDate,
          priority: todo.priority,
          projectOrGoalId: todo.projectOrGoalId,
          parentTodoId: todo.parentTodoId,
        },
        userId,
      });

      logger.info("[ToDoService] Todo created:", { id: todo.id, title: todo.title });

      return todo;
    } catch (error) {
      logger.error("[ToDoService] Error creating todo:", error);
      throw error;
    }
  }

  /**
   * Get all to-dos for a user.
   */
  async getToDos(
    userId: string = 'default_user',
    status?: ToDoStatus,
    parentTodoId?: string | null
  ): Promise<ToDoItem[]> {
    try {
      logger.debug("[ToDoService] Getting todos:", { userId, status, parentTodoId });

      return this.toDoModel.getToDosForUser(userId, status, parentTodoId);
    } catch (error) {
      logger.error("[ToDoService] Error getting todos:", error);
      throw error;
    }
  }

  /**
   * Get a specific to-do by ID.
   */
  async getToDoById(id: string): Promise<ToDoItem | null> {
    try {
      logger.debug("[ToDoService] Getting todo by ID:", { id });

      return this.toDoModel.getToDoById(id);
    } catch (error) {
      logger.error("[ToDoService] Error getting todo:", error);
      throw error;
    }
  }

  /**
   * Update a to-do item.
   */
  async updateToDo(
    id: string,
    payload: ToDoUpdatePayload,
    userId: string = 'default_user'
  ): Promise<ToDoItem | null> {
    try {
      logger.debug("[ToDoService] Updating todo:", { id, payload });

      const existingTodo = this.toDoModel.getToDoById(id);
      if (!existingTodo) {
        logger.warn("[ToDoService] Todo not found for update:", { id });
        return null;
      }

      const updatedTodo = this.toDoModel.updateToDo(id, payload);

      if (updatedTodo) {
        // Log activity
        const activityDetails: Record<string, any> = {
          todoId: id,
          title: updatedTodo.title,
          changes: {},
        };

        // Track what changed
        if (payload.status && payload.status !== existingTodo.status) {
          activityDetails.changes.status = {
            from: existingTodo.status,
            to: payload.status,
          };

          // Log completion separately
          if (payload.status === 'completed') {
            await getActivityLogService().logActivity({
              activityType: 'todo_completed',
              details: {
                todoId: id,
                title: updatedTodo.title,
                projectOrGoalId: updatedTodo.projectOrGoalId,
              },
              userId,
            });
          }
        }

        if (payload.dueDate !== undefined && payload.dueDate !== existingTodo.dueDate?.getTime()) {
          activityDetails.changes.dueDate = {
            from: existingTodo.dueDate,
            to: payload.dueDate ? new Date(payload.dueDate) : null,
          };
        }

        if (payload.priority !== undefined && payload.priority !== existingTodo.priority) {
          activityDetails.changes.priority = {
            from: existingTodo.priority,
            to: payload.priority,
          };
        }

        // Log general update activity
        if (Object.keys(activityDetails.changes).length > 0) {
          await getActivityLogService().logActivity({
            activityType: 'todo_updated',
            details: activityDetails,
            userId,
          });
        }

        logger.info("[ToDoService] Todo updated:", { id, changes: activityDetails.changes });
      }

      return updatedTodo;
    } catch (error) {
      logger.error("[ToDoService] Error updating todo:", error);
      throw error;
    }
  }

  /**
   * Delete a to-do item.
   */
  async deleteToDo(id: string, userId: string = 'default_user'): Promise<boolean> {
    try {
      logger.debug("[ToDoService] Deleting todo:", { id });

      const todo = this.toDoModel.getToDoById(id);
      if (!todo) {
        logger.warn("[ToDoService] Todo not found for deletion:", { id });
        return false;
      }

      const deleted = this.toDoModel.deleteToDo(id);

      if (deleted) {
        // Log activity
        await getActivityLogService().logActivity({
          activityType: 'todo_updated',
          details: {
            todoId: id,
            title: todo.title,
            action: 'deleted',
          },
          userId,
        });

        logger.info("[ToDoService] Todo deleted:", { id });
      }

      return deleted;
    } catch (error) {
      logger.error("[ToDoService] Error deleting todo:", error);
      throw error;
    }
  }

  /**
   * Get to-dos due today.
   */
  async getToDosDueToday(userId: string = 'default_user'): Promise<ToDoItem[]> {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

      return this.toDoModel.getToDosDueBetween(userId, startOfDay, endOfDay);
    } catch (error) {
      logger.error("[ToDoService] Error getting todos due today:", error);
      throw error;
    }
  }

  /**
   * Get to-dos due this week.
   */
  async getToDosDueThisWeek(userId: string = 'default_user'): Promise<ToDoItem[]> {
    try {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      endOfWeek.setMilliseconds(-1);

      return this.toDoModel.getToDosDueBetween(
        userId,
        startOfWeek.getTime(),
        endOfWeek.getTime()
      );
    } catch (error) {
      logger.error("[ToDoService] Error getting todos due this week:", error);
      throw error;
    }
  }

  /**
   * Get overdue to-dos.
   */
  async getOverdueToDos(userId: string = 'default_user'): Promise<ToDoItem[]> {
    try {
      return this.toDoModel.getOverdueToDos(userId);
    } catch (error) {
      logger.error("[ToDoService] Error getting overdue todos:", error);
      throw error;
    }
  }

  /**
   * Get to-dos for a specific goal.
   */
  async getToDosForGoal(
    userId: string = 'default_user',
    goalId: string
  ): Promise<ToDoItem[]> {
    try {
      return this.toDoModel.getToDosForGoal(userId, goalId);
    } catch (error) {
      logger.error("[ToDoService] Error getting todos for goal:", error);
      throw error;
    }
  }

  /**
   * Get subtasks for a parent to-do.
   */
  async getSubtasks(parentTodoId: string): Promise<ToDoItem[]> {
    try {
      return this.toDoModel.getSubtasks(parentTodoId);
    } catch (error) {
      logger.error("[ToDoService] Error getting subtasks:", error);
      throw error;
    }
  }

  /**
   * Complete a to-do and all its subtasks.
   */
  async completeTodoWithSubtasks(
    id: string,
    userId: string = 'default_user'
  ): Promise<ToDoItem | null> {
    try {
      // Complete the main todo
      const mainTodo = await this.updateToDo(id, { status: 'completed' }, userId);
      
      if (!mainTodo) {
        return null;
      }

      // Complete all subtasks
      const subtasks = await this.getSubtasks(id);
      for (const subtask of subtasks) {
        if (subtask.status !== 'completed') {
          await this.updateToDo(subtask.id, { status: 'completed' }, userId);
        }
      }

      logger.info("[ToDoService] Completed todo with subtasks:", { 
        id, 
        subtaskCount: subtasks.length 
      });

      return mainTodo;
    } catch (error) {
      logger.error("[ToDoService] Error completing todo with subtasks:", error);
      throw error;
    }
  }

  /**
   * Get to-do statistics for a user.
   */
  async getToDoStats(userId: string = 'default_user'): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
  }> {
    try {
      const allTodos = await this.getToDos(userId);
      const overdueTodos = await this.getOverdueToDos(userId);
      const todayTodos = await this.getToDosDueToday(userId);
      const weekTodos = await this.getToDosDueThisWeek(userId);

      const stats = {
        total: allTodos.length,
        pending: allTodos.filter(t => t.status === 'pending').length,
        inProgress: allTodos.filter(t => t.status === 'in_progress').length,
        completed: allTodos.filter(t => t.status === 'completed').length,
        overdue: overdueTodos.length,
        dueToday: todayTodos.length,
        dueThisWeek: weekTodos.length,
      };

      logger.debug("[ToDoService] Todo stats:", { userId, stats });

      return stats;
    } catch (error) {
      logger.error("[ToDoService] Error getting todo stats:", error);
      throw error;
    }
  }
}

// Export a singleton instance with lazy initialization
let _toDoService: ToDoService | null = null;

export function getToDoService(): ToDoService {
  if (!_toDoService) {
    _toDoService = new ToDoService();
  }
  return _toDoService;
}

// For backward compatibility
export const toDoService = {
  get(): ToDoService {
    return getToDoService();
  }
};