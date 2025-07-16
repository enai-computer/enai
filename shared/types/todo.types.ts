/** Status of a to-do item. */
export type ToDoStatus = 'pending' | 'in_progress' | 'completed' | 'archived';

/** Represents a to-do item. */
export interface ToDoItem {
  id: string; // UUID v4
  userId: string;
  title: string;
  description?: string | null;
  createdAt: string; // ISO 8601 timestamp
  dueDate?: string | null; // ISO 8601 timestamp - "Situated in time"
  completedAt?: string | null; // ISO 8601 timestamp
  status: ToDoStatus;
  priority?: number | null; // 1-5, lower is higher priority
  parentTodoId?: string | null; // For subtasks
  projectOrGoalId?: string | null; // Links to stated/inferred goal IDs
  relatedObjectIds?: string[] | null; // Related JeffersObject or chunk IDs
  updatedAt: string; // ISO 8601 timestamp
}

/** Payload for creating a to-do. */
export interface ToDoCreatePayload {
  title: string;
  description?: string | null;
  dueDate?: string | null; // ISO 8601 timestamp
  priority?: number | null;
  parentTodoId?: string | null;
  projectOrGoalId?: string | null;
  relatedObjectIds?: string[] | null;
}

/** Payload for updating a to-do. */
export interface ToDoUpdatePayload {
  title?: string;
  description?: string | null;
  dueDate?: string | null; // ISO 8601 timestamp
  status?: ToDoStatus;
  priority?: number | null;
  parentTodoId?: string | null;
  projectOrGoalId?: string | null;
  relatedObjectIds?: string[] | null;
}