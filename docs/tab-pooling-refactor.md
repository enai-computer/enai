
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

The refactor maintains backward compatibility while significantly improving memory efficiency and window management stability through the event-driven, state-centric approach.
