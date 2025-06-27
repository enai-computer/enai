// Quick test to check if there are any notebook_opened activities in the database
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Use the same path logic as the app
const dbPath = process.env.JEFFERS_DB_PATH || 
  path.join(os.homedir(), 'Library', 'Application Support', 'src', 'jeffers.db');

console.log('Opening database at:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });
  
  // Check if user_activities table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='user_activities'
  `).get();
  
  if (!tableExists) {
    console.log('ERROR: user_activities table does not exist!');
    process.exit(1);
  }
  
  // Count all activities
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM user_activities').get();
  console.log('\nTotal activities in database:', totalCount.count);
  
  // Count notebook_opened activities
  const notebookOpenedCount = db.prepare(`
    SELECT COUNT(*) as count FROM user_activities 
    WHERE activity_type = 'notebook_opened'
  `).get();
  console.log('notebook_opened activities:', notebookOpenedCount.count);
  
  // Get recent notebook_opened activities
  console.log('\nRecent notebook_opened activities:');
  const recentActivities = db.prepare(`
    SELECT 
      id,
      datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
      activity_type,
      json_extract(details_json, '$.notebookId') as notebook_id,
      json_extract(details_json, '$.title') as title
    FROM user_activities 
    WHERE activity_type = 'notebook_opened'
    ORDER BY timestamp DESC
    LIMIT 10
  `).all();
  
  recentActivities.forEach(activity => {
    console.log(`- ${activity.time}: ${activity.title || 'Untitled'} (${activity.notebook_id})`);
  });
  
  // Test the exact query used by NotebookService
  console.log('\nTesting NotebookService query:');
  const notebookServiceQuery = db.prepare(`
    SELECT DISTINCT json_extract(details_json, '$.notebookId') as notebook_id,
           MAX(timestamp) as last_accessed
    FROM user_activities
    WHERE activity_type = 'notebook_opened'
      AND json_extract(details_json, '$.notebookId') IS NOT NULL
      AND json_extract(details_json, '$.notebookId') NOT LIKE 'cover-%'
    GROUP BY json_extract(details_json, '$.notebookId')
    ORDER BY last_accessed DESC
    LIMIT 12
  `).all();
  
  console.log('Query returned', notebookServiceQuery.length, 'notebooks:');
  notebookServiceQuery.forEach(row => {
    const date = new Date(row.last_accessed);
    console.log(`- ${row.notebook_id}: last accessed ${date.toLocaleString()}`);
  });
  
  db.close();
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}