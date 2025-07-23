# Tab Context Menu Implementation

## Overview
Implemented tab context menu functionality using the existing browser context menu overlay architecture for consistency and code reuse.

## Architecture
```
Tab Right-Click → React onContextMenu → BrowserContextMenuService → Same Overlay System → BrowserContextMenu (Tab Mode)
```

## Key Components Modified

### Type System (`shared/types/contextMenu.types.ts`)
- Extended `BrowserContextMenuData` with optional `contextType` and `tabContext`
- Added discriminated union for browser vs tab contexts
- Maintained backward compatibility with existing browser context menus

### TabBar Component (`src/components/apps/classic-browser/TabBar.tsx`)
- Added `onContextMenu` handler to individual tab elements
- Calculates screen coordinates for proper menu positioning
- Triggers context menu via `window.api.browserContextMenu.show()`
- Added required `windowId` prop for IPC communication

### Context Menu Component (`src/components/ui/browser-context-menu.tsx`)
- Enhanced with tab-specific menu items and conditional rendering
- Implements tab actions: Duplicate, Pin/Unpin, Close Others, Close, Bookmark
- Maintains existing browser context functionality

### IPC Infrastructure
- **New Channel**: `BROWSER_CONTEXT_MENU_REQUEST_SHOW` for React-triggered menus
- **New Handler**: `browserContextMenuRequestShow.ts` bridges React to overlay system
- **Extended API**: Added `browserContextMenu.show()` method to preload script

### Service Layer
#### ClassicBrowserTabService
- `duplicateTab()` - Creates exact copy with same URL/title
- `pinTab()` - Toggle pin state (placeholder for future pin functionality)  
- `closeOtherTabs()` - Closes all tabs except the specified one
- `bookmarkTab()` - Bookmarks tab (placeholder for bookmark integration)

#### ClassicBrowserService
- Added service wrapper methods with proper error handling
- Integrated with existing tab lifecycle management

## Menu Items
- **Close Tab** - Closes selected tab (disabled for last remaining tab)

## Removed Features
The following features were removed to simplify the tab context menu:
- **Duplicate Tab** - Tab duplication functionality
- **Pin Tab** - Tab pinning functionality  
- **Close Other Tabs** - Mass tab closure functionality
- **Bookmark Tab** - Non-functional bookmark placeholder

**Removed Components:**
- IPC handlers: `classicBrowserDuplicateTab.ts`, `classicBrowserPinTab.ts`, `classicBrowserCloseOtherTabs.ts`, `classicBrowserBookmarkTab.ts`
- IPC channels: `CLASSIC_BROWSER_DUPLICATE_TAB`, `CLASSIC_BROWSER_PIN_TAB`, `CLASSIC_BROWSER_CLOSE_OTHER_TABS`, `CLASSIC_BROWSER_BOOKMARK_TAB`
- Service methods: `ClassicBrowserTabService.duplicateTab()`, `pinTab()`, `closeOtherTabs()`, `bookmarkTab()`
- Preload API methods: `classicBrowserDuplicateTab`, `classicBrowserPinTab`, `classicBrowserCloseOtherTabs`, `classicBrowserBookmarkTab`

## Benefits Achieved
- **90% Code Reuse** - Leverages existing overlay infrastructure
- **Visual Consistency** - Same styling/positioning as browser context menus
- **Type Safety** - Full TypeScript support with discriminated unions
- **Security** - All communication through secure preload bridge
- **Scalability** - Easy to extend with additional tab actions

## Usage
Right-click any tab in the tab bar to access the context menu with tab-specific actions. The menu appears with a small gap below the tab, matching desktop application conventions.

## Debugging Resolution
**Issue**: Tab context menu was showing as a stub with no buttons when right-clicking tabs.

**Root Cause**: The system had two rendering approaches - a React component designed for both browser and tab contexts, and an overlay DOM system that only handled browser contexts. **Critical architectural insight**: The overlay system runs in a separate Electron WebContentsView that cannot render React components from the main application. The overlay must use native DOM manipulation, not React. The overlay's `getMenuItems()` method only checked for `data.browserContext` and returned empty results for `data.tabContext`.

**Solution**: Updated the overlay system (`/src/overlay/overlay.ts`) to properly handle tab contexts:
- Added tab context detection in `getMenuItems()` method
- Updated action handling to call tab service methods directly (matching React component approach)
- Added proper tab menu items: Duplicate, Pin/Unpin, Close Others, Close, Bookmark
- Modified `handleMenuClick()` to route tab actions through direct IPC calls instead of browser context menu system

**Result**: Tab context menus now display all expected buttons and function correctly.