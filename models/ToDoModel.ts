import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { ToDoItem, ToDoStatus } from '../shared/types';

interface ToDoRecord {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  due_date: string | null;
  completed_at: string | null;
  status: string;
  priority: number | null;
  parent_todo_id: string | null;
  project_or_goal_id: string | null;
  related_object_ids_json: string | null;
  updated_at: string;
}

function mapRecordToToDo(record: ToDoRecord): ToDoItem {
  return {
    id: record.id,
    userId: record.user_id,
    title: record.title,
    description: record.description,
    createdAt: record.created_at,
    dueDate: record.due_date || null,
    completedAt: record.completed_at || null,
    status: record.status as ToDoStatus,
    priority: record.priority,
    parentTodoId: record.parent_todo_id,
    projectOrGoalId: record.project_or_goal_id,
    relatedObjectIds: record.related_object_ids_json 
      ? JSON.parse(record.related_object_ids_json) 
      : null,
    updatedAt: record.updated_at,
  };
}

export class ToDoModel {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    logger.info("[ToDoModel] Initialized.");
  }

  /**
   * Create a new to-do item.
   */
  createToDo(
    userId: string,
    title: string,
    description?: string | null,
    dueDate?: string | null,
    priority?: number | null,
    parentTodoId?: string | null,
    projectOrGoalId?: string | null,
    relatedObjectIds?: string[] | null
  ): ToDoItem {
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO user_todos (
          id, user_id, title, description, created_at, due_date,
          status, priority, parent_todo_id, project_or_goal_id,
          related_object_ids_json, updated_at
        ) VALUES (
          $id, $userId, $title, $description, $createdAt, $dueDate,
          $status, $priority, $parentTodoId, $projectOrGoalId,
          $relatedObjectIdsJson, $updatedAt
        )
      `);

      stmt.run({
        id,
        userId,
        title,
        description: description || null,
        createdAt: now,
        dueDate: dueDate || null,
        status: 'pending',
        priority: priority || null,
        parentTodoId: parentTodoId || null,
        projectOrGoalId: projectOrGoalId || null,
        relatedObjectIdsJson: relatedObjectIds 
          ? JSON.stringify(relatedObjectIds) 
          : null,
        updatedAt: now,
      });

      logger.debug("[ToDoModel] Created todo:", { id, userId, title });

      const newTodo = this.getToDoById(id);
      if (!newTodo) {
        throw new Error(`Failed to retrieve created todo: ${id}`);
      }

      return newTodo;
    } catch (error) {
      logger.error("[ToDoModel] Error creating todo:", error);
      throw error;
    }
  }

  /**
   * Get a to-do by ID.
   */
  getToDoById(id: string): ToDoItem | null {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM user_todos WHERE id = $id
      `);

      const record = stmt.get({ id }) as ToDoRecord | undefined;

      if (!record) {
        logger.debug("[ToDoModel] Todo not found:", { id });
        return null;
      }

      return mapRecordToToDo(record);
    } catch (error) {
      logger.error("[ToDoModel] Error getting todo:", error);
      throw error;
    }
  }

  /**
   * Get all to-dos for a user.
   */
  getToDosForUser(
    userId: string,
    status?: ToDoStatus,
    parentTodoId?: string | null
  ): ToDoItem[] {
    try {
      let query = `
        SELECT * FROM user_todos
        WHERE user_id = $userId
      `;

      const params: any = { userId };

      if (status) {
        query += ` AND status = $status`;
        params.status = status;
      }

      if (parentTodoId !== undefined) {
        if (parentTodoId === null) {
          query += ` AND parent_todo_id IS NULL`;
        } else {
          query += ` AND parent_todo_id = $parentTodoId`;
          params.parentTodoId = parentTodoId;
        }
      }

      query += ` ORDER BY 
        CASE WHEN due_date IS NOT NULL THEN 0 ELSE 1 END,
        due_date ASC,
        priority ASC,
        created_at DESC
      `;

      const stmt = this.db.prepare(query);
      const records = stmt.all(params) as ToDoRecord[];

      return records.map(mapRecordToToDo);
    } catch (error) {
      logger.error("[ToDoModel] Error getting todos:", error);
      throw error;
    }
  }

  /**
   * Update a to-do item.
   */
  updateToDo(
    id: string,
    updates: {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      status?: ToDoStatus;
      priority?: number | null;
      parentTodoId?: string | null;
      projectOrGoalId?: string | null;
      relatedObjectIds?: string[] | null;
    }
  ): ToDoItem | null {
    try {
      const updateFields: string[] = [];
      const params: any = {
        id,
        updatedAt: new Date().toISOString(),
      };

      // Build update fields dynamically
      if (updates.title !== undefined) {
        updateFields.push('title = $title');
        params.title = updates.title;
      }

      if (updates.description !== undefined) {
        updateFields.push('description = $description');
        params.description = updates.description;
      }

      if (updates.dueDate !== undefined) {
        updateFields.push('due_date = $dueDate');
        params.dueDate = updates.dueDate;
      }

      if (updates.status !== undefined) {
        updateFields.push('status = $status');
        params.status = updates.status;

        // If marking as completed, set completed_at
        if (updates.status === 'completed') {
          updateFields.push('completed_at = $completedAt');
          params.completedAt = new Date().toISOString();
        } else {
          updateFields.push('completed_at = NULL');
        }
      }

      if (updates.priority !== undefined) {
        updateFields.push('priority = $priority');
        params.priority = updates.priority;
      }

      if (updates.parentTodoId !== undefined) {
        updateFields.push('parent_todo_id = $parentTodoId');
        params.parentTodoId = updates.parentTodoId;
      }

      if (updates.projectOrGoalId !== undefined) {
        updateFields.push('project_or_goal_id = $projectOrGoalId');
        params.projectOrGoalId = updates.projectOrGoalId;
      }

      if (updates.relatedObjectIds !== undefined) {
        updateFields.push('related_object_ids_json = $relatedObjectIdsJson');
        params.relatedObjectIdsJson = updates.relatedObjectIds 
          ? JSON.stringify(updates.relatedObjectIds) 
          : null;
      }

      // Always update the timestamp
      updateFields.push('updated_at = $updatedAt');

      if (updateFields.length === 1) {
        // Only timestamp update, return existing
        return this.getToDoById(id);
      }

      const updateQuery = `
        UPDATE user_todos 
        SET ${updateFields.join(', ')}
        WHERE id = $id
      `;

      const stmt = this.db.prepare(updateQuery);
      const result = stmt.run(params);

      if (result.changes === 0) {
        logger.debug("[ToDoModel] Todo not found for update:", { id });
        return null;
      }

      logger.debug("[ToDoModel] Todo updated:", { id, updates });

      return this.getToDoById(id);
    } catch (error) {
      logger.error("[ToDoModel] Error updating todo:", error);
      throw error;
    }
  }

  /**
   * Delete a to-do item.
   */
  deleteToDo(id: string): boolean {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM user_todos WHERE id = $id
      `);

      const result = stmt.run({ id });

      logger.info("[ToDoModel] Todo deleted:", {
        id,
        deleted: result.changes > 0,
      });

      return result.changes > 0;
    } catch (error) {
      logger.error("[ToDoModel] Error deleting todo:", error);
      throw error;
    }
  }

  /**
   * Get to-dos due within a specific time range.
   */
  getToDosDueBetween(
    userId: string,
    startTime: string,
    endTime: string
  ): ToDoItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM user_todos
        WHERE user_id = $userId
          AND due_date IS NOT NULL
          AND due_date >= $startTime
          AND due_date <= $endTime
          AND status != 'completed'
          AND status != 'archived'
        ORDER BY due_date ASC, priority ASC
      `);

      const records = stmt.all({
        userId,
        startTime,
        endTime,
      }) as ToDoRecord[];

      return records.map(mapRecordToToDo);
    } catch (error) {
      logger.error("[ToDoModel] Error getting todos by due date:", error);
      throw error;
    }
  }

  /**
   * Get overdue to-dos.
   */
  getOverdueToDos(userId: string): ToDoItem[] {
    const now = new Date().toISOString();
    
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM user_todos
        WHERE user_id = $userId
          AND due_date IS NOT NULL
          AND due_date < $now
          AND status != 'completed'
          AND status != 'archived'
        ORDER BY due_date ASC, priority ASC
      `);

      const records = stmt.all({ userId, now }) as ToDoRecord[];

      return records.map(mapRecordToToDo);
    } catch (error) {
      logger.error("[ToDoModel] Error getting overdue todos:", error);
      throw error;
    }
  }

  /**
   * Get to-dos related to a specific goal.
   */
  getToDosForGoal(userId: string, goalId: string): ToDoItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM user_todos
        WHERE user_id = $userId
          AND project_or_goal_id = $goalId
        ORDER BY 
          CASE status 
            WHEN 'in_progress' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'completed' THEN 2
            ELSE 3
          END,
          priority ASC,
          due_date ASC
      `);

      const records = stmt.all({ userId, goalId }) as ToDoRecord[];

      return records.map(mapRecordToToDo);
    } catch (error) {
      logger.error("[ToDoModel] Error getting todos for goal:", error);
      throw error;
    }
  }

  /**
   * Get subtasks for a parent to-do.
   */
  getSubtasks(parentTodoId: string): ToDoItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM user_todos
        WHERE parent_todo_id = $parentTodoId
        ORDER BY priority ASC, created_at ASC
      `);

      const records = stmt.all({ parentTodoId }) as ToDoRecord[];

      return records.map(mapRecordToToDo);
    } catch (error) {
      logger.error("[ToDoModel] Error getting subtasks:", error);
      throw error;
    }
  }

  /**
   * Count todos for a user, optionally filtered by status.
   */
  countToDos(userId: string, status?: ToDoStatus): number {
    try {
      let query = `
        SELECT COUNT(*) as count FROM user_todos
        WHERE user_id = $userId
      `;

      const params: any = { userId };

      if (status) {
        query += ` AND status = $status`;
        params.status = status;
      }

      const stmt = this.db.prepare(query);
      const result = stmt.get(params) as { count: number };

      logger.debug("[ToDoModel] Counted todos:", { userId, status, count: result.count });

      return result.count;
    } catch (error) {
      logger.error("[ToDoModel] Error counting todos:", error);
      throw error;
    }
  }
}