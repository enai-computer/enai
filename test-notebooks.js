#!/usr/bin/env node

// Test script to check notebook functionality
console.log('=== Notebook System Test ===\n');

console.log('To test the notebook system in the browser console:\n');

console.log('1. Get all notebooks:');
console.log('   await window.api.getAllNotebooks()\n');

console.log('2. Create a test notebook:');
console.log('   await window.api.createNotebook({ title: "Test Notebook", description: "Testing" })\n');

console.log('3. Get all notebooks again to verify:');
console.log('   await window.api.getAllNotebooks()\n');

console.log('4. Get a specific notebook by ID:');
console.log('   const notebooks = await window.api.getAllNotebooks()');
console.log('   if (notebooks.length > 0) {');
console.log('     await window.api.getNotebookById(notebooks[0].id)');
console.log('   }\n');

console.log('5. Check what the AI sees:');
console.log('   // The AI gets notebooks from NotebookService.getAllNotebooks()');
console.log('   // which should be the same as window.api.getAllNotebooks()\n');

console.log('Note: If notebooks exist but AI says there are none, there may be');
console.log('an issue with how NotebookService is initialized or how data is persisted.');