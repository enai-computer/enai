const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = process.env.ENAI_DB_PATH || 
  path.join(os.homedir(), 'Library', 'Application Support', 'src', 'enai.db');

const db = new Database(dbPath, { readonly: true });

// Get count of each activity type
console.log('Activity type counts:');
const typeCounts = db.prepare(`
  SELECT activity_type, COUNT(*) as count 
  FROM user_activities 
  GROUP BY activity_type 
  ORDER BY count DESC
`).all();

typeCounts.forEach(row => {
  console.log(`  ${row.activity_type}: ${row.count}`);
});

// Check for notebook-related activities
console.log('\nNotebook-related activities:');
const notebookActivities = db.prepare(`
  SELECT activity_type, COUNT(*) as count 
  FROM user_activities 
  WHERE activity_type LIKE '%notebook%'
  GROUP BY activity_type
`).all();

if (notebookActivities.length === 0) {
  console.log('  No notebook-related activities found!');
} else {
  notebookActivities.forEach(row => {
    console.log(`  ${row.activity_type}: ${row.count}`);
  });
}

// Sample some recent activities
console.log('\nLast 5 activities:');
const recent = db.prepare(`
  SELECT 
    datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
    activity_type,
    substr(details_json, 1, 100) as details_preview
  FROM user_activities 
  ORDER BY timestamp DESC 
  LIMIT 5
`).all();

recent.forEach(row => {
  console.log(`  ${row.time} - ${row.activity_type}`);
  console.log(`    Details: ${row.details_preview}...`);
});

db.close();