import { BrowserWindow, WebContentsView, HandlerDetails } from 'electron';
import { ClassicBrowserPayload, TabState } from '../../shared/types';
import { BrowserContextMenuData } from '../../shared/types/contextMenu.types';
import { BrowserEventMap } from './browserEvents.types';
import { ActivityLogService } from '../ActivityLogService';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserViewManager } from './ClassicBrowserViewManager';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from './ClassicBrowserNavigationService';
import { ClassicBrowserTabService } from './ClassicBrowserTabService';
import { ClassicBrowserWOMService } from './ClassicBrowserWOMService';
import { ClassicBrowserSnapshotService } from './ClassicBrowserSnapshotService';
import { BrowserEventBus } from './BrowserEventBus';
import { isAdOrTrackingUrl, isAuthenticationUrl } from './url.helpers';

// Default URL for new tabs
const DEFAULT_NEW_TAB_URL = 'https://www.are.na';

/**
 * Dependencies for ClassicBrowserService
 */
export interface ClassicBrowserServiceDeps {
  mainWindow: BrowserWindow;
  objectModelCore: ObjectModelCore;
  activityLogService: ActivityLogService;
  viewManager: ClassicBrowserViewManager;
  stateService: ClassicBrowserStateService;
  navigationService: ClassicBrowserNavigationService;
  tabService: ClassicBrowserTabService;
  womService: ClassicBrowserWOMService;
  snapshotService: ClassicBrowserSnapshotService;
  eventBus: BrowserEventBus;
}

export class ClassicBrowserService extends BaseService<ClassicBrowserServiceDeps> {
  constructor(deps: ClassicBrowserServiceDeps) {
    super('ClassicBrowserService', deps);
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Set up event handlers for view manager events
    this.setupViewManagerEventHandlers();
    
    this.logInfo('Service initialized');
  }
  
  /**
   * Set up event handlers for view manager events
   */
  private setupViewManagerEventHandlers(): void {
    // Loading events
    this.deps.eventBus.on('view:did-start-loading', ({ windowId }) => {
      this.deps.stateService.sendStateUpdate(windowId, { isLoading: true, error: null });
    });

    this.deps.eventBus.on('view:did-stop-loading', ({ windowId, url, title }) => {
      this.deps.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        url,
        title,
      });
    });

    // Navigation events
    this.deps.eventBus.on('view:did-navigate', async ({ windowId, url, title, canGoBack, canGoForward }) => {
      await this.handleNavigation(windowId, url, title, canGoBack, canGoForward);
    });

    this.deps.eventBus.on('view:did-navigate-in-page', async ({ windowId, url, title, canGoBack, canGoForward }) => {
      await this.handleInPageNavigation(windowId, url, title, canGoBack, canGoForward);
    });

    // Title and favicon updates
    this.deps.eventBus.on('view:page-title-updated', ({ windowId, title }) => {
      this.deps.stateService.sendStateUpdate(windowId, { title });
    });

    this.deps.eventBus.on('view:page-favicon-updated', ({ windowId, faviconUrl }) => {
      // Extract first favicon from array, or null if empty
      const favicon = faviconUrl.length > 0 ? faviconUrl[0] : null;
      this.deps.stateService.sendStateUpdate(windowId, { faviconUrl: favicon });
    });

    // Error handling
    this.deps.eventBus.on('view:did-fail-load', ({ windowId, errorCode, errorDescription, validatedURL, currentUrl, canGoBack, canGoForward }) => {
      this.handleLoadError(windowId, errorCode, errorDescription, validatedURL, currentUrl, canGoBack, canGoForward);
    });

    this.deps.eventBus.on('view:render-process-gone', ({ windowId, details }) => {
      this.deps.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Browser content process crashed (Reason: ${details.reason}). Please try reloading.`,
      });
    });

    // Window open handling
    this.deps.eventBus.on('view:window-open-request', ({ windowId, details }) => {
      this.handleWindowOpenRequest(windowId, details);
    });

    // Will-navigate handling
    this.deps.eventBus.on('view:will-navigate', ({ windowId, event, url }) => {
      this.handleWillNavigate(windowId, event, url);
    });

    // Redirect navigation
    this.deps.eventBus.on('view:did-redirect-navigation', ({ windowId, url }) => {
      this.deps.stateService.sendStateUpdate(windowId, {
        url: url,
        isLoading: true,
      });
    });

    // Iframe window open requests
    this.deps.eventBus.on('view:iframe-window-open-request', ({ windowId, details }) => {
      this.deps.navigationService.loadUrl(windowId, details.url);
    });

    // Context menu handling
    this.deps.eventBus.on('view:context-menu-requested', async ({ windowId, params, viewBounds }) => {
      await this.handleContextMenu(windowId, params, viewBounds);
    });

    // Tab creation from context menu actions
    this.deps.eventBus.on('tab:new', ({ url }) => {
      // Find the first browser window to create the tab in
      const windowIds = this.getActiveViewWindowIds();
      if (windowIds.length > 0) {
        const windowId = windowIds[0];
        this.logDebug(`Creating new background tab with URL: ${url} in window ${windowId}`);
        this.deps.tabService.createTabWithState(windowId, url, false);
        this.handlePostTabCreation(windowId);
      } else {
        this.logWarn('No active browser windows found to create tab');
      }
    });

    // Search in Jeffers from context menu
    this.deps.eventBus.on('search:jeffers', ({ query }) => {
      this.logInfo(`Search in Jeffers requested: ${query}`);
      // TODO: Implement Jeffers search integration
      // This would typically open a search UI or navigate to a search results page
    });
  }
  
  /**
   * Handle navigation events from the view manager
   */
  private async handleNavigation(windowId: string, url: string, title: string, canGoBack: boolean, canGoForward: boolean): Promise<void> {
    // Check if the URL is bookmarked
    let isBookmarked = false;
    let bookmarkedAt: string | null = null;
    try {
      isBookmarked = await this.deps.objectModelCore.existsBySourceUri(url);
      if (isBookmarked) {
        const bookmarkData = await this.deps.objectModelCore.getBySourceUri(url);
        if (bookmarkData) {
          bookmarkedAt = bookmarkData.createdAt.toISOString();
        }
      }
      this.logDebug(`windowId ${windowId}: URL ${url} bookmarked status: ${isBookmarked}, bookmarkedAt: ${bookmarkedAt}`);
    } catch (error) {
      this.logError(`Failed to check bookmark status for ${url}:`, error);
    }
    
    this.deps.stateService.sendStateUpdate(windowId, {
      url: url,
      title: title,
      isLoading: false,
      canGoBack: canGoBack,
      canGoForward: canGoForward,
      error: null,
      isBookmarked: isBookmarked,
      bookmarkedAt: bookmarkedAt,
    });
    
    // Log significant navigations
    try {
      if (await this.deps.navigationService.isSignificantNavigation(windowId, url)) {
        await this.deps.activityLogService.logActivity({
          activityType: 'browser_navigation',
          details: {
            windowId: windowId,
            url: url,
            title: title,
            baseUrl: this.deps.navigationService.getBaseUrl(url),
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (logError) {
      this.logError('[ClassicBrowserService] Failed to log navigation activity:', logError);
    }
  }

  /**
   * Handle in-page navigation events from the view manager
   */
  private async handleInPageNavigation(windowId: string, url: string, title: string, canGoBack: boolean, canGoForward: boolean): Promise<void> {
    // Similar to handleNavigation but for in-page navigations
    await this.handleNavigation(windowId, url, title, canGoBack, canGoForward);
  }

  /**
   * Handle load errors from the view manager
   */
  private handleLoadError(windowId: string, errorCode: number, errorDescription: string, validatedURL: string, currentUrl: string, canGoBack: boolean, canGoForward: boolean): void {
    // Handle ERR_ABORTED (-3) specifically
    if (errorCode === -3) {
      this.logDebug(`windowId ${windowId}: Navigation aborted (ERR_ABORTED) for ${validatedURL} - normal behavior`);
      this.deps.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        canGoBack,
        canGoForward,
      });
      return;
    }
    
    this.logError(`windowId ${windowId}: did-fail-load for ${validatedURL}. Code: ${errorCode}, Desc: ${errorDescription}`);
    
    // Filter out ad/tracking domain errors
    if (isAdOrTrackingUrl(validatedURL)) {
      this.logDebug(`windowId ${windowId}: Filtered ad/tracking error from UI for ${validatedURL}`);
      return;
    }
    
    const browserState = this.deps.stateService.states.get(windowId);
    const isMainFrameError = validatedURL === currentUrl || validatedURL === browserState?.initialUrl;
    
    if (isMainFrameError || !isAdOrTrackingUrl(validatedURL)) {
      this.deps.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Failed to load: ${errorDescription} (Code: ${errorCode})`,
        canGoBack,
        canGoForward,
      });
    }
  }

  /**
   * Handle window open requests from the view manager
   */
  private handleWindowOpenRequest(windowId: string, details: HandlerDetails): void {
    // Check if this is an authentication URL
    if (isAuthenticationUrl(details.url)) {
      this.logInfo(`windowId ${windowId}: OAuth popup request for ${details.url}`);
      // Note: The view manager already denied this, so we just log it
      return;
    }
    
    // Check if this is a tab-related disposition
    const isTabRequest = details.disposition === 'foreground-tab' || details.disposition === 'background-tab';
    
    if (isTabRequest) {
      const makeActive = details.disposition === 'foreground-tab';
      this.logDebug(`windowId ${windowId}: ${details.disposition} detected, creating ${makeActive ? 'active' : 'background'} tab`);
      
      try {
        this.deps.tabService.createTabWithState(windowId, details.url, makeActive);
        this.handlePostTabCreation(windowId);
        this.logInfo(`windowId ${windowId}: Created ${makeActive ? 'active' : 'background'} tab for ${details.url}`);
      } catch (err) {
        this.logError(`windowId ${windowId}: Failed to create new tab:`, err);
      }
    } else {
      // For regular clicks, navigate in the same window
      this.deps.navigationService.loadUrl(windowId, details.url);
    }
  }

  /**
   * Handle will-navigate events from the view manager
   */
  private handleWillNavigate(windowId: string, event: { preventDefault: () => void }, url: string): void {
    // Check for OAuth storage relay URLs
    if (url.startsWith('storagerelay://')) {
      this.logInfo(`windowId ${windowId}: OAuth storage relay detected, allowing navigation`);
      return;
    }

    this.logDebug(`windowId ${windowId}: will-navigate to ${url}`);
  }

  // Helper method to find tab state by ID across all windows
  private findTabState(tabId: string): { state: ClassicBrowserPayload; tab: TabState } | null {
    return this.deps.stateService.findTabState(tabId);
  }
  
  // Public methods to emit events (for external listeners)
  emit<T extends keyof BrowserEventMap>(event: T, data: BrowserEventMap[T]): void {
    this.deps.eventBus.emit(event, data);
  }
  
  on<T extends keyof BrowserEventMap>(event: T, handler: (data: BrowserEventMap[T]) => void): void {
    this.deps.eventBus.on(event, handler);
  }
  
  /**
   * Synchronize WebContentsView stacking order based on window z-indices.
   * This should be called whenever window z-indices change.
   * 
   * @param windowsInOrder - Array of window IDs ordered by z-index (lowest to highest)
   */
  syncViewStackingOrder(windowsInOrder: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): void {
    this.deps.viewManager.syncViewStackingOrder(windowsInOrder);
  }
  
  /**
   * Get all window IDs that have active WebContentsViews
   */
  getActiveViewWindowIds(): string[] {
    return this.deps.viewManager.getActiveViewWindowIds();
  }

  /**
   * Start periodic cleanup of stale prefetch views to prevent memory leaks
   */


  /**
   * Creates a new tab in the browser window.
   * @param windowId - The window to create the tab in
   * @param url - Optional URL to load in the new tab
   * @returns The ID of the newly created tab
   */
  createTab(windowId: string, url?: string): string {
    const tabId = this.deps.tabService.createTab(windowId, url);
    this.handlePostTabCreation(windowId);
    return tabId;
  }

  /**
   * Handles post-tab creation logic such as tab group management.
   * This should be called after any tab creation operation.
   * @param windowId - The window that had a tab created
   */
  private handlePostTabCreation(windowId: string): void {
    // Delegate tab group management to WOM service
    this.deps.womService.checkAndCreateTabGroup(windowId);
  }

  /**
   * Switches to a different tab in the browser window.
   * @param windowId - The window containing the tabs
   * @param tabId - The ID of the tab to switch to
   */
  switchTab(windowId: string, tabId: string): void {
    this.deps.tabService.switchTab(windowId, tabId);
  }

  /**
   * Closes a tab in the browser window.
   * @param windowId - The window containing the tab
   * @param tabId - The ID of the tab to close
   */
  closeTab(windowId: string, tabId: string): void {
    this.deps.womService.removeTabMapping(tabId);
    this.deps.tabService.closeTab(windowId, tabId);
  }

  /**
   * Updates the bookmark processing status for a specific tab.
   * @param windowId - The window ID containing the tab
   * @param tabId - The tab ID to update
   * @param status - The new bookmark status
   * @param jobId - Optional job ID for tracking processing
   * @param error - Optional error message if status is 'error'
   */
  updateTabBookmarkStatus(
    windowId: string, 
    tabId: string, 
    status: TabState['bookmarkStatus'], 
    jobId?: string, 
    error?: string
  ): void {
    this.deps.stateService.updateTabBookmarkStatus(windowId, tabId, status, jobId, error);
  }


  // Public getter for a view
  public getView(windowId: string): WebContentsView | undefined {
    return this.deps.viewManager.getView(windowId);
  }


  private sendStateUpdate(windowId: string, tabUpdate?: Partial<TabState>, activeTabId?: string) {
    this.deps.stateService.sendStateUpdate(windowId, tabUpdate, activeTabId);
  }

  /**
   * Get the complete browser state for a window.
   * This is the source of truth that will be used for state synchronization.
   */
  public getBrowserState(windowId: string): ClassicBrowserPayload | null {
    return this.deps.stateService.states.get(windowId) || null;
  }

  createBrowserView(windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): void {
    // Check if we already have state for this window (i.e., it's already live in this session)
    if (this.deps.stateService.states.has(windowId)) {
      this.logInfo(`[CREATE] State for windowId ${windowId} already exists. Using existing state.`);
      
      // Check if view exists and is still valid
      const existingView = this.deps.viewManager.getView(windowId);
      if (existingView) {
        try {
          // Check if the webContents is destroyed
          if (existingView.webContents && !existingView.webContents.isDestroyed()) {
            this.logWarn(`WebContentsView for windowId ${windowId} already exists and is valid. Updating bounds and sending state.`);
            this.deps.viewManager.setBounds(windowId, bounds);
            // Immediately send the current, authoritative state back to the frontend
            this.deps.stateService.sendStateUpdate(windowId);
            return;
          } else {
            // View exists but webContents is destroyed, clean it up but keep state
            this.logWarn(`WebContentsView for windowId ${windowId} exists but is destroyed. Recreating view while preserving state.`);
            this.deps.navigationService.clearNavigationTracking(windowId);
            // DO NOT delete state - we want to preserve the state
          }
        } catch (error) {
          // If we can't check the view state, assume it's invalid and clean up view only
          this.logWarn(`Error checking WebContentsView state for windowId ${windowId}. Cleaning up view.`, error);
          this.deps.navigationService.clearNavigationTracking(windowId);
          // DO NOT delete state - we want to preserve the state
        }
      }
      
      // Use the existing state, not the incoming payload
      const browserState = this.deps.stateService.states.get(windowId)!;
      this.logInfo(`[CREATE] Using existing state for windowId ${windowId} with ${browserState.tabs.length} tabs`);
      // Continue with view creation using existing state
      this.createViewWithState(windowId, bounds, browserState);
      return;
    }

    // If we've reached here, it's the first time we're seeing this window in this session.
    // We will now "seed" our service's state with the persisted payload from the frontend.
    this.logInfo(`[CREATE] First-time creation for windowId ${windowId}. Seeding state from provided payload with ${payload.tabs.length} tabs.`);
    
    // Validate the payload
    if (!payload.tabs || payload.tabs.length === 0 || !payload.activeTabId) {
      this.logWarn(`[CREATE] Invalid payload provided for windowId ${windowId}. Creating default state.`);
      const tabId = uuidv4();
      const initialTab: TabState = {
        id: tabId,
        url: DEFAULT_NEW_TAB_URL,
        title: 'New Tab',
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      payload = {
        tabs: [initialTab],
        activeTabId: tabId,
        freezeState: { type: 'ACTIVE' }
      };
    }
    
    // Store the seeded state
    this.deps.stateService.states.set(windowId, payload);
    
    // Continue with view creation using the seeded state
    this.createViewWithState(windowId, bounds, payload);
  }

  // Helper method to create the actual view with state
  private createViewWithState(windowId: string, bounds: Electron.Rectangle, browserState: ClassicBrowserPayload): void {
    // Delegate view creation to the view manager
    this.deps.viewManager.createViewWithState(windowId, bounds, browserState);

    // Send initial complete state to renderer
    this.deps.stateService.sendStateUpdate(windowId);

    // Load the active tab's URL
    const activeTab = browserState.tabs.find(t => t.id === browserState.activeTabId);
    const urlToLoad = activeTab?.url || 'about:blank';
    this.logDebug(`windowId ${windowId}: Loading active tab URL: ${urlToLoad}`);
    this.deps.navigationService.loadUrl(windowId, urlToLoad).catch(err => {
      this.logError(`windowId ${windowId}: Failed to load active tab URL ${urlToLoad}:`, err);
      // State update for error already handled by did-fail-load typically
    });
  }

  // Delegate navigation methods to navigation service
  async loadUrl(windowId: string, url: string): Promise<void> {
    return this.deps.navigationService.loadUrl(windowId, url);
  }

  navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    return this.deps.navigationService.navigate(windowId, action);
  }

  setBounds(windowId: string, bounds: Electron.Rectangle): void {
    this.deps.viewManager.setBounds(windowId, bounds);
  }

  setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused: boolean): void {
    this.deps.viewManager.setVisibility(windowId, shouldBeDrawn, isFocused);
  }

  /**
   * Set the background color of the WebContentsView.
   * @param windowId - The window ID
   * @param color - The color string (e.g., '#ffffff' or 'transparent')
   */
  setBackgroundColor(windowId: string, color: string): void {
    this.deps.viewManager.setBackgroundColor(windowId, color);
  }

  /**
   * Capture a snapshot of the browser view.
   * Delegates to the snapshot service.
   */
  async captureSnapshot(windowId: string): Promise<{ url: string; snapshot: string } | undefined> {
    return this.deps.snapshotService.captureSnapshot(windowId);
  }

  /**
   * Show and focus the browser view.
   * Delegates to the snapshot service for snapshot display logic.
   */
  async showAndFocusView(windowId: string): Promise<void> {
    const view = this.deps.viewManager.getView(windowId);
    if (!view) {
      this.logDebug(`No WebContentsView found for windowId ${windowId}. View might have been destroyed.`);
      return;
    }

    // Check if view is already visible (idempotency)
    const viewIsAttached = this.deps.mainWindow?.contentView?.children?.includes(view) ?? false;
    if (viewIsAttached && (view as Electron.WebContentsView & { visible?: boolean }).visible !== false) {
      this.logDebug(`View for windowId ${windowId} is already visible, just focusing`);
      view.webContents.focus();
      return;
    }

    // Re-attach and show the view
    this.setVisibility(windowId, true, true);
    
    // Focus the webContents
    view.webContents.focus();
    
    // Delegate snapshot handling to snapshot service
    this.deps.snapshotService.showAndFocusView(windowId);
  }

  async destroyBrowserView(windowId: string): Promise<void> {
    // Clean up WOM mappings
    this.deps.womService.clearWindowTabMappings(windowId);

    // Clean up service-level tracking
    this.deps.navigationService.clearNavigationTracking(windowId);
    this.deps.stateService.states.delete(windowId);
    this.deps.snapshotService.clearSnapshot(windowId);
    
    // Delegate view destruction to the view manager
    await this.deps.viewManager.destroyBrowserView(windowId);
  }

  async destroyAllBrowserViews(): Promise<void> {
    // Get all window IDs before destroying
    const windowIds = this.deps.viewManager.getActiveViewWindowIds();
    
    // Clean up each window's tracking
    for (const windowId of windowIds) {
      // Clean up WOM mappings
      this.deps.womService.clearWindowTabMappings(windowId);
      
      // Clean up other tracking
      this.deps.navigationService.clearNavigationTracking(windowId);
      this.deps.stateService.states.delete(windowId);
      this.deps.snapshotService.clearSnapshot(windowId);
    }
    
    // Delegate to view manager to destroy all views
    await this.deps.viewManager.destroyAllBrowserViews();
  }

  /**
   * Prefetch favicon for a URL without displaying the window.
   * Delegates to the view manager.
   */
  async prefetchFavicon(windowId: string, url: string): Promise<string | null> {
    return this.deps.viewManager.prefetchFavicon(windowId, url);
  }

  /**
   * Prefetch favicons for multiple windows in parallel.
   * Delegates to the view manager.
   */
  async prefetchFaviconsForWindows(
    windows: Array<{ windowId: string; url: string }>
  ): Promise<Map<string, string | null>> {
    return this.deps.viewManager.prefetchFaviconsForWindows(windows);
  }

  /**
   * Refresh the tab state for a specific window.
   * This is useful when external changes (like bookmark deletion) need to be reflected in the UI.
   */
  async refreshTabState(windowId: string): Promise<void> {
    const view = this.deps.viewManager.getView(windowId);
    const browserState = this.deps.stateService.states.get(windowId);
    
    if (!view || !browserState) {
      this.logWarn(`[refreshTabState] No view or state found for windowId ${windowId}`);
      return;
    }
    
    const wc = view.webContents;
    if (!wc || wc.isDestroyed()) {
      this.logWarn(`[refreshTabState] WebContents is destroyed for windowId ${windowId}`);
      return;
    }
    
    const currentUrl = wc.getURL();
    
    // Check if the URL is bookmarked
    let isBookmarked = false;
    let bookmarkedAt: string | null = null;
    
    try {
      isBookmarked = await this.deps.objectModelCore.existsBySourceUri(currentUrl);
      
      // If bookmarked, get the creation date
      if (isBookmarked) {
        const bookmarkData = await this.deps.objectModelCore.getBySourceUri(currentUrl);
        if (bookmarkData) {
          bookmarkedAt = bookmarkData.createdAt.toISOString();
        }
      }
      
      this.logDebug(`[refreshTabState] windowId ${windowId}: URL ${currentUrl} bookmarked status: ${isBookmarked}, bookmarkedAt: ${bookmarkedAt}`);
    } catch (error) {
      this.logError(`[refreshTabState] Failed to check bookmark status for ${currentUrl}:`, error);
    }
    
    // Send the updated state through state service
    await this.deps.stateService.refreshTabState(windowId, currentUrl, isBookmarked, bookmarkedAt);
  }
  

  /**
   * Hide the context menu overlay for a specific window
   */
  hideContextMenuOverlay(windowId: string): void {
    this.deps.viewManager.hideContextMenuOverlay(windowId);
  }

  /**
   * Execute a context menu action
   */
  async executeContextMenuAction(windowId: string, action: string, data?: any): Promise<void> {
    return this.execute('executeContextMenuAction', async () => {
      this.logInfo(`Executing context menu action: ${action} for window ${windowId}`, data);
      
      // Execute the action through the navigation service
      await this.deps.navigationService.executeContextMenuAction(windowId, action, data);
    });
  }

  /**
   * Get the view manager instance (needed for IPC handlers)
   */
  getViewManager(): ClassicBrowserViewManager {
    return this.deps.viewManager;
  }

  /**
   * Clean up all resources when the service is destroyed
   */
  /**
   * Handle context menu request from a browser view
   */
  private async handleContextMenu(
    windowId: string, 
    params: Electron.ContextMenuParams, 
    viewBounds: { x: number; y: number; width: number; height: number }
  ): Promise<void> {
    return this.execute('handleContextMenu', async () => {
      // Get the current browser state for navigation info
      const state = this.deps.stateService.states.get(windowId);
      if (!state) {
        this.logWarn(`No state found for windowId ${windowId}, cannot show context menu`);
        return;
      }

      // Transform Electron params to our context menu data format
      // Note: params.x and params.y are relative to the WebContentsView
      // We need to transform them to window coordinates by adding the view's position
      const contextData: BrowserContextMenuData = {
        x: params.x + viewBounds.x,
        y: params.y + viewBounds.y,
        windowId,
        viewBounds,
        browserContext: {
          linkURL: params.linkURL,
          srcURL: params.srcURL,
          pageURL: state.url || '',
          frameURL: params.frameURL,
          selectionText: params.selectionText,
          isEditable: params.isEditable,
          canGoBack: state.canGoBack || false,
          canGoForward: state.canGoForward || false,
          canReload: true,
          canViewSource: true,
          mediaType: params.mediaType,
          hasImageContents: params.hasImageContents,
          editFlags: {
            canUndo: params.editFlags.canUndo,
            canRedo: params.editFlags.canRedo,
            canCut: params.editFlags.canCut,
            canCopy: params.editFlags.canCopy,
            canPaste: params.editFlags.canPaste,
            canSelectAll: params.editFlags.canSelectAll,
          },
        },
      };

      // Show the context menu overlay
      await this.deps.viewManager.showContextMenuOverlay(windowId, contextData);
    });
  }

  async cleanup(): Promise<void> {
    // ClassicBrowserService doesn't own any resources directly
    // All resources (views, state, navigation tracking, etc.) are owned by the sub-services
    // which will handle their own cleanup via ServiceBootstrap
    
    // Note: We do NOT call destroyAllBrowserViews() or any cleanup methods on dependencies
    // This prevents double-cleanup issues and EPIPE errors
    
    this.logInfo('[ClassicBrowserService] Service cleaned up');
  }
} 