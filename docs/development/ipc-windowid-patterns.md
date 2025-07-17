# IPC Handler WindowId Inconsistency Analysis

## Overview

This document captures the current state of windowId parameter handling across IPC handlers in the Jeffers codebase. There are inconsistent patterns for how windowId is passed between the renderer and main process, which could lead to confusion and maintenance issues.

## Handlers with Inconsistent WindowId Handling

The following handlers handle windowId inconsistently (not as the first parameter after event):

### 1. OBJECT_DELETE_BY_SOURCE_URI in objectHandlers.ts
- **Current signature**: `async (event, { windowId, sourceUri }: { windowId: string; sourceUri: string })`
- **Issue**: WindowId is nested in an object parameter
- **Location**: `/electron/ipc/objectHandlers.ts`

### 2. BROWSER_CONTEXT_MENU_ACTION in overlayHandlers.ts
- **Current signature**: `async (event, payload)` where windowId is extracted as `data.windowId`
- **Issue**: WindowId is deeply nested: `payload.data.windowId`
- **Location**: `/electron/ipc/overlayHandlers.ts:34`

### 3. INGEST_URL in ingestUrl.ts
- **Current signature**: `async (event, url: string, title?: string, windowId?: string)`
- **Issue**: WindowId is the 4th parameter and optional
- **Location**: `/electron/ipc/ingestUrl.ts`

### 4. STORE_SET in storageHandlers.ts
- **Current signature**: `async (_event, { key, value }: { key: string; value: string })`
- **Issue**: Uses destructured object parameter (no windowId, but same pattern)
- **Location**: `/electron/ipc/storageHandlers.ts`

### 5. TODO_UPDATE in toDoHandlers.ts
- **Current signature**: `async (_event, { id, payload }: { id: string; payload: ToDoUpdatePayload })`
- **Issue**: Uses destructured object parameter (no windowId, but same pattern)
- **Location**: `/electron/ipc/toDoHandlers.ts`

## Consistent Classic Browser Handlers

All other Classic Browser handlers follow the consistent pattern where windowId is the first parameter after event:

- `CLASSIC_BROWSER_CREATE_TAB`: `async (event, windowId: string, url?: string)`
- `CLASSIC_BROWSER_SWITCH_TAB`: `async (event, windowId: string, tabId: string)`
- `CLASSIC_BROWSER_CLOSE_TAB`: `async (event, windowId: string, tabId: string)`
- `CLASSIC_BROWSER_LOAD_URL`: `async (event, windowId: string, url: string)`
- `CLASSIC_BROWSER_NAVIGATE`: `async (event, windowId: string, action: string)`
- `CLASSIC_BROWSER_SET_BOUNDS`: `async (event, windowId: string, bounds: Rectangle)`
- And many more...

## Proposed Refactoring

### 1. For handlers with windowId
- Change to consistent pattern: `async (event, windowId, ...otherParams)`
- Update corresponding renderer-side API calls in preload.ts
- Update all frontend callers to match new signatures

### 2. For handlers with destructured parameters
- Consider if they need windowId (context-dependent)
- If yes, add windowId as first parameter
- If no, leave as-is but document the pattern

### 3. Update preload API signatures to match
- Ensure the window.api methods match the new handler signatures
- Maintain backward compatibility during transition if needed

## Implementation Considerations

### BROWSER_CONTEXT_MENU_ACTION Specific Analysis

The `BROWSER_CONTEXT_MENU_ACTION` handler has a complex flow:
1. Frontend overlay sends action + data (including windowId)
2. Preload wraps it as `{ action, data }`
3. Handler extracts windowId from `data.windowId`
4. ClassicBrowserService expects `(windowId, action, data)`

This could be simplified to:
- Handler signature: `async (event, windowId, action, data)`
- Preload call: `invoke(BROWSER_CONTEXT_MENU_ACTION, windowId, action, data)`
- This aligns with other Classic Browser handlers

### Benefits of Standardization
1. **Predictability**: Developers know windowId is always first
2. **Type Safety**: Easier to type check with consistent patterns
3. **Maintenance**: Less cognitive overhead when working with IPC
4. **Testing**: Simpler to mock and test handlers

### Migration Strategy
1. Update handlers one at a time
2. Update preload.ts for each handler
3. Find and update all frontend callers
4. Test each handler after migration
5. Consider using a feature flag for gradual rollout

## Related Files
- `/electron/preload.ts` - IPC bridge definitions
- `/shared/ipcChannels.ts` - Channel constants
- `/electron/bootstrap/initIPC.ts` - Handler registration