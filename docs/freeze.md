# Browser Window Freeze/Unfreeze Architecture

## Overview

The freeze/unfreeze architecture enables Enai to create the appearance of multiple overlapping browser windows while working within Electron's architectural constraints. Since WebContentsViews always render above HTML content regardless of z-index settings, this system uses a snapshot-based approach to simulate window layering.

## Core Problem

In Electron applications:
- WebContentsViews (browser views) always render on top of all HTML content
- Traditional CSS z-index has no effect on WebContentsView layering
- Multiple WebContentsViews would require 150-250MB of memory each
- True window layering would require complex view removal/re-addition operations

## Architecture Components

### 1. Freeze State Machine

The system implements a four-state machine to manage browser window visibility:

#### States

- **ACTIVE**: The browser view is visible and interactive. This is the normal operating state when a window has focus.
- **CAPTURING**: The system is taking a snapshot of the current page. This is a transitional state during the async capture operation.
- **AWAITING_RENDER**: A snapshot has been captured and the system is waiting for the React component to render it in the UI.
- **FROZEN**: The snapshot is displayed as a static image and the actual browser view is hidden from view.

#### State Transitions

```
ACTIVE --[loses focus]--> CAPTURING --[snapshot taken]--> AWAITING_RENDER --[UI rendered]--> FROZEN
   ^                                                                                            |
   |------------------------[gains focus]-------------------------------------------------------|
```

### 2. ClassicBrowserSnapshotService

The snapshot service manages the capture and storage of browser view snapshots.

#### Key Features

- **Async Capture**: Uses `webContents.capturePage()` to capture the current page state
- **LRU Cache**: Maintains up to 10 snapshots using a Least Recently Used eviction policy
- **Data URL Conversion**: Converts captured images to data URLs for easy embedding in HTML
- **Security**: Skips capturing authentication URLs to protect sensitive information

#### Public Methods

- `captureSnapshot(windowId)`: Captures and stores a snapshot of the specified window
- `showAndFocusView(windowId)`: Handles the display logic when showing a view
- `clearSnapshot(windowId)`: Removes a specific snapshot from the cache
- `getSnapshot(windowId)`: Retrieves a stored snapshot
- `clearAllSnapshots()`: Removes all snapshots (used during cleanup)

### 3. Controller Hook (useBrowserWindowController)

The controller hook manages the state machine and coordinates between components.

#### Responsibilities

- **Focus Monitoring**: Watches for window focus changes and triggers state transitions
- **State Management**: Updates the freeze state in the window store
- **IPC Communication**: Calls the snapshot service through IPC channels
- **Timeout Handling**: Implements a 5-second timeout for capture operations
- **Race Condition Prevention**: Uses operation locks to prevent concurrent state changes

### 4. React Component Integration

The ClassicBrowser component renders based on the current freeze state:

```typescript
// When frozen or awaiting render, show the snapshot
{(isAwaitingRender || isFrozen) && snapshotUrl && (
  <div className="absolute inset-0">
    <img src={snapshotUrl} className="w-full h-full" />
  </div>
)}

// The actual browser view is only visible when ACTIVE
<div style={{ opacity: showWebContentsView ? 1 : 0 }}>
  {/* WebContentsView renders here */}
</div>
```

## Implementation Flow

### Freezing Process

1. **Focus Loss Detection**: The controller detects when a browser window loses focus
2. **State Transition**: Updates state from ACTIVE to CAPTURING
3. **Snapshot Capture**: IPC call to `captureSnapshot` in the main process
4. **Image Processing**: The service captures the page and converts to data URL
5. **State Update**: Transitions to AWAITING_RENDER with the snapshot URL
6. **UI Rendering**: React component renders the snapshot image
7. **Final State**: Component signals completion, state becomes FROZEN

### Unfreezing Process

1. **Focus Gain Detection**: The controller detects when a browser window gains focus
2. **State Transition**: Updates state directly to ACTIVE
3. **View Display**: IPC call to `showAndFocusView` in the main process
4. **UI Update**: React component hides snapshot and shows the live view

## IPC Architecture

### Channels

- `BROWSER_FREEZE_VIEW`: Triggers snapshot capture
- `BROWSER_UNFREEZE_VIEW`: Shows and focuses the browser view

### Main Process Handlers

```typescript
// freezeBrowserView.ts
ipcMain.handle(BROWSER_FREEZE_VIEW, async (event, windowId) => {
  const snapshotResult = await classicBrowserService.captureSnapshot(windowId);
  return snapshotResult?.snapshot || null;
});

// unfreezeBrowserView.ts
ipcMain.handle(BROWSER_UNFREEZE_VIEW, async (event, windowId) => {
  await classicBrowserService.showAndFocusView(windowId);
});
```

### Renderer Process API

```typescript
// Exposed through preload script
window.api.captureSnapshot(windowId): Promise<string | null>
window.api.showAndFocusView(windowId): Promise<void>
```

## Memory Management

### Snapshot Storage

- Maximum of 10 snapshots stored at any time
- LRU eviction when limit is reached
- Snapshots stored as base64 data URLs in memory
- Automatic cleanup on service shutdown

### Single WebContentsView Strategy

By maintaining only one active WebContentsView at a time:
- Memory usage remains constant regardless of window count
- Avoids the 150-250MB per view overhead
- Eliminates complex view lifecycle management

## Security Considerations

### Authentication URL Protection

The system includes built-in protection for authentication flows:

```typescript
if (isAuthenticationUrl(currentUrl)) {
  return undefined; // Skip snapshot capture
}
```

This prevents capturing:
- Login forms
- OAuth flows
- Password reset pages
- Other sensitive authentication states

## Integration with Window Management

### Window Store Integration

The freeze state is stored as part of the ClassicBrowserPayload:

```typescript
interface ClassicBrowserPayload {
  tabs: BrowserTab[];
  activeTabId: string;
  freezeState: BrowserFreezeState;
  tabGroupId?: string;
  tabGroupTitle?: string;
}
```

### Sidebar Hover Behavior

The notebook view includes special handling for sidebar interactions:
- Hovering over the sidebar triggers a freeze of the active browser window
- This prevents the browser from obscuring sidebar content
- The freeze is released when the sidebar is no longer hovered

## State Persistence

The freeze state is intentionally not persisted across application restarts. All windows start in the ACTIVE state when the application launches, ensuring a clean initialization without stale snapshots.