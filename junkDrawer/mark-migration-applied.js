// Script to mark the consolidated migration as already applied
// Run this BEFORE starting the app to preserve your existing data

const Database = require('better-sqlite3');
const path = require('path');

// Use the same database path as the app
const dbPath = process.env.ENAI_DB_PATH || 
    path.join(process.env.HOME, 'Library', 'Application Support', 'src', 'enai.db');

console.log('Opening database at:', dbPath);

try {
    const db = new Database(dbPath);
    
    // Check if database exists and has tables
    const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all();
    
    if (tables.length === 0) {
        console.log('\n❌ No tables found in database. This script is for existing databases only.');
        console.log('If this is a fresh install, just run the app normally.');
        process.exit(1);
    }
    
    console.log('\nExisting tables found:', tables.map(t => t.name).join(', '));
    
    // Check what migrations are already recorded
    const existingMigrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    console.log('\nCurrently recorded migrations:');
    existingMigrations.forEach(m => console.log('  -', m.version));
    
    // Check if our new migration is already marked
    const hasNewMigration = existingMigrations.some(m => m.version === '0001_initial_schema');
    
    if (hasNewMigration) {
        console.log('\n✓ Migration 0001_initial_schema is already marked as applied');
    } else {
        // Mark the new consolidated migration as applied
        console.log('\nMarking 0001_initial_schema as applied...');
        const stmt = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
        stmt.run('0001_initial_schema');
        console.log('✓ Successfully marked migration as applied');
    }
    
    // Verify
    const finalMigrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    console.log('\nFinal migration records:');
    finalMigrations.forEach(m => console.log('  -', m.version));
    
    db.close();
    
    console.log('\n✅ Done! You can now run the app with:');
    console.log('   npm run electron:dev');
    
} catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('no such table: schema_migrations')) {
        console.error('\nThe schema_migrations table doesn\'t exist.');
        console.error('This might mean the database was created outside of the migration system.');
    }
    process.exit(1);
}