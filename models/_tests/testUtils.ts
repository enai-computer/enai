import Database from 'better-sqlite3';
import runMigrations from '../runMigrations';

export function setupTestDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

export function cleanTestDb(db: Database.Database) {
  // Clear tables in proper order to respect foreign keys
  db.exec(`
    DELETE FROM chat_messages;
    DELETE FROM chat_sessions;
    DELETE FROM notes;
    DELETE FROM embeddings;
    DELETE FROM chunks;
    DELETE FROM user_activities;
    DELETE FROM user_todos;
    DELETE FROM ingestion_jobs;
    DELETE FROM notebook_objects;
    DELETE FROM notebooks WHERE id != 'cover-default_user';
    DELETE FROM objects;
  `);
}