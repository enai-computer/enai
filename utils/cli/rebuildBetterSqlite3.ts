import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger.js';

const projectRoot = path.resolve(__dirname, '../../');
const electronModulesDir = path.join(projectRoot, 'electron_modules');
const nodeModulePath = path.join(projectRoot, 'node_modules', 'better-sqlite3');
const electronModulePath = path.join(electronModulesDir, 'better-sqlite3');
const electronBinary = path.join(electronModulePath, 'build', 'Release', 'better_sqlite3.node');

function pathExists(p: string): boolean {
  return fs.existsSync(p);
}

function run(command: string): void {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    logger.error(`[Rebuild Script] Command failed: ${command}`, error);
    throw error;
  }
}

function main(): void {
  try {
    if (pathExists(electronBinary)) {
      logger.info('[Rebuild Script] Cached Electron better-sqlite3 build found. Skipping rebuild.');
      return;
    }

    logger.info('[Rebuild Script] Rebuilding better-sqlite3 for Electron...');
    run('npx electron-rebuild -f -w better-sqlite3');

    logger.info('[Rebuild Script] Copying Electron build to electron_modules...');
    fs.mkdirSync(electronModulesDir, { recursive: true });
    // Use Node.js fs.cpSync for cross-platform compatibility
    fs.cpSync(nodeModulePath, electronModulePath, { recursive: true });

    logger.info('[Rebuild Script] Restoring Node build in node_modules...');
    run('npm rebuild better-sqlite3 --build-from-source');

    logger.info('[Rebuild Script] Rebuild process complete.');
  } catch (error) {
    logger.error('[Rebuild Script] Failed to complete rebuild process:', error);
    process.exit(1);
  }
}

main();
