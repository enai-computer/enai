import { BrowserWindow, WebContentsView } from 'electron';
import * as path from 'path';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserPayload, TabState } from '../../shared/types';
import { BrowserContextMenuData } from '../../shared/types/contextMenu.types';
import { CLASSIC_BROWSER_VIEW_FOCUSED, BROWSER_CONTEXT_MENU_SHOW, BROWSER_CONTEXT_MENU_HIDE } from '../../shared/ipcChannels';
import { BrowserEventBus } from './BrowserEventBus';

/**
 * Dependencies for ClassicBrowserViewManager
 */
export interface ClassicBrowserViewManagerDeps {
  mainWindow: BrowserWindow;
  eventBus: BrowserEventBus;
}

/**
 * ClassicBrowserViewManager
 * 
 * Responsible for the raw WebContentsView lifecycle:
 * - Creating, destroying, and managing the physical state (bounds, visibility) of WebContentsView instances
 * - Managing the views Map
 * - Handling WebContentsView events and delegating them via BrowserEventBus
 * - Managing prefetch views for favicon loading
 */
export class ClassicBrowserViewManager extends BaseService<ClassicBrowserViewManagerDeps> {
  private views: Map<string, WebContentsView> = new Map();
  private prefetchViews: Map<string, WebContentsView> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private overlayViews: Map<string, WebContentsView> = new Map();
  private overlayTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private activeOverlayWindowId: string | null = null;

  constructor(deps: ClassicBrowserViewManagerDeps) {
    super('ClassicBrowserViewManager', deps);
  }

  /**
   * Initialize the service and start cleanup interval
   */
  async initialize(): Promise<void> {
    this.startPrefetchCleanup();
  }

  /**
   * Get a view by windowId
   */
  public getView(windowId: string): WebContentsView | undefined {
    return this.views.get(windowId);
  }

  /**
   * Get all window IDs that have active WebContentsViews
   */
  public getActiveViewWindowIds(): string[] {
    return Array.from(this.views.keys());
  }

  /**
   * Create a WebContentsView with the given state
   */
  public createViewWithState(windowId: string, bounds: Electron.Rectangle, browserState: ClassicBrowserPayload): void {
    // Log Electron version
    this.logDebug('Electron version:', process.versions.electron);

    const securePrefs: Electron.WebPreferences = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: undefined, // Do not use the app's preload in the embedded browser
      webSecurity: true,
      // Enable plugins to support PDF viewer
      plugins: true,
    };

    const view = new WebContentsView({ webPreferences: securePrefs });
    this.views.set(windowId, view);

    // Set initial background to transparent
    view.setBackgroundColor('#00000000');
    this.logDebug(`Set initial transparent background for window ${windowId}`);

    // Apply border radius to the native view
    // WebLayer uses 18px border radius, regular windows use 10px (12px - 2px border inset)
    const borderRadius = windowId === '__WEBLAYER_SINGLETON__' ? 18 : 10;
    (view as any).setBorderRadius(borderRadius);
    this.logDebug(`✅ setBorderRadius called for windowId: ${windowId} with radius: ${borderRadius}px`);

    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) {
      this.logError('Main window is not available to attach WebContentsView.');
      this.views.delete(windowId); // Clean up
      throw new Error('Main window not available.');
    }

    // Set bounds and add to window
    view.setBounds(bounds);
    this.deps.mainWindow.contentView.addChildView(view);

    // Set up all WebContentsView event listeners
    this.setupWebContentsListeners(windowId, view, browserState);

    this.logDebug(`WebContentsView for windowId ${windowId} created and listeners attached.`);
  }

  /**
   * Set up all event listeners for a WebContentsView
   */
  private setupWebContentsListeners(windowId: string, view: WebContentsView, browserState: ClassicBrowserPayload): void {
    const wc = view.webContents;


    // Loading events
    wc.on('did-start-loading', () => {
      this.logDebug(`windowId ${windowId}: did-start-loading`);
      this.deps.eventBus.emit('view:did-start-loading', { windowId });
    });

    wc.on('did-stop-loading', () => {
      this.logDebug(`windowId ${windowId}: did-stop-loading`);
      this.deps.eventBus.emit('view:did-stop-loading', {
        windowId,
        url: wc.getURL(),
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    });

    // Navigation events
    wc.on('did-navigate', async (_event, url, _httpResponseCode, _httpStatusText) => {
      this.logDebug(`windowId ${windowId}: did-navigate to ${url}`);
      this.deps.eventBus.emit('view:did-navigate', {
        windowId,
        url,
        isMainFrame: true, // did-navigate is always main frame
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    });

    wc.on('did-navigate-in-page', async (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.logDebug(`windowId ${windowId}: did-navigate-in-page to ${url}`);
      this.deps.eventBus.emit('view:did-navigate-in-page', {
        windowId,
        url,
        isMainFrame,
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    });

    // Title and favicon updates
    wc.on('page-title-updated', (_event, title) => {
      this.logDebug(`windowId ${windowId}: page-title-updated to ${title}`);
      this.deps.eventBus.emit('view:page-title-updated', { windowId, title });
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      this.logDebug(`windowId ${windowId}: page-favicon-updated with ${favicons.length} favicons`);
      this.deps.eventBus.emit('view:page-favicon-updated', { windowId, faviconUrl: favicons });
    });

    // Error handling
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: did-fail-load for ${validatedURL}. Code: ${errorCode}, Desc: ${errorDescription}`);
      this.deps.eventBus.emit('view:did-fail-load', {
        windowId,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
        currentUrl: wc.getURL(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    });

    wc.on('render-process-gone', (_event, details) => {
      this.logError(`windowId ${windowId}: render-process-gone. Reason: ${details.reason}`);
      this.deps.eventBus.emit('view:render-process-gone', { windowId, details });
    });

    // Window open handling
    wc.setWindowOpenHandler((details) => {
      this.logDebug(`[setWindowOpenHandler] Intercepted window open request`, details);
      this.deps.eventBus.emit('view:window-open-request', { windowId, details });
      // The handler in ClassicBrowserService will decide what to do
      return { action: 'deny' };
    });

    // Will-navigate handling (including CMD+click via custom protocol)
    wc.on('will-navigate', (event, url) => {
      this.deps.eventBus.emit('view:will-navigate', { windowId, event, url });
    });

    // Redirect events
    wc.on('will-redirect', (event, url, isInPlace, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: will-redirect to ${url}, isInPlace: ${isInPlace}, isMainFrame: ${isMainFrame}`);
    });

    wc.on('did-redirect-navigation', (event, url, isInPlace, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: did-redirect-navigation to ${url}, isInPlace: ${isInPlace}, isMainFrame: ${isMainFrame}`);
      this.deps.eventBus.emit('view:did-redirect-navigation', { windowId, url });
    });

    wc.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: did-start-navigation to ${url}, isInPlace: ${isInPlace}, isMainFrame: ${isMainFrame}`);
    });

    // Iframe handling
    wc.on('did-attach-webview', (event, webContents) => {
      this.logDebug(`windowId ${windowId}: Attached webview, setting up handlers`);
      webContents.setWindowOpenHandler((details) => {
        this.logDebug(`windowId ${windowId}: Iframe intercepted new window request to ${details.url}`);
        this.deps.eventBus.emit('view:iframe-window-open-request', { windowId, details });
        return { action: 'deny' };
      });
    });

    // Focus handling
    wc.on('focus', () => {
      this.logDebug(`windowId ${windowId}: WebContentsView received focus.`);
      if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
        this.deps.mainWindow.webContents.send(CLASSIC_BROWSER_VIEW_FOCUSED, { windowId });
      }
    });

    // Context menu handling
    wc.on('context-menu', (event, params) => {
      event.preventDefault();
      this.logDebug(`windowId ${windowId}: context-menu requested at ${params.x}, ${params.y}`);
      this.deps.eventBus.emit('view:context-menu-requested', {
        windowId,
        params,
        viewBounds: view.getBounds()
      });
    });
  }

  /**
   * Create a browser view - delegates to createViewWithState
   */
  public createBrowserView(windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): void {
    this.createViewWithState(windowId, bounds, payload);
  }

  /**
   * Destroy a specific browser view
   */
  public async destroyBrowserView(windowId: string): Promise<void> {
    this.logDebug(`[DESTROY] Attempting to destroy WebContentsView for windowId: ${windowId}`);

    const view = this.views.get(windowId);
    if (!view) {
      this.logWarn(`[DESTROY] No WebContentsView found for windowId ${windowId}. Nothing to destroy.`);
      return;
    }

    // Remove from map immediately to prevent race conditions
    this.views.delete(windowId);
    this.logDebug(`[DESTROY] Found and removed view for ${windowId} from map. Proceeding with destruction.`);

    // Detach from window if attached
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      try {
        if (this.deps.mainWindow.contentView && this.deps.mainWindow.contentView.children.includes(view)) {
          this.deps.mainWindow.contentView.removeChildView(view);
        }
      } catch (error) {
        this.logWarn(`[DESTROY] Error detaching view from window (might already be detached):`, error);
      }
    }

    // Stop any media playback and cleanup before destroying
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) {
      try {
        // Mute audio immediately to stop sound
        wc.setAudioMuted(true);

        // Stop any pending loads
        wc.stop();

        // Only try to execute JavaScript if the page has loaded and not crashed
        if (!wc.isLoading() && !wc.isCrashed()) {
          try {
            // Execute JavaScript to pause all media elements
            await wc.executeJavaScript(`
              (function() {
                try {
                  // Pause all video elements
                  const videos = document.querySelectorAll('video');
                  videos.forEach(video => {
                    try {
                      video.pause();
                      video.currentTime = 0;
                    } catch (e) {}
                  });
                  
                  // Pause all audio elements
                  const audios = document.querySelectorAll('audio');
                  audios.forEach(audio => {
                    try {
                      audio.pause();
                      audio.currentTime = 0;
                    } catch (e) {}
                  });
                  
                  // YouTube specific: stop via YouTube API if available
                  if (typeof window !== 'undefined' && window.YT) {
                    try {
                      const players = document.querySelectorAll('.html5-video-player');
                      players.forEach(player => {
                        if (player.pauseVideo) player.pauseVideo();
                      });
                    } catch (e) {}
                  }
                } catch (e) {
                  // Ignore errors, best effort cleanup
                }
                return true;
              })();
            `, true); // Add userGesture to be safe
          } catch (scriptError) {
            // Ignore script errors, continue with destruction
            this.logDebug(`windowId ${windowId}: Script execution error during cleanup (ignored):`, scriptError);
          }
        }

        // Small delay to ensure media cleanup takes effect
        await new Promise(resolve => setTimeout(resolve, 50));

        this.logDebug(`windowId ${windowId}: Stopped media playback and cleared page.`);
      } catch (error) {
        this.logWarn(`windowId ${windowId}: Error during media cleanup (ignored):`, error);
      }
    }

    // Finally, destroy the webContents
    if (view.webContents && !view.webContents.isDestroyed()) {
      (view.webContents as any).destroy();
    }

    // Also destroy any associated overlay
    this.destroyOverlay(windowId);

    this.logDebug(`windowId ${windowId}: WebContentsView destruction process completed.`);
  }

  /**
   * Destroy all browser views
   */
  public async destroyAllBrowserViews(): Promise<void> {
    this.logDebug('Destroying all WebContentsViews.');
    const destroyPromises = Array.from(this.views.keys()).map(windowId =>
      this.destroyBrowserView(windowId)
    );
    await Promise.all(destroyPromises);
  }

  /**
   * Set bounds for a view
   */
  public setBounds(windowId: string, bounds: Electron.Rectangle): void {
    const view = this.views.get(windowId);
    if (!view) {
      // Don't warn for setBounds - this is expected during initialization
      this.logDebug(`setBounds: No WebContentsView found for windowId ${windowId}. Skipping.`);
      return;
    }

    // Validate bounds to prevent invalid values
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      this.logDebug(`setBounds: Invalid bounds for windowId ${windowId}. Skipping.`);
      return;
    }

    this.logDebug(`windowId ${windowId}: Setting bounds to ${JSON.stringify(bounds)}`);
    view.setBounds(bounds);
  }

  /**
   * Set visibility for a view
   */
  public setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused: boolean): void {
    const view = this.views.get(windowId);
    if (!view) {
      // Don't warn for setVisibility - this might be called during cleanup
      this.logDebug(`setVisibility: No WebContentsView found for windowId ${windowId}. Skipping.`);
      return;
    }

    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) {
      this.logError('setVisibility: Main window is not available.');
      return;
    }

    this.logDebug(`windowId ${windowId}: Setting visibility - shouldBeDrawn: ${shouldBeDrawn}, isFocused: ${isFocused}`);

    const viewIsAttached = this.deps.mainWindow.contentView.children.includes(view);

    if (shouldBeDrawn) {
      // Make the view visible
      (view as any).setVisible(true);

      // The view ordering is now handled by the renderer through syncViewStackingOrder
      // We only need to ensure the view is attached
      if (!viewIsAttached) {
        this.deps.mainWindow.contentView.addChildView(view);
        this.logDebug(`windowId ${windowId}: Attached WebContentsView.`);
      }
    } else {
      // Not to be drawn (e.g., minimized or window explicitly hidden)
      (view as any).setVisible(false); // Make it not drawable
      this.logDebug(`windowId ${windowId}: Set WebContentsView to not visible because shouldBeDrawn is false.`);
      if (viewIsAttached) {
        this.deps.mainWindow.contentView.removeChildView(view);
        this.logDebug(`windowId ${windowId}: Removed WebContentsView from contentView because shouldBeDrawn is false.`);
      }
    }
  }

  /**
   * Set the background color of the WebContentsView
   */
  public setBackgroundColor(windowId: string, color: string): void {
    const view = this.views.get(windowId);
    if (!view) {
      this.logDebug(`setBackgroundColor: No WebContentsView found for windowId ${windowId}. Skipping.`);
      return;
    }

    try {
      view.setBackgroundColor(color);
      this.logDebug(`Set background color for window ${windowId} to ${color}`);
    } catch (error) {
      this.logError(`Error setting background color for window ${windowId}:`, error);
    }
  }

  /**
   * Synchronize WebContentsView stacking order based on window z-indices
   */
  public syncViewStackingOrder(windowsInOrder: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): void {
    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) {
      this.logWarn('[syncViewStackingOrder] Main window is not available');
      return;
    }

    this.logDebug(`[syncViewStackingOrder] Syncing view order for ${windowsInOrder.length} windows`);

    // Build a list of views that should be visible
    const viewsToShow: Array<{ windowId: string; view: WebContentsView }> = [];
    const viewsToHide = new Set<string>();

    // First pass: determine which views should be shown/hidden
    for (const window of windowsInOrder) {
      const view = this.views.get(window.id);
      if (!view) continue;

      const shouldBeVisible = !window.isFrozen && !window.isMinimized;

      if (shouldBeVisible) {
        viewsToShow.push({ windowId: window.id, view });
      } else {
        viewsToHide.add(window.id);
      }
    }

    // Second pass: hide views that shouldn't be visible
    for (const windowId of viewsToHide) {
      const view = this.views.get(windowId);
      if (view && this.deps.mainWindow.contentView.children.includes(view)) {
        try {
          this.deps.mainWindow.contentView.removeChildView(view);
          this.logDebug(`[syncViewStackingOrder] Removed hidden view ${windowId}`);
        } catch (error) {
          this.logWarn(`[syncViewStackingOrder] Error removing view ${windowId}:`, error);
        }
      }
    }

    // Third pass: ensure visible views are in the correct order
    const currentChildren = this.deps.mainWindow.contentView.children;
    let needsReorder = false;

    // Check if views are already in the correct order
    if (currentChildren.length === viewsToShow.length) {
      for (let i = 0; i < viewsToShow.length; i++) {
        if (currentChildren[i] !== viewsToShow[i].view) {
          needsReorder = true;
          break;
        }
      }
    } else {
      needsReorder = true;
    }

    if (needsReorder) {
      this.logDebug('[syncViewStackingOrder] Reordering views');

      // Remove only the views that need to be reordered
      for (const { view } of viewsToShow) {
        if (this.deps.mainWindow.contentView.children.includes(view)) {
          try {
            this.deps.mainWindow.contentView.removeChildView(view);
          } catch (error) {
            this.logWarn('[syncViewStackingOrder] Error removing view for reorder:', error);
          }
        }
      }

      // Add views back in the correct order
      for (const { windowId, view } of viewsToShow) {
        try {
          this.deps.mainWindow.contentView.addChildView(view);
          this.logDebug(`[syncViewStackingOrder] Added view ${windowId} in correct position`);
        } catch (error) {
          this.logWarn(`[syncViewStackingOrder] Error adding view ${windowId}:`, error);
        }
      }
    } else {
      this.logDebug('[syncViewStackingOrder] Views already in correct order, no changes needed');
    }

    this.logDebug('[syncViewStackingOrder] View stacking order synchronized');
  }

  /**
   * Prefetch favicon for a URL without displaying the window.
   * This creates a hidden WebContentsView that loads the page just enough to get the favicon.
   */
  async prefetchFavicon(windowId: string, url: string): Promise<string | null> {
    this.logDebug(`[prefetchFavicon] Starting favicon prefetch for ${windowId} with URL: ${url}`);
    
    // Don't prefetch for file:// URLs (PDFs, local files)
    if (url.startsWith('file://')) {
      this.logDebug(`[prefetchFavicon] Skipping file:// URL for ${windowId}`);
      return null;
    }

    // Clean up any existing prefetch view for this window
    const existingView = this.prefetchViews.get(windowId);
    if (existingView) {
      this.logDebug(`[prefetchFavicon] Cleaning up existing prefetch view for ${windowId}`);
      if (existingView.webContents && !existingView.webContents.isDestroyed()) {
        (existingView.webContents as Electron.WebContents & { destroy?: () => void }).destroy?.();
      }
      this.prefetchViews.delete(windowId);
    }

    return new Promise((resolve) => {
      try {
        // Create a hidden WebContentsView for prefetching
        const prefetchView = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            javascript: false, // Disable JS for security and performance
            images: false, // Don't load images, we only need the favicon
            webgl: false,
            plugins: false,
          }
        });

        this.prefetchViews.set(windowId, prefetchView);
        const wc = prefetchView.webContents;

        // Set a timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          this.logWarn(`[prefetchFavicon] Timeout reached for ${windowId}`);
          this.cleanupPrefetchResources(windowId, null, wc);
          resolve(null);
        }, 10000); // 10 second timeout

        // Listen for favicon
        let faviconFound = false;
        wc.on('page-favicon-updated', (_event, favicons) => {
          if (!faviconFound && favicons.length > 0) {
            faviconFound = true;
            const faviconUrl = favicons[0];
            this.logDebug(`[prefetchFavicon] Found favicon for ${windowId}: ${faviconUrl}`);
            
            // For tab-specific prefetch, extract the actual windowId and tabId
            const tabPrefetchMatch = windowId.match(/^(.+)-tab-(.+)$/);
            if (tabPrefetchMatch) {
              const [, actualWindowId, tabId] = tabPrefetchMatch;
              // Emit tab-specific favicon event
              this.deps.eventBus.emit('prefetch:tab-favicon-found', { 
                windowId: actualWindowId, 
                tabId, 
                faviconUrl 
              });
              this.logDebug(`[prefetchFavicon] Emitted tab favicon event for window ${actualWindowId}, tab ${tabId}`);
            } else if (this.getView(windowId)) {
              // Regular window favicon update
              this.deps.eventBus.emit('prefetch:favicon-found', { windowId, faviconUrl });
              this.logDebug(`[prefetchFavicon] Emitted favicon event for existing window ${windowId}`);
            } else {
              this.logDebug(`[prefetchFavicon] Window ${windowId} doesn't exist yet, but favicon URL will be returned`);
            }
            
            // Clean up resources
            this.cleanupPrefetchResources(windowId, timeoutId, wc);
            
            // Always resolve with the favicon URL, regardless of window existence
            resolve(faviconUrl);
          }
        });

        // Also listen for did-stop-loading in case there's no favicon
        wc.once('did-stop-loading', () => {
          // Wait a bit after page load to see if favicon appears
          setTimeout(() => {
            if (!faviconFound && this.prefetchViews.has(windowId)) {
              this.logDebug(`[prefetchFavicon] No favicon found for ${windowId} after page load`);
              this.cleanupPrefetchResources(windowId, timeoutId, wc);
              resolve(null);
            }
          }, 1000);
        });

        // Handle errors
        wc.on('did-fail-load', (_event, errorCode, errorDescription) => {
          // Log appropriately based on whether window exists
          if (this.getView(windowId)) {
            this.logError(`[prefetchFavicon] Failed to load page for existing window ${windowId}: ${errorDescription}`);
          } else {
            this.logDebug(`[prefetchFavicon] Load failed for ${windowId} during prefetch: ${errorDescription}`);
          }
          this.cleanupPrefetchResources(windowId, timeoutId, wc);
          // Always resolve, even on error
          resolve(null);
        });

        // Start loading the page
        this.logDebug(`[prefetchFavicon] Loading URL for ${windowId}: ${url}`);
        wc.loadURL(url);

      } catch (error) {
        this.logError(`[prefetchFavicon] Error during prefetch for ${windowId}:`, error);
        this.cleanupPrefetchResources(windowId, null, null);
        resolve(null);
      }
    });
  }

  /**
   * Prefetch favicons for multiple windows in parallel.
   * Used after notebook composition to load favicons for all minimized browser windows.
   * @returns A map of windowId to its fetched faviconUrl (or null if not found).
   */
  async prefetchFaviconsForWindows(
    windows: Array<{ windowId: string; url: string }>
  ): Promise<Map<string, string | null>> {
    this.logInfo(`[prefetchFaviconsForWindows] Prefetching favicons for ${windows.length} windows`);
    
    const faviconMap = new Map<string, string | null>();
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 3;
    for (let i = 0; i < windows.length; i += batchSize) {
      const batch = windows.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async ({ windowId, url }) => {
        try {
          const faviconUrl = await this.prefetchFavicon(windowId, url);
          if (faviconUrl) {
            faviconMap.set(windowId, faviconUrl);
          }
        } catch (error) {
          this.logError(`[prefetchFaviconsForWindows] Error prefetching favicon for ${windowId}:`, error);
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches to be respectful
      if (i + batchSize < windows.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    this.logInfo(`[prefetchFaviconsForWindows] Completed favicon prefetching. Found ${faviconMap.size} favicons.`);
    return faviconMap;
  }

  /**
   * Start the cleanup interval for stale prefetch views
   */
  private startPrefetchCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePrefetchViews();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Clean up any stale prefetch views that may have been abandoned
   */
  private cleanupStalePrefetchViews(): void {
    const staleEntries: string[] = [];
    
    for (const [windowId, view] of this.prefetchViews.entries()) {
      try {
        // Check if the WebContents still exists and isn't destroyed
        if (!view || !view.webContents || view.webContents.isDestroyed()) {
          staleEntries.push(windowId);
        }
      } catch {
        // If accessing webContents throws, it's definitely stale
        staleEntries.push(windowId);
      }
    }
    
    if (staleEntries.length > 0) {
      this.logDebug(`Cleaning up ${staleEntries.length} stale prefetch views`);
      staleEntries.forEach(windowId => this.prefetchViews.delete(windowId));
    }
  }

  /**
   * Clean up prefetch resources for a specific window
   */
  private cleanupPrefetchResources(
    windowId: string, 
    timeoutId: NodeJS.Timeout | null, 
    webContents: Electron.WebContents | null
  ): void {
    // Clear timeout if it exists
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    // Stop and destroy WebContents if it exists and isn't destroyed
    if (webContents) {
      try {
        if (!webContents.isDestroyed()) {
          webContents.stop();
          // Use type assertion to access destroy method
          (webContents as Electron.WebContents & { destroy?: () => void }).destroy?.();
        }
      } catch (error) {
        this.logDebug(`Error during WebContents cleanup for ${windowId}:`, error);
      }
    }
    
    // Remove from tracking map
    this.prefetchViews.delete(windowId);
    
    this.logDebug(`Cleaned up prefetch resources for ${windowId}`);
  }

  /**
   * Create an overlay WebContentsView for context menus
   */
  private createOverlayView(windowId: string): WebContentsView {
    this.logDebug(`Creating overlay view for windowId: ${windowId}`);
    
    const overlay = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        transparent: true,
        webSecurity: true
      }
    });

    // Set transparent background
    overlay.setBackgroundColor('#00000000');
    // Note: setAutoResize was removed in newer Electron versions
    // The overlay will be manually resized when needed

    // Load a dedicated overlay route
    const overlayUrl = `${this.getAppURL()}#/overlay/${windowId}`;
    overlay.webContents.loadURL(overlayUrl);
    this.logDebug(`Loading overlay URL: ${overlayUrl}`);

    // Setup overlay-specific listeners
    this.setupOverlayListeners(overlay, windowId);

    return overlay;
  }

  /**
   * Get the app URL based on environment
   */
  private getAppURL(): string {
    if (process.env.NODE_ENV === 'development') {
      return 'http://localhost:3000';
    } else {
      // Use app.getAppPath() to get the correct path in packaged apps
      const { app } = require('electron');
      const appPath = app.getAppPath();
      const indexPath = path.join(appPath, 'out', 'index.html');
      return `file://${indexPath}`;
    }
  }

  /**
   * Set up listeners for the overlay WebContentsView
   */
  private setupOverlayListeners(overlay: WebContentsView, windowId: string): void {
    const wc = overlay.webContents;

    // Listen for when the overlay is ready
    wc.once('dom-ready', () => {
      this.logDebug(`Overlay DOM ready for windowId: ${windowId}`);
    });

    // Handle navigation prevention (overlays should not navigate)
    wc.on('will-navigate', (event) => {
      event.preventDefault();
      this.logWarn(`Prevented navigation in overlay for windowId: ${windowId}`);
    });

    // Handle overlay crashes
    wc.on('render-process-gone', (_event, details) => {
      this.logError(`Overlay render process gone for windowId ${windowId}:`, details);
      // Clean up the crashed overlay
      this.overlayViews.delete(windowId);
    });

    // Log errors
    wc.on('did-fail-load', (_event, errorCode, errorDescription) => {
      this.logError(`Overlay failed to load for windowId ${windowId}: ${errorDescription} (${errorCode})`);
    });

    // Auto-hide overlay when it loses focus (user clicked elsewhere)
    wc.on('blur', () => {
      this.logDebug(`Overlay lost focus for windowId: ${windowId}`);
      // Only hide if this is still the active overlay
      if (this.activeOverlayWindowId === windowId) {
        this.hideContextMenuOverlay(windowId);
      }
    });
  }

  /**
   * Show the context menu overlay at the specified position
   */
  public async showContextMenuOverlay(windowId: string, contextData: BrowserContextMenuData): Promise<void> {
    return this.execute('showContextMenuOverlay', async () => {
      this.logDebug(`Showing context menu overlay for windowId: ${windowId}`, contextData);

      // Hide any existing overlay first
      if (this.activeOverlayWindowId && this.activeOverlayWindowId !== windowId) {
        this.hideContextMenuOverlay(this.activeOverlayWindowId);
      }

      // Get or create the overlay view
      let overlay = this.overlayViews.get(windowId);
      if (!overlay || overlay.webContents.isDestroyed()) {
        overlay = this.createOverlayView(windowId);
        this.overlayViews.set(windowId, overlay);
      }

      // Clear any existing timeout for this overlay
      const existingTimeout = this.overlayTimeouts.get(windowId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.overlayTimeouts.delete(windowId);
      }

      // Add the overlay to the main window
      if (!this.deps.mainWindow.contentView.children.includes(overlay)) {
        this.deps.mainWindow.contentView.addChildView(overlay);
      }

      // Position the overlay at the cursor location
      // The overlay will be full window size, but the menu itself will be positioned via CSS
      const windowBounds = this.deps.mainWindow.getBounds();
      overlay.setBounds({
        x: 0,
        y: 0,
        width: windowBounds.width,
        height: windowBounds.height
      });

      // Ensure the overlay is on top by re-adding it last
      // This is a simple way to ensure it's above all browser views
      if (this.deps.mainWindow.contentView.children.includes(overlay)) {
        this.deps.mainWindow.contentView.removeChildView(overlay);
        this.deps.mainWindow.contentView.addChildView(overlay);
      }

      // Send the context data to the overlay
      overlay.webContents.send(BROWSER_CONTEXT_MENU_SHOW, contextData);

      this.activeOverlayWindowId = windowId;
    });
  }

  /**
   * Hide the context menu overlay
   */
  public hideContextMenuOverlay(windowId: string): void {
    this.logDebug(`Hiding context menu overlay for windowId: ${windowId}`);

    const overlay = this.overlayViews.get(windowId);
    if (!overlay || overlay.webContents.isDestroyed()) {
      return;
    }

    // Remove from the main window
    if (this.deps.mainWindow.contentView.children.includes(overlay)) {
      this.deps.mainWindow.contentView.removeChildView(overlay);
    }

    // Send hide event to the overlay
    overlay.webContents.send(BROWSER_CONTEXT_MENU_HIDE);

    // Set a timeout to destroy the overlay if it's not reused
    const timeout = setTimeout(() => {
      this.destroyOverlay(windowId);
    }, 30000); // 30 seconds

    this.overlayTimeouts.set(windowId, timeout);

    if (this.activeOverlayWindowId === windowId) {
      this.activeOverlayWindowId = null;
    }
  }

  /**
   * Destroy an overlay view and clean up resources
   */
  private destroyOverlay(windowId: string): void {
    this.logDebug(`Destroying overlay for windowId: ${windowId}`);

    const overlay = this.overlayViews.get(windowId);
    if (!overlay) {
      return;
    }

    // Clear any timeout
    const timeout = this.overlayTimeouts.get(windowId);
    if (timeout) {
      clearTimeout(timeout);
      this.overlayTimeouts.delete(windowId);
    }

    // Remove from main window if still attached
    if (!overlay.webContents.isDestroyed() && this.deps.mainWindow.contentView.children.includes(overlay)) {
      this.deps.mainWindow.contentView.removeChildView(overlay);
    }

    // Destroy the webContents
    try {
      if (!overlay.webContents.isDestroyed()) {
        (overlay.webContents as any).destroy();
      }
    } catch (error) {
      this.logError(`Error destroying overlay webContents for ${windowId}:`, error);
    }

    // Remove from maps
    this.overlayViews.delete(windowId);

    if (this.activeOverlayWindowId === windowId) {
      this.activeOverlayWindowId = null;
    }
  }

  /**
   * Clean up all resources when the service is destroyed
   */
  async cleanup(): Promise<void> {
    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Clean up all remaining prefetch views
    for (const [windowId, view] of this.prefetchViews.entries()) {
      this.cleanupPrefetchResources(windowId, null, view.webContents);
    }
    
    // Clean up all overlay views
    for (const [windowId, overlay] of this.overlayViews.entries()) {
      try {
        if (overlay.webContents && !overlay.webContents.isDestroyed()) {
          (overlay.webContents as any).destroy();
        }
      } catch (error) {
        this.logError(`Error destroying overlay for ${windowId}:`, error);
      }
    }
    
    // Clear overlay timeouts
    for (const timeout of this.overlayTimeouts.values()) {
      clearTimeout(timeout);
    }
    
    try {
      await this.destroyAllBrowserViews();
    } catch (error) {
      this.logError('Error destroying browser views during cleanup:', error);
    }

    this.views.clear();
    this.prefetchViews.clear();
    this.overlayViews.clear();
    this.overlayTimeouts.clear();
    this.logInfo('ClassicBrowserViewManager cleaned up');
  }
}