import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger.js';

const projectRoot = path.resolve(__dirname, '../../');
const electronModulesDir = path.join(projectRoot, 'electron_modules');

interface NativeModule {
  name: string;
  binaryPath: string;
}

const nativeModules: NativeModule[] = [
  {
    name: 'better-sqlite3',
    binaryPath: 'build/Release/better_sqlite3.node'
  },
  {
    name: 'vectordb',
    binaryPath: 'build/Release/vectordb.node'
  }
];

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

function rebuildModule(module: NativeModule): void {
  const nodeModulePath = path.join(projectRoot, 'node_modules', module.name);
  const electronModulePath = path.join(electronModulesDir, module.name);
  const electronBinary = path.join(electronModulePath, module.binaryPath);

  if (pathExists(electronBinary)) {
    logger.info(`[Rebuild Script] Cached Electron ${module.name} build found. Skipping rebuild.`);
    return;
  }

  logger.info(`[Rebuild Script] Rebuilding ${module.name} for Electron...`);
  run(`npx electron-rebuild -f -w ${module.name}`);

  logger.info(`[Rebuild Script] Copying Electron build to electron_modules...`);
  fs.mkdirSync(path.dirname(electronModulePath), { recursive: true });
  // Use Node.js fs.cpSync for cross-platform compatibility
  fs.cpSync(nodeModulePath, electronModulePath, { recursive: true });

  logger.info(`[Rebuild Script] Restoring Node build in node_modules...`);
  run(`npm rebuild ${module.name} --build-from-source`);
}

function main(): void {
  try {
    logger.info('[Rebuild Script] Starting native module rebuild process...');
    
    // Create electron_modules directory if it doesn't exist
    fs.mkdirSync(electronModulesDir, { recursive: true });

    // Rebuild each native module
    for (const module of nativeModules) {
      rebuildModule(module);
    }

    logger.info('[Rebuild Script] All native modules rebuilt successfully.');
  } catch (error) {
    logger.error('[Rebuild Script] Failed to complete rebuild process:', error);
    process.exit(1);
  }
}

main();