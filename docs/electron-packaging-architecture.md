# Electron Packaging Architecture

This document describes the complete packaging architecture for the Enai Electron application, including navigation patterns, build processes, and implementation details.

## Overview

The Enai application uses a hybrid approach that combines web and desktop paradigms to create a packaged Electron application from a Next.js codebase. This architecture solves the fundamental challenge of running a Next.js application under Electron's `file://` protocol while maintaining both web-like navigation patterns and desktop-native window management.

## Core Technical Challenge

When packaging a Next.js application for Electron:
1. **Static export generates absolute paths** (`/_next/static/...`) that break under `file://` protocol
2. **Dynamic routes** (`/notebook/[notebookId]`) cannot work with static export
3. **No server** means no server-side routing or path resolution

## Hybrid Architecture Solution

The implemented solution uses a **hybrid hash/state approach** that combines:
- **Hash-based routing** for notebook-level navigation (preserving web patterns)
- **State-based management** for windows within notebooks (providing desktop functionality)

### 1. Hash-Based Routing for Notebooks

**Implementation**: Custom `useHashRouter` hook parses `window.location.hash`
- URLs change to `file:///index.html#/notebook/123`
- Browser back/forward buttons work
- Implementation in `src/hooks/useHashRouter.ts`

```typescript
// Navigation via hash
const { push, params, pathname } = useHashRouter();
push('/notebook/123'); // Changes hash, triggers navigation
```

### 2. State-Based Window Management

**Implementation**: Zustand store (`windowStoreFactory.ts`) for window state
- Each notebook has its own window store instance
- Manages window positions, sizes, focus, minimization
- Browser tab state within window payloads
- Freeze state machine for browser views
- State persists via IPC to electron-store

### 3. Service-Oriented Browser Architecture

The browser functionality uses a sophisticated service architecture:
- `ClassicBrowserService` - Main orchestrator
- `ClassicBrowserStateService` - Centralized state management
- `ClassicBrowserViewManager` - WebContentsView lifecycle
- `BrowserEventBus` - Event-driven communication
- Additional services for navigation, tabs, snapshots, and WOM integration

## Build & Packaging Implementation

### 1. Static Export Configuration

**Next.js Configuration** (`next.config.ts`):
```typescript
const nextConfig: NextConfig = {
  output: 'export',           // Generate static HTML files
  images: { unoptimized: true }, // Disable Next.js image optimization
  trailingSlash: false,       // Clean URLs
  generateBuildId: async () => 'static-build' // Consistent build ID
};
```

### 2. Single-Page Application Architecture

The build generates one massive `index.html` file containing the entire application:

**Generated Structure**:
```
out/
├── index.html              # Single HTML file with entire app
├── _next/static/
│   ├── chunks/             # 200+ JavaScript chunks
│   │   ├── app/
│   │   ├── framework-*.js
│   │   └── main-app-*.js
│   ├── css/               # Consolidated CSS files
│   └── media/             # Font files and assets
└── fonts/                 # Custom fonts (Soehne, Signifier)
```

### 3. Component Architecture Transformation

Components were refactored from server components to client components:

**Before**: Server Components with Dynamic Routes
```typescript
// src/app/notebook/[notebookId]/page.tsx
export default function NotebookPage({ params }: { params: { notebookId: string } }) {
  return <NotebookView notebookId={params.notebookId} />;
}
```

**After**: Client Components with Hash Routing
```typescript
// src/components/NotebookView.tsx
"use client";
export function NotebookView() {
  const { notebookId } = useHashRouter();
  return <div>Notebook {notebookId}</div>;
}
```

### 4. Asset Path Resolution

The implementation uses two approaches for handling asset paths:

#### Build-time Path Fixing
The `scripts/fix-electron-paths.js` script converts absolute paths to relative:
```javascript
// Convert: href="/_next/static/..." → href="./_next/static/..."
content = content.replace(/href="\/(_next\/)/g, 'href="./$1');
content = content.replace(/src="\/(_next\/)/g, 'src="./$1');
```

#### Runtime Protocol Interceptor
The `electron/main.ts` includes a fallback interceptor:
```typescript
mainWindow.webContents.session.protocol.interceptFileProtocol('file', (request, callback) => {
  const url = request.url.substr(7);
  
  if (url.startsWith('/_next/') || url.includes('/_next/')) {
    const assetPath = url.replace(/^.*\/_next\//, '_next/');
    const filePath = path.join(appPath, 'out', assetPath);
    callback({ path: filePath });
  } else {
    callback({ path: url });
  }
});
```

### 5. Build Pipeline

**Complete Build Process**:
1. `npm run build:nextjs` 
   - Sets `ELECTRON_BUILD=true`
   - Runs `next build` (generates `out/` directory)
   - Runs `node scripts/fix-electron-paths.js` (fixes asset paths)
2. `npm run electron:build`
   - Compiles TypeScript Electron code
   - Bundles main process and preload scripts
   - Copies migrations and workers
3. `npm run package:mac/win/linux`
   - Electron Forge packages the app
   - Copies `out/` directory to packaged app via build hook
   - Creates platform-specific distributables

**Build Hook** (`forge.config.js`):
```javascript
hooks: {
  packageAfterPrune: async (config, buildPath) => {
    // Copy the 'out' directory (Next.js static export) to packaged app
    const outSourcePath = path.join(__dirname, 'out');
    const outDestPath = path.join(buildPath, 'out');
    fs.cpSync(outSourcePath, outDestPath, { recursive: true });
  }
}
```

## Current Limitations & Known Issues

### 1. IPC Error Handling
The current implementation lacks proper error boundaries for IPC failures:
- No React error boundaries for IPC failures
- Components don't consistently check if `window.api` exists
- No graceful degradation when preload script fails

**Example of inconsistent handling**:
```typescript
// Some components check:
if (!window.api) {
  console.warn("window.api not available");
  return;
}

// Others assume it exists:
await window.api.notebooks.get(id); // Would crash if undefined
```

### 2. Potential Enhancements

#### Asset Path Configuration
Adding `assetPrefix` to `next.config.ts` could eliminate the need for the runtime protocol interceptor:
```typescript
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  generateBuildId: async () => 'static-build',
  assetPrefix: process.env.ELECTRON_BUILD === 'true' ? './' : '/'
};
```

#### IPC Error Boundaries
Implement a wrapper for safe IPC access:
```typescript
const safeApi = {
  notebooks: {
    get: async (id: string) => {
      if (!window.api) {
        console.error('IPC not available');
        return null;
      }
      return window.api.notebooks.get(id);
    }
  }
};
```

## Architecture Benefits

1. **Single Build Artifact**: One HTML file contains the entire app
2. **Fast Loading**: Chunked JavaScript loads on-demand
3. **Offline-First**: No server dependency, pure static files
4. **Platform Compatibility**: Works identically on macOS, Windows, Linux
5. **Development Experience**: Maintains Next.js dev experience
6. **Progressive Enhancement**: Chunks load as needed, not all at once
7. **Browser History**: Hash routing preserves familiar web navigation
8. **Desktop Features**: State-based window management provides native feel

## Runtime Behavior

**In Development**:
- Next.js dev server runs at `http://localhost:3000`
- Electron loads from dev server
- Hot reloading works normally
- Next.js App Router functions normally

**In Production**:
- Single `index.html` file loads the entire app
- JavaScript chunks load dynamically as needed
- Hash-based routing handles navigation
- All assets load via relative paths from `file://` protocol
- No server required - pure static file serving

**Navigation Flow**:
1. User clicks "Open Notebook"
2. `useHashRouter` sets `window.location.hash = '#/notebook/abc123'`
3. Hash change event triggers re-render
4. `NotebookView` component reads `notebookId` from hash
5. Component renders with correct notebook data
6. Browser back/forward buttons work via hash navigation

## Future Considerations

1. **Custom Protocol Handler**: Implement a custom protocol (e.g., `enai://`) for cleaner URLs and better security isolation
2. **Embedded Server**: Consider running a local Next.js server for full framework compatibility
3. **Progressive Web App**: Add offline support and service workers for enhanced desktop experience
4. **Auto-Updates**: Implement electron-updater for seamless application updates

## Conclusion

This hybrid architecture successfully bridges the gap between Next.js's modern development experience and Electron's static file serving requirements. It preserves web navigation patterns at the notebook level while providing desktop-native window management within notebooks, creating a robust desktop application that feels native while maintaining web development velocity.