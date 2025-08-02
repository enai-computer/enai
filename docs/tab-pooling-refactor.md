
# Tab Pooling Architecture Refactor

This document outlines the refactoring of the browser architecture to use a global pool of `WebContentsView` instances, improving memory usage and stability.

## Previous Architecture

The previous architecture used a single `WebContentsView` per browser window. This was simple to implement but had several drawbacks:

- **High Memory Usage:** Each browser window consumed a significant amount of memory, even if it was not visible.
- **Slow Window Creation:** Creating a new browser window was slow, as it required creating a new `WebContentsView` instance.
- **State Management Complexity:** State was spread across multiple services, leading to race conditions and state-mismatch bugs.

## New Architecture

The new architecture uses a global pool of 5 `WebContentsView` instances, shared across all browser windows. This approach has several advantages:

- **Low Memory Usage:** The number of `WebContentsView` instances is fixed, regardless of the number of open browser windows.
- **Fast Window Creation:** Creating a new browser window is fast, as it only requires creating a new window and attaching an existing `WebContentsView` from the pool.
- **Improved Stability:** The new architecture is more stable and less prone to race conditions, as it uses a state-centric, event-driven approach.

### Service Responsibilities

The new architecture is composed of the following services:

- **`ClassicBrowserStateService`:** The single source of truth for all browser state. It holds the state of all tabs and windows and emits a `state-changed` event whenever the state changes.
- **`ClassicBrowserTabService`:** Handles tab-related user actions (create, switch, close) by calling methods on the `ClassicBrowserStateService`.
- **`GlobalTabPool`:** Manages a global pool of `WebContentsView` instances. It's a "dumb" factory and pool that is controlled by the `ClassicBrowserViewManager`.
- **`ClassicBrowserViewManager`:** The presentation layer. It listens for the `state-changed` event from the `ClassicBrowserStateService` and makes the UI match the state.
- **`ClassicBrowserNavigationService`:** Handles navigation-related actions (URL loading, back, forward, etc.).
- **`ClassicBrowserService`:** The main entry point for all browser-related operations. It delegates to the other services to handle the actual logic.

### Workflow Example: Creating a New Tab

1.  **Action:** A user action triggers `ClassicBrowserService.createTab(windowId, url)`.
2.  **State Modification:** `ClassicBrowserService` calls `ClassicBrowserTabService.createTab(windowId, url)`. The `TabService` adds a new `TabState` object to the `ClassicBrowserStateService` and sets it as the active tab for that window.
3.  **Event Emission:** The `StateService` emits a `state-changed` event on the `BrowserEventBus`, containing the new, complete state for `windowId`.
4.  **Presentation Update:** The `ClassicBrowserViewManager`, which is listening for this event, reacts:
    a. It sees the `activeTabId` for `windowId` has changed.
    b. It calls `globalTabPool.acquireView(newTabId)`. The pool finds or creates a view and returns it.
    c. The `ViewManager` gets the correct bounds for `windowId`.
    d. It calls `view.setBounds(...)` and `mainWindow.contentView.addChildView(view)`.
    e. It calls `view.webContents.loadURL(...)`.

## Implementation Status

✅ **COMPLETED** - Tab pooling architecture refactor is now complete with the following implementations:

### Core Services Implemented
- **`WindowLifecycleService`**: Bridges window store state changes to browser events, enabling browser services to react to window lifecycle changes like focus, minimize, restore, and z-order updates.
- **`ClassicBrowserStateService`**: Single source of truth for browser state management
- **`ClassicBrowserTabService`**: Handles tab operations (create, switch, close)
- **`GlobalTabPool`**: Manages pool of WebContentsView instances
- **`ClassicBrowserViewManager`**: Presentation layer that syncs UI with state
- **`ClassicBrowserNavigationService`**: Handles navigation actions

### IPC Layer
- **`windowLifecycleHandler`**: IPC handler for window lifecycle operations
- Updated IPC channels and API types for window lifecycle management

### Frontend Integration
- **`useWindowLifecycleSync`**: React hook that syncs window store state with browser services
- Updated `NotebookView` component to integrate window lifecycle synchronization
- Enhanced test mocks and helpers for new architecture

### Build System
- Fixed TypeScript compilation errors in service dependencies
- Updated test bootstrap configuration for new service architecture
- All build targets now compile successfully

## Post-Implementation Issues and Fixes

During initial testing, several critical issues were discovered and resolved:

### 🐛 **Issue 1: Tab Positioning Problems**
**Problem**: Second tabs appeared as separate windows outside the browser window instead of being properly contained.

**Root Cause**: Incorrect view-window mapping logic in `ClassicBrowserViewManager.findTabIdForView()` was treating `windowId` keys as `tabId` values.

**Solution**: 
- Fixed the lookup logic to properly map views to their active tabs via state service
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Method**: `findTabIdForView()` - corrected to look up active tab from window state
- Enhanced `attachView()` to prevent double-attachment by checking existing children
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Method**: `attachView()` - added check for existing children before attachment
- Added proper bounds updating for views when browser windows move/resize
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Method**: `handleStateChange()` - added bounds update for active views

### 🐛 **Issue 2: WebContentsView Lifecycle Issues**
**Problem**: "WebContentsView for active tab not found" errors when loading URLs on new tabs.

**Root Cause**: Race conditions where views weren't properly acquired or were prematurely released during tab switches.

**Solution**:
- Added fallback view acquisition in `ClassicBrowserNavigationService.loadUrl()`
  - **File**: `services/browser/ClassicBrowserNavigationService.ts`
  - **Method**: `loadUrl()` - automatic view acquisition if not found in pool
- Simplified tab cleanup to avoid over-aggressive view releases
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Method**: `handleStateChange()` - removed complex mapping logic
- Enhanced view management to properly track active and detached views
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Methods**: `handleWindowMinimized()`, `handleWindowRestored()`

### 🐛 **Issue 3: Incomplete Cleanup on Window Close**
**Problem**: WebContentsViews and tabs weren't being properly destroyed when browser windows were closed, leading to memory leaks.

**Root Cause**: Cleanup operations weren't properly awaiting async view releases and didn't handle all lifecycle states.

**Solution**:
- Made `destroyBrowserView()` async to properly handle async cleanup operations
  - **File**: `services/browser/ClassicBrowserService.ts`
  - **Method**: `destroyBrowserView()` - converted to async with proper awaiting
- Added `cleanupWindow()` method to `ClassicBrowserViewManager` for proper view detachment
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Method**: `cleanupWindow()` - new method for window-specific cleanup
- Enhanced `GlobalTabPool.destroyView()` to properly clean up WebContents resources:
  - **File**: `services/browser/GlobalTabPool.ts`
  - **Method**: `destroyView()` - comprehensive WebContents cleanup
  - Remove all event listeners
  - Stop loading and mute audio
  - Properly destroy view instances
- Implemented parallel cleanup for better performance
  - **File**: `services/browser/ClassicBrowserService.ts`
  - **Method**: `destroyAllBrowserViews()` - parallel processing with Promise.all

### 🐛 **Issue 4: Tab Metadata Not Updating (Names and Icons)**
**Problem**: Tab names remained stuck as "New Tab" and favicons weren't loading. The tab pooling refactor broke the connection between WebContents events and tab state updates.

**Root Cause**: In the single WebContentsView architecture, `ClassicBrowserViewManager` listened to WebContents events and emitted them via `BrowserEventBus`, which `ClassicBrowserService` then used to update tab metadata. The tab pooling refactor moved WebContents event handling to `GlobalTabPool` but never connected it back to the state service.

**Solution**: Restored the EventBus pattern from the single WebContentsView architecture:
- **Enhanced GlobalTabPool Dependencies**:
  - **File**: `services/browser/GlobalTabPool.ts`
  - **Added**: `BrowserEventBus` dependency and window ID mapping (`tabToWindowMapping`)
  - **Enhanced**: `acquireView()` to accept `windowId` parameter for event context
- **Implemented WebContents Event Emission**:
  - **File**: `services/browser/GlobalTabPool.ts`
  - **Enhanced**: Existing `page-title-updated` listener to emit `view:page-title-updated` events
  - **Added**: Missing `page-favicon-updated` listener to emit `view:page-favicon-updated` events
  - **Both**: Include window context and emit through BrowserEventBus
- **Added Event Listeners in ClassicBrowserService**:
  - **File**: `services/browser/ClassicBrowserService.ts`
  - **Added**: `initialize()` method with listeners for `view:page-title-updated` and `view:page-favicon-updated`
  - **Implementation**: Listeners call `stateService.updateTab()` to update active tab metadata
  - **Added**: Proper cleanup in `cleanup()` method to remove event listeners
- **Updated Service Integration**:
  - **File**: `electron/bootstrap/serviceBootstrap.ts`
  - **Updated**: GlobalTabPool instantiation to provide `eventBus` dependency
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
  - **Updated**: `acquireView()` calls to pass `windowId` for proper event context
  - **File**: `services/browser/ClassicBrowserStateService.ts`
  - **Added**: Public `getEventBus()` method for other services to access EventBus

**Event Flow Restored**:
```
WebContents → GlobalTabPool (capture & emit) → BrowserEventBus → ClassicBrowserService (listen & update) → StateService → UI
```

**Result**: Tab names now update from "New Tab" to actual page titles, and favicons load correctly as pages load.

### 🔧 **Additional Enhancements**
- **Bounds Management**: Views now properly update their bounds when browser windows move or resize
  - **File**: `services/browser/ClassicBrowserViewManager.ts`
- **Error Handling**: Added comprehensive error handling and graceful fallbacks
  - **Files**: `services/browser/ClassicBrowserNavigationService.ts`, `services/browser/GlobalTabPool.ts`
- **Memory Safety**: Ensured proper cleanup of all resources during window lifecycle events
  - **File**: `services/browser/GlobalTabPool.ts` - enhanced `cleanup()` method
- **Type Safety**: Added missing IPC channels and method signatures
  - **Files**: `shared/ipcChannels.ts`, `services/browser/ClassicBrowserService.ts`
  - **Added**: `CLASSIC_BROWSER_TRANSFER_TAB_TO_NOTEBOOK` channel and `transferTabToNotebook()` method

The refactor now maintains backward compatibility while providing robust memory efficiency, proper view lifecycle management, stable window positioning behavior, and complete tab metadata functionality.
