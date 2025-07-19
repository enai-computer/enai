const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const fs = require('fs');
const path = require('path');

/**
 * NATIVE MODULE HANDLING STRATEGY
 * ================================
 * 
 * This application uses several native Node.js modules that must be compiled for
 * Electron's specific Node.js version. The strategy works as follows:
 * 
 * 1. DEVELOPMENT WORKFLOW:
 *    - Run `npm run rebuild:electron` to compile native modules for Electron
 *    - Compiled modules are cached in /electron_modules/ directory
 *    - models/db.ts detects Electron environment and loads from /electron_modules/
 *    - Regular Node.js tests use standard /node_modules/ versions
 * 
 * 2. PACKAGING STRATEGY:
 *    - The asar.unpack pattern below ensures native modules are NOT packed into asar
 *    - Native modules must be accessible as real files on disk for Node.js to load
 *    - Both /node_modules/ and /electron_modules/ versions are unpacked
 * 
 * 3. PRODUCTION FILE STRUCTURE (after packaging):
 *    macOS: MyApp.app/Contents/
 *      └── Resources/
 *          ├── app.asar                  (main application code)
 *          └── app.asar.unpacked/        (unpacked native modules)
 *              ├── node_modules/
 *              │   ├── better-sqlite3/   (may contain Node version)
 *              │   ├── @lancedb/
 *              │   └── apache-arrow/
 *              └── electron_modules/
 *                  ├── better-sqlite3/   (Electron-specific build)
 *                  ├── vectordb/         (if rebuilt for Electron)
 *                  └── [dependencies]/   (bindings, prebuild-install, etc)
 * 
 * 4. RUNTIME MODULE RESOLUTION:
 *    - models/db.ts checks if running in Electron
 *    - In packaged app: looks for electron_modules in app.asar.unpacked/
 *    - In development: looks for electron_modules relative to project root
 *    - Falls back to node_modules if electron_modules not found
 * 
 * 5. CRITICAL NATIVE MODULES:
 *    - better-sqlite3: SQLite database driver (MUST be Electron-compiled)
 *    - @lancedb/vectordb: Vector database (includes native bindings)
 *    - apache-arrow: Data format library (C++ bindings)
 *    - bindings: Native module helper (required by better-sqlite3)
 *    - file-uri-to-path: Native path handling (required by bindings)
 * 
 * 6. TROUBLESHOOTING:
 *    - "Module version mismatch" errors: Run `npm run rebuild:electron`
 *    - "Cannot find module" in production: Check asar.unpack patterns
 *    - Test with `npx asar list dist/mac/MyApp.app/Contents/Resources/app.asar`
 *    - Verify unpacked files exist in app.asar.unpacked directory
 * 
 * 7. PLATFORM NOTES:
 *    - electron_modules contains platform-specific builds
 *    - Must rebuild when switching between macOS/Windows/Linux
 *    - CI/CD must run rebuild:electron for target platform
 */

module.exports = {
  packagerConfig: {
    asar: {
      // IMPORTANT: These patterns ensure native modules are unpacked from asar
      // Native modules CANNOT be loaded from within asar archives - they must exist as real files
      // Pattern format: glob patterns wrapped in {} and comma-separated
      unpack: '{**/node_modules/better-sqlite3/**/*,**/node_modules/vectordb/**/*,**/node_modules/apache-arrow/**/*,**/node_modules/@lancedb/**/*,**/electron_modules/**/*,**/node_modules/bindings/**/*,**/node_modules/file-uri-to-path/**/*,**/out/overlay.html,**/out/overlay.js,**/out/overlay.js.map}'
    },
    icon: 'public/icons/icon',
    // macOS code signing configuration
    osxSign: process.env.APPLE_ID ? {
      identity: 'Developer ID Application',
      'hardened-runtime': true,
      'gatekeeper-assess': false,
      entitlements: 'build/entitlements.plist',
      'entitlements-inherit': 'build/entitlements.plist'
    } : undefined,
    // macOS notarization configuration
    osxNotarize: process.env.APPLE_ID ? {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    } : undefined,
    // Windows code signing configuration
    win32metadata: {
      CompanyName: 'Enai',
      FileDescription: 'A personal computing environment',
      OriginalFilename: 'Enai.exe',
      ProductName: 'Enai',
      InternalName: 'Enai'
    },
    ignore: [
      /^\/src/, // Ignore source files
      /^\/\.next/, // Ignore Next.js build cache
      // Note: We need to include production dependencies, so we don't exclude all node_modules
      // Instead, we rely on the auto-unpack-natives plugin to handle native modules
      (file) => {
        if (!file) return false;
        
        // Always include essential files
        const include = ['/out', '/electron', '/package.json', '/electron_modules'];
        if (include.some(inc => file.startsWith(inc))) {
          return false; // Don't ignore these
        }
        
        // Include production dependencies but exclude dev dependencies
        if (file.startsWith('/node_modules/')) {
          // This is handled by Electron Forge's built-in pruning
          return false; // Don't ignore node_modules - let Forge handle it
        }
        
        return false; // Don't ignore other files
      }
    ]
  },
  hooks: {
    packageAfterPrune: async (config, buildPath, electronVersion, platform, arch) => {
      // Check if Next.js build output exists
      const outSourcePath = path.join(__dirname, 'out');
      const outDestPath = path.join(buildPath, 'out');
      
      if (fs.existsSync(outSourcePath)) {
        // Copy the entire out directory
        fs.cpSync(outSourcePath, outDestPath, { recursive: true });
        console.log(`✅ Copied Next.js build output to: ${outDestPath}`);
      } else {
        console.error(`❌ Next.js build output not found at: ${outSourcePath}`);
        console.error(`   Run 'npm run build' before packaging.`);
        process.exit(1);
      }
      
      // Copy .env file to the packaged app resources directory if it exists
      const envSourcePath = path.join(__dirname, '.env');
      const envDestPath = path.join(buildPath, '.env');
      
      if (fs.existsSync(envSourcePath)) {
        fs.copyFileSync(envSourcePath, envDestPath);
        console.log(`✅ Copied .env file to packaged app at: ${envDestPath}`);
      } else {
        console.warn(`⚠️  No .env file found at: ${envSourcePath}. App will run without environment variables.`);
      }
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
