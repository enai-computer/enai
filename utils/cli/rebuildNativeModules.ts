import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger.js';

const projectRoot = path.resolve(__dirname, '../../');
const electronModulesDir = path.join(projectRoot, 'electron_modules');

interface NativeModule {
  name: string;
  binaryPath: string;
  // JavaScript dependencies that need to be copied to electron_modules
  dependencies?: string[];
}

const nativeModules: NativeModule[] = [
  {
    name: 'better-sqlite3',
    binaryPath: 'build/Release/better_sqlite3.node',
    // Runtime dependencies needed for the module to work
    dependencies: ['bindings', 'prebuild-install']
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

function copyDependency(depName: string, visited: Set<string> = new Set()): void {
  // Prevent infinite recursion
  if (visited.has(depName)) {
    return;
  }
  visited.add(depName);
  
  const sourcePath = path.join(projectRoot, 'node_modules', depName);
  const targetPath = path.join(electronModulesDir, depName);
  
  if (!pathExists(sourcePath)) {
    logger.warn(`[Rebuild Script] Dependency ${depName} not found in node_modules. Skipping.`);
    return;
  }
  
  if (pathExists(targetPath)) {
    logger.info(`[Rebuild Script] Dependency ${depName} already exists in electron_modules. Skipping.`);
    return;
  }
  
  logger.info(`[Rebuild Script] Copying dependency ${depName} to electron_modules...`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
  
  // Check for transitive dependencies
  const packageJsonPath = path.join(sourcePath, 'package.json');
  if (pathExists(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.dependencies) {
        for (const transitiveDep of Object.keys(packageJson.dependencies)) {
          copyDependency(transitiveDep, visited);
        }
      }
    } catch (error) {
      logger.warn(`[Rebuild Script] Could not read package.json for ${depName}:`, error);
    }
  }
}

function rebuildModule(module: NativeModule): void {
  const nodeModulePath = path.join(projectRoot, 'node_modules', module.name);
  const electronModulePath = path.join(electronModulesDir, module.name);
  const electronBinary = path.join(electronModulePath, module.binaryPath);

  if (pathExists(electronBinary)) {
    logger.info(`[Rebuild Script] Cached Electron ${module.name} build found. Skipping rebuild.`);
    // Still need to ensure dependencies are copied
    if (module.dependencies) {
      for (const dep of module.dependencies) {
        copyDependency(dep);
      }
    }
    return;
  }

  logger.info(`[Rebuild Script] Rebuilding ${module.name} for Electron...`);
  run(`npx electron-rebuild -f -w ${module.name}`);

  logger.info(`[Rebuild Script] Copying Electron build to electron_modules...`);
  fs.mkdirSync(path.dirname(electronModulePath), { recursive: true });
  // Use Node.js fs.cpSync for cross-platform compatibility
  fs.cpSync(nodeModulePath, electronModulePath, { recursive: true });

  // Copy JavaScript dependencies if specified
  if (module.dependencies) {
    logger.info(`[Rebuild Script] Copying JavaScript dependencies for ${module.name}...`);
    for (const dep of module.dependencies) {
      copyDependency(dep);
    }
  }

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