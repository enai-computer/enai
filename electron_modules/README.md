# Electron Modules Directory

Contains Electron-specific builds of native Node.js modules.

## Why This Exists

Native modules like `better-sqlite3` must be compiled for Electron's specific Node.js version. The standard `node_modules` version won't work in Electron.

## How It Works

1. `npm run rebuild:electron` builds modules for Electron
2. Compiled modules are cached here
3. Database initialization detects Electron and loads from this directory

## Contents

- `better-sqlite3/` - SQLite driver compiled for Electron

## Maintenance

- To rebuild: Delete directory and run `npm run rebuild:electron`
- Do not manually edit files here

## Trade-offs

- Larger repository size
- Platform-specific builds
- 100% reliable operation
- No runtime failures