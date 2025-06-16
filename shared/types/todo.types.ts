/** Status of a to-do item. */
export type ToDoStatus = 'pending' | 'in_progress' | 'completed' | 'archived';

/** Represents a to-do item. */
export interface ToDoItem {
  id: string; // UUID v4
  userId: string;
  title: string;
  description?: string | null;
  createdAt: Date;
  dueDate?: Date | null; // "Situated in time"
  completedAt?: Date | null;
  status: ToDoStatus;
  priority?: number | null; // 1-5, lower is higher priority
  parentTodoId?: string | null; // For subtasks
  projectOrGoalId?: string | null; // Links to stated/inferred goal IDs
  relatedObjectIds?: string[] | null; // Related JeffersObject or chunk IDs
  updatedAt: Date;
}

/** Payload for creating a to-do. */
export interface ToDoCreatePayload {
  title: string;
  description?: string | null;
  dueDate?: number | null; // Unix timestamp
  priority?: number | null;
  parentTodoId?: string | null;
  projectOrGoalId?: string | null;
  relatedObjectIds?: string[] | null;
}

/** Payload for updating a to-do. */
export interface ToDoUpdatePayload {
  title?: string;
  description?: string | null;
  dueDate?: number | null;
  status?: ToDoStatus;
  priority?: number | null;
  parentTodoId?: string | null;
  projectOrGoalId?: string | null;
  relatedObjectIds?: string[] | null;
}