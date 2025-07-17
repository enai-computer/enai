/** Represents a notebook record in the database. */
export interface NotebookRecord {
  id: string; // UUID
  title: string;
  description: string | null;
  objectId: string; // Link to the corresponding JeffersObject
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}

/** Extended notebook type with last accessed timestamp. */
export type RecentNotebook = NotebookRecord & {
  lastAccessed: string; // ISO 8601 timestamp
};