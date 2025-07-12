# Desktop Navigation Architecture

## Overview

This document describes two different architectural approaches for handling navigation in the Jeffers Electron application, addressing the fundamental challenge of running a Next.js application under Electron's `file://` protocol.

## The Core Problem

When packaging a Next.js application for Electron:
1. **Static export generates absolute paths** (`/_next/static/...`) that break under `file://` protocol
2. **Dynamic routes** (`/notebook/[notebookId]`) cannot work with static export
3. **No server** means no server-side routing or path resolution

## Two Architectural Approaches

### Approach 1: State-Based Navigation (state-mgmt branch)

**Philosophy**: "Desktop applications don't use URLs for navigation"

#### Implementation
- Replace URL-based routing with pure React state management
- Use Zustand store (`appNavigationStore`) to track current view
- Single `page.tsx` conditionally renders based on state
- No URL changes during navigation

```typescript
// Navigation via state
const { openNotebook } = useAppNavigationStore();
openNotebook('notebook-id'); // Changes state, no URL change
```

#### Key Components
- `src/store/appNavigationStore.ts` - Navigation state management
- Protocol interceptor in `electron/main.ts` - Runtime asset path resolution
- IPC-based persistence for navigation state

### Approach 2: Hash-Based Routing (package branch)

**Philosophy**: "Preserve web navigation patterns in desktop context"

#### Implementation
- Implement custom hash routing (`#/notebook/123`)
- Use `useHashRouter` hook to parse `window.location.hash`
- Single `page.tsx` conditionally renders based on hash route
- URLs change to `file:///index.html#/notebook/123`

```typescript
// Navigation via hash
const router = useHashRouter();
router.push('/notebook/notebook-id'); // Changes to #/notebook/notebook-id
```

#### Key Components
- `src/hooks/useHashRouter.ts` - Custom hash-based router
- `scripts/fix-electron-paths.js` - Build-time asset path fixing
- Browser history integration for back/forward navigation

## Comparison Matrix

| Aspect | State-Based Navigation | Hash-Based Routing |
|--------|----------------------|-------------------|
| **Navigation Method** | Zustand state management | Hash fragments in URL |
| **URL Behavior** | Never changes | Changes with hash |
| **Asset Path Fix** | Runtime interceptor | Build-time script |
| **Browser History** | Not supported | Fully supported |
| **Persistence** | Built-in via IPC | Not implemented |
| **Code Changes** | More invasive | Minimal changes |
| **User Experience** | Desktop-native | Web-like |
| **Implementation Complexity** | Higher | Lower |

## Trade-off Analysis

### State-Based Navigation

**Advantages:**
- More native desktop application feel
- Clean URLs without hash fragments
- Built-in persistence of navigation state
- Simpler mental model for desktop developers
- No reliance on browser navigation APIs

**Disadvantages:**
- Browser back/forward buttons don't work
- Requires more significant code refactoring
- Runtime asset interceptor adds complexity
- Departure from familiar web patterns
- Potential for state synchronization issues

### Hash-Based Routing

**Advantages:**
- Browser history works as expected
- Minimal changes to existing codebase
- Build-time asset fixing is more robust
- Familiar patterns for web developers
- Progressive enhancement possible

**Disadvantages:**
- URLs contain hash fragments (`#/notebook/123`)
- No built-in state persistence
- Requires additional build step
- Still feels "web-like" in desktop context
- Hash routing can conflict with in-page anchors

## Implementation Details

### Asset Path Resolution

**State-Based Approach:**
```javascript
// Runtime interceptor (in electron/main.ts)
protocol.handle('file', (request) => {
  // Intercept and rewrite asset paths
  const filePath = resolveAssetPath(request.url);
  return net.fetch(`file://${filePath}`);
});
```

**Hash-Based Approach:**
```javascript
// Build-time script (scripts/fix-electron-paths.js)
// Rewrites paths in HTML/CSS files after build
// /_next/static → ./_next/static
```

### Navigation State Persistence

**State-Based Approach:**
- Automatically persists last opened notebook
- Restores state on application restart
- Uses IPC bridge for persistence

**Hash-Based Approach:**
- No built-in persistence
- Could potentially use hash state on reload
- Would require additional implementation

## Recommendations

### Choose State-Based Navigation if:
- Building a desktop-first application
- Want a more native feel
- Don't need browser navigation features
- Willing to invest in custom infrastructure

### Choose Hash-Based Routing if:
- Need to ship quickly
- Want familiar web patterns
- Require browser history support
- Prefer minimal changes to existing code

## Future Considerations

1. **Hybrid Approach**: Could combine both approaches, using state for primary navigation but updating hash for bookmarkability
2. **Electron Protocol Handlers**: Could implement custom protocol (e.g., `jeffers://notebook/123`) for more native URLs
3. **Deep Linking**: Both approaches would need additional work to support OS-level deep linking

## Conclusion

Both approaches successfully solve the core routing problem but with different philosophies. The state-based approach embraces desktop paradigms while the hash-based approach adapts web patterns for desktop use. The choice depends on whether you prioritize a native desktop experience or familiar web patterns.