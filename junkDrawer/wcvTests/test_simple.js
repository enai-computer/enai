// test_simple.js
const { app } = require('electron');

console.log('--- Simple Electron Test ---');
console.log(`Running on Electron version: ${process.versions.electron}`);
console.log('This script will now quit.');
app.quit();
