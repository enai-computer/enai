### Implementation Status

✅ **Completed**: Browser context menus are now implemented using a separate `BrowserContextMenu` component that uses `DropdownMenu` for programmatic control, while `AppContextMenu` remains focused on DOM element context menus using the `ContextMenu` component.

### Goals

We're trying to display React-based context menus (right-click menus) on top of WebContentsViews in the ClassicBrowser feature of your Electron app.

  The challenge is that WebContentsViews are separate native OS surfaces - you can't just use CSS/React to draw menus over them like you would with normal DOM elements.
   The React UI and the browser content live in completely isolated rendering contexts.

  The proposed solution is to create a transparent WebContentsView that sits above the browser view and hosts your React context menu. When users right-click in the
  browser, you'd show this overlay at the cursor position with your styled React menu.

  This would let you use your existing React context menu components (with Radix UI styling) for the embedded browser, rather than falling back to native Electron
  menus.

### Implementation Plan

Transparent Overlay Context Menu Implementation Plan

  Phase 1: Foundation & Infrastructure

  Goal: Set up core infrastructure and types

  1.1 Add IPC Channel Definitions

  // File: shared/ipcChannels.ts
  // Add:
  BROWSER_CONTEXT_MENU_SHOW = 'browser:context-menu:show'
  BROWSER_CONTEXT_MENU_HIDE = 'browser:context-menu:hide'
  BROWSER_CONTEXT_MENU_ACTION = 'browser:context-menu:action'
  OVERLAY_READY = 'overlay:ready'
  OVERLAY_MENU_CLOSED = 'overlay:menu-closed'

  1.2 Extend Context Menu Types

  // File: shared/types/contextMenu.types.ts
  // Add browser-specific context interface:
  interface BrowserContextMenuData {
    x: number;
    y: number;
    windowId: string;
    viewBounds: { x: number; y: number; width: number; height: number };
    browserContext: {
      linkURL?: string;
      srcURL?: string;
      pageURL: string;
      frameURL?: string;
      selectionText?: string;
      isEditable: boolean;
      canGoBack: boolean;
      canGoForward: boolean;
      canReload: boolean;
      canViewSource: boolean;
      mediaType?: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin';
      hasImageContents: boolean;
      editFlags: {
        canUndo: boolean;
        canRedo: boolean;
        canCut: boolean;
        canCopy: boolean;
        canPaste: boolean;
        canSelectAll: boolean;
      };
    };
  }

  1.3 Add Event Bus Events

  // File: services/browser/BrowserEventBus.ts
  // Add new event types:
  'view:context-menu-requested': { windowId: string; params: Electron.ContextMenuParams; viewBounds: Rectangle }
  'overlay:show-context-menu': { data: BrowserContextMenuData }
  'overlay:hide-context-menu': { windowId: string }

  Phase 2: Browser View Integration

  Goal: Capture context menu events from WebContentsView

  2.1 Add Context Menu Listener

  // File: services/browser/ClassicBrowserViewManager.ts
  // In setupWebContentsListeners method, add:
  wc.on('context-menu', (event, params) => {
    event.preventDefault();
    this.deps.eventBus.emit('view:context-menu-requested', {
      windowId,
      params,
      viewBounds: view.getBounds()
    });
  });

  2.2 Add Overlay Management Properties

  // File: services/browser/ClassicBrowserViewManager.ts
  // Add to class:
  private overlayViews: Map<string, WebContentsView> = new Map();
  private overlayTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private activeOverlayWindowId: string | null = null;

  2.3 Implement Overlay Creation Method

  // File: services/browser/ClassicBrowserViewManager.ts
  // Add methods:
  private createOverlayView(windowId: string): WebContentsView
  private getAppURL(): string  // Get the app URL based on environment
  private setupOverlayListeners(overlay: WebContentsView, windowId: string): void

  Phase 3: Overlay Lifecycle Management

  Goal: Handle overlay show/hide/destroy lifecycle

  3.1 Show Overlay Method

  // File: services/browser/ClassicBrowserViewManager.ts
  public async showContextMenuOverlay(windowId: string, contextData: BrowserContextMenuData): Promise<void>
  // - Create or reuse overlay
  // - Position at cursor location
  // - Add to mainWindow contentView
  // - Send context data via IPC

  3.2 Hide Overlay Method

  // File: services/browser/ClassicBrowserViewManager.ts
  public hideContextMenuOverlay(windowId: string): void
  // - Remove from contentView
  // - Set timeout for cleanup
  // - Clear active overlay tracking

  3.3 Destroy Overlay Method

  // File: services/browser/ClassicBrowserViewManager.ts
  private destroyOverlay(windowId: string): void
  // - Clean up webContents
  // - Remove from maps
  // - Clear timeouts

  3.4 Update Cleanup Methods

  // File: services/browser/ClassicBrowserViewManager.ts
  // Update existing cleanup() method to handle overlays
  // Update destroyBrowserView() to also destroy associated overlay

  Phase 4: React Overlay Application

  Goal: Create the React side of the overlay

  4.1 Create Overlay Route

  // File: src/app/overlay/[windowId]/page.tsx
  // Create new route that:
  // - Renders transparent background
  // - Loads only necessary context menu components
  // - Handles IPC communication

  4.2 Create Browser Context Menu Component

  // File: src/components/ui/browser-context-menu.tsx
  // Dedicated component for browser context menus:
  // - Uses DropdownMenu for controlled positioning
  // - Accepts contextData prop with browser-specific data
  // - Accepts onClose callback for overlay dismissal
  // - Positions at exact cursor coordinates
  // - Handles browser-specific actions via IPC
  // - Manages escape key and click-outside dismissal

  4.3 Create Overlay IPC Hook

  // File: src/hooks/useBrowserContextMenuOverlay.ts
  // Hook that:
  // - Listens for show/hide events
  // - Manages overlay state
  // - Handles action callbacks
  // - Communicates menu close events

  Phase 5: IPC Bridge & Handlers

  Goal: Connect browser views to overlay

  5.1 Create Overlay IPC Handlers

  // File: electron/ipc/overlayHandlers.ts
  // Handlers for:
  // - overlay:ready
  // - overlay:menu-closed
  // - browser:context-menu:action

  5.2 Update Classic Browser Service

  // File: services/ClassicBrowserService.ts
  // Add context menu handling:
  // - Subscribe to view:context-menu-requested events
  // - Transform params to BrowserContextMenuData
  // - Call showContextMenuOverlay on view manager

  5.3 Add Preload API Methods

  // File: electron/preload.ts
  // Add to window.api:
  browserContextMenu: {
    onShow: (callback) => void
    onHide: (callback) => void
    sendAction: (action, data) => void
    notifyReady: () => void
    notifyClosed: () => void
  }

  Phase 6: Browser-Specific Actions

  Goal: Implement browser context menu actions

  6.1 Browser Actions in BrowserContextMenu

  // Implemented in BrowserContextMenu component
  // Actions include:
  // - Back/Forward navigation
  // - Reload/Stop
  // - Open in new tab
  // - Save image
  // - Copy link/image address
  // - Inspect element
  // - View source

  6.2 Implement Action Handlers

  // File: services/browser/ClassicBrowserNavigationService.ts
  // Add methods for:
  // - executeContextMenuAction(windowId, action, data)
  // - Handle each action type

  6.3 Connect Actions to Browser

  // Update IPC flow to execute actions on the correct WebContentsView

  Phase 7: Polish & Edge Cases

  Goal: Handle edge cases and polish UX

  7.1 Z-Order Management

  - Update syncViewStackingOrder to maintain overlay on top
  - Handle overlay during view switching

  7.2 Multi-Window Support

  - Ensure each window has independent overlay
  - Clean up overlays when windows close

  7.3 Performance Optimization

  - Lazy load overlay only when first needed
  - Implement efficient hide/show without recreation
  - Memory cleanup on timeout

  7.4 Accessibility

  - Keyboard navigation support
  - Screen reader announcements
  - Focus management

  7.5 Error Handling

  - Handle overlay creation failures
  - Graceful fallback to native menu
  - Recovery from crashed overlays

  Phase 8: Testing

  Goal: Comprehensive test coverage

  8.1 Unit Tests

  - ClassicBrowserViewManager overlay methods
  - Context menu data transformation
  - Action handlers

  8.2 Integration Tests

  - Full IPC flow from right-click to action execution
  - Multi-window scenarios
  - Cleanup and lifecycle

  8.3 Visual Tests

  - Storybook stories for browser context menu
  - Different context types (link, image, selection, etc.)

  ---
  Implementation Order

  1. Start with Phase 1-2: Get basic event capture working
  2. Then Phase 3-4: Create minimal overlay that shows/hides
  3. Then Phase 5: Connect everything with IPC
  4. Then Phase 6: Add actual browser actions
  5. Finally Phase 7-8: Polish and test



###  High-Level Strategy (rough ideas)

  Here's how I'd integrate it with your existing system:

  // In ClassicBrowserViewManager
  class ClassicBrowserViewManager {
    private overlayView?: WebContentsView;
    private currentBrowserView?: WebContentsView;

    private createOverlayView(windowId: string): WebContentsView {
      const overlay = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, '../preload.js'),
          contextIsolation: true,
          sandbox: true,
          transparent: true
        }
      });

      overlay.setBackgroundColor('#00000000');
      overlay.setAutoResize({ width: true, height: true });

      // Load a dedicated overlay route
      overlay.webContents.loadURL(`${this.getAppURL()}#/overlay/${windowId}`);

      return overlay;
    }

    private setupWebContentsListeners(view: WebContentsView, windowId: string) {
      // Add to existing listeners
      view.webContents.on('context-menu', (event, params) => {
        event.preventDefault();

        if (!this.overlayView) {
          this.overlayView = this.createOverlayView(windowId);
          this.mainWindow?.contentView.addChildView(this.overlayView);
        }

        // Forward to overlay with browser-specific context
        this.overlayView.webContents.send('browser-context-menu', {
          x: params.x,
          y: params.y,
          windowId,
          browserContext: {
            linkURL: params.linkURL,
            srcURL: params.srcURL,
            pageURL: view.webContents.getURL(),
            selectionText: params.selectionText,
            isEditable: params.isEditable,
            canGoBack: view.webContents.canGoBack(),
            canGoForward: view.webContents.canGoForward()
          }
        });
      });
    }
  }

⏺ Integration Points

  1. Create an overlay route in your React app:
  // app/overlay/[windowId]/page.tsx
  export default function OverlayPage({ params }: { params: { windowId: string } }) {
    const { contextMenuData, hideMenu } = useBrowserContextMenuOverlay(params.windowId);
    
    return (
      <BrowserContextMenu
        contextData={contextMenuData}
        onClose={hideMenu}
      />
    );
  }

  2. Create BrowserContextMenu for overlay mode:
  // BrowserContextMenu uses DropdownMenu component
  // Features:
  // - Renders at fixed position from contextData.x/y
  // - Shows browser-specific menu items
  // - Handles click-outside and escape key detection
  // - Communicates actions back via IPC
  
  3. AppContextMenu remains focused on DOM elements:
  // AppContextMenu uses ContextMenu component
  // Only handles natural right-click on DOM elements

  4. Handle positioning and click-through:
  // Position the menu at cursor coordinates
  overlay.setBounds({
    x: params.x - 10, // Offset for visual alignment
    y: params.y - 10,
    width: 300, // Menu width
    height: 400 // Max menu height
  });

  // Make non-menu areas click-through
  overlay.webContents.executeJavaScript(`
    document.body.style.pointerEvents = 'none';
    document.querySelector('.context-menu').style.pointerEvents = 'auto';
  `);


⏺ Potential Issues & Solutions

  1. Z-ordering complexity:
    - Since you might have multiple browser views, ensure the overlay stays on top
    - Solution: Re-add the overlay view after any browser view changes
  2. Focus management:
    - The overlay might steal focus from the browser view
    - Solution: Use focusable: false in webPreferences and manage focus programmatically
  3. Performance with animations:
    - Transparent overlays can impact GPU performance
    - Solution: Hide the overlay when not in use, destroy after timeout
  4. Multi-window support:
    - Each window needs its own overlay
    - Solution: Track overlays per window in a Map


References:
https://github.com/electron/electron/issues/42077
https://github.com/electron/electron/issues/17655
https://github.com/electron/electron/issues/8389
https://electronjs.org/es/docs/latest/tutorial/window-customization
https://stackoverflow.com/questions/53357428/how-to-make-mouse-pass-through-window-in-electron
https://www.reddit.com/r/electronjs/comments/xc2a22/best_method_for_browserwindow_overlay
