"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const child_process_1 = require("child_process");
const logger_js_1 = require("../logger.js");
const projectRoot = path_1.default.resolve(__dirname, '../../');
const electronModulesDir = path_1.default.join(projectRoot, 'electron_modules');
const nodeModulePath = path_1.default.join(projectRoot, 'node_modules', 'better-sqlite3');
const electronModulePath = path_1.default.join(electronModulesDir, 'better-sqlite3');
const electronBinary = path_1.default.join(electronModulePath, 'build', 'Release', 'better_sqlite3.node');
function pathExists(p) {
    return fs_1.default.existsSync(p);
}
function run(command) {
    try {
        (0, child_process_1.execSync)(command, { stdio: 'inherit' });
    }
    catch (error) {
        logger_js_1.logger.error(`[Rebuild Script] Command failed: ${command}`, error);
        throw error;
    }
}
function main() {
    try {
        if (pathExists(electronBinary)) {
            logger_js_1.logger.info('[Rebuild Script] Cached Electron better-sqlite3 build found. Skipping rebuild.');
            return;
        }
        logger_js_1.logger.info('[Rebuild Script] Rebuilding better-sqlite3 for Electron...');
        run('npx electron-rebuild -f -w better-sqlite3');
        logger_js_1.logger.info('[Rebuild Script] Copying Electron build to electron_modules...');
        fs_1.default.mkdirSync(electronModulesDir, { recursive: true });
        // Use Node.js fs.cpSync for cross-platform compatibility
        fs_1.default.cpSync(nodeModulePath, electronModulePath, { recursive: true });
        logger_js_1.logger.info('[Rebuild Script] Restoring Node build in node_modules...');
        run('npm rebuild better-sqlite3 --build-from-source');
        logger_js_1.logger.info('[Rebuild Script] Rebuild process complete.');
    }
    catch (error) {
        logger_js_1.logger.error('[Rebuild Script] Failed to complete rebuild process:', error);
        process.exit(1);
    }
}
main();
