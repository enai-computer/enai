#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = '/Users/currandwyer/Library/Application Support/src/jeffers.db';

console.log('Checking database:', dbPath);

try {
    const db = new Database(dbPath);
    
    // Check if notebooks table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notebooks'").get();
    
    if (!tableExists) {
        console.log('Notebooks table does not exist. Database needs initialization.');
    } else {
        console.log('\nNotebooks table exists. Checking for NotebookCovers...\n');
        
        // Check all notebooks
        const allNotebooks = db.prepare("SELECT id, title, description FROM notebooks ORDER BY id").all();
        console.log(`Total notebooks: ${allNotebooks.length}`);
        
        allNotebooks.forEach(nb => {
            const type = nb.id.startsWith('cover-') ? 'NotebookCover' : 
                        nb.id === 'agent-conversations' ? 'Old Agent Notebook' : 
                        'Regular Notebook';
            console.log(`- [${type}] ${nb.id}: ${nb.title}`);
        });
        
        // Check for NotebookCover specifically
        const coverNotebooks = db.prepare("SELECT id, title FROM notebooks WHERE id LIKE 'cover-%'").all();
        console.log(`\nNotebookCovers found: ${coverNotebooks.length}`);
        
        // Check for old agent-conversations notebook
        const oldAgentNotebook = db.prepare("SELECT id, title FROM notebooks WHERE id = 'agent-conversations'").get();
        if (oldAgentNotebook) {
            console.log('\n⚠️  Old agent-conversations notebook still exists. Migration 0017 will handle this.');
        }
    }
    
    db.close();
} catch (error) {
    console.error('Error checking database:', error.message);
}