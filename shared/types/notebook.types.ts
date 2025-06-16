/** Represents a notebook record in the database. */
export interface NotebookRecord {
  id: string; // UUID
  title: string;
  description: string | null;
  objectId: string; // Link to the corresponding JeffersObject
  createdAt: number; // Unix epoch milliseconds (SQLite INTEGER)
  updatedAt: number; // Unix epoch milliseconds (SQLite INTEGER)
}

/** Extended notebook type with last accessed timestamp. */
export type RecentNotebook = NotebookRecord & {
  lastAccessed: number;
};