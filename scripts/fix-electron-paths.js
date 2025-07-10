#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

/**
 * Post-build script to fix asset paths for Electron
 * Converts absolute paths (/_next/...) to relative paths (./_next/...)
 */

const outDir = path.join(__dirname, '..', 'out');

function fixHtmlFiles() {
  console.log('[fix-electron-paths] Fixing HTML files...');
  
  const htmlFiles = globSync('**/*.html', { cwd: outDir });
  
  let fixedFiles = 0;
  
  for (const file of htmlFiles) {
    const filePath = path.join(outDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Fix asset paths
    const originalContent = content;
    content = content.replace(/href="\/(_next\/)/g, 'href="./$1');
    content = content.replace(/src="\/(_next\/)/g, 'src="./$1');
    content = content.replace(/url\(\/(_next\/)/g, 'url(./$1');
    
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content);
      fixedFiles++;
      console.log(`[fix-electron-paths] Fixed: ${file}`);
    }
  }
  
  console.log(`[fix-electron-paths] Fixed ${fixedFiles} HTML files`);
}

function fixCssFiles() {
  console.log('[fix-electron-paths] Fixing CSS files...');
  
  const cssFiles = globSync('**/*.css', { cwd: outDir });
  
  let fixedFiles = 0;
  
  for (const file of cssFiles) {
    const filePath = path.join(outDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Fix asset paths in CSS
    const originalContent = content;
    content = content.replace(/url\(\/(_next\/)/g, 'url(../$1');
    content = content.replace(/url\("\/(_next\/)/g, 'url("../$1');
    content = content.replace(/url\('\/(_next\/)/g, "url('../$1");
    
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content);
      fixedFiles++;
      console.log(`[fix-electron-paths] Fixed: ${file}`);
    }
  }
  
  console.log(`[fix-electron-paths] Fixed ${fixedFiles} CSS files`);
}

function main() {
  if (!fs.existsSync(outDir)) {
    console.error('[fix-electron-paths] Out directory does not exist. Run Next.js build first.');
    process.exit(1);
  }
  
  console.log('[fix-electron-paths] Starting post-build path fixing...');
  
  fixHtmlFiles();
  fixCssFiles();
  
  console.log('[fix-electron-paths] Asset path fixing complete!');
}

if (require.main === module) {
  main();
}

module.exports = { fixHtmlFiles, fixCssFiles, main };