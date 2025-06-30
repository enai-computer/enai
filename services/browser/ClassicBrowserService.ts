import { BrowserWindow, WebContentsView } from 'electron';
import { ClassicBrowserPayload, TabState } from '../../shared/types';
import { ActivityLogService } from '../ActivityLogService';
import { ObjectModel } from '../../models/ObjectModel';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from '../base/BaseService';
import { EventEmitter } from 'events';
import { ClassicBrowserViewManager } from './ClassicBrowserViewManager';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from './ClassicBrowserNavigationService';
import { ClassicBrowserTabService } from './ClassicBrowserTabService';
import { ClassicBrowserWOMService } from './ClassicBrowserWOMService';
import { ClassicBrowserSnapshotService } from './ClassicBrowserSnapshotService';
import { isAdOrTrackingUrl, isAuthenticationUrl } from './url.helpers';

// Default URL for new tabs
const DEFAULT_NEW_TAB_URL = 'https://www.are.na';

/**
 * Dependencies for ClassicBrowserService
 */
export interface ClassicBrowserServiceDeps {
  mainWindow: BrowserWindow;
  objectModel: ObjectModel;
  activityLogService: ActivityLogService;
  viewManager: ClassicBrowserViewManager;
  stateService: ClassicBrowserStateService;
  navigationService: ClassicBrowserNavigationService;
  tabService: ClassicBrowserTabService;
  womService: ClassicBrowserWOMService;
  snapshotService: ClassicBrowserSnapshotService;
  eventEmitter: EventEmitter;
}

export class ClassicBrowserService extends BaseService<ClassicBrowserServiceDeps> {
  private viewManager: ClassicBrowserViewManager;
  private stateService: ClassicBrowserStateService;
  private navigationService: ClassicBrowserNavigationService;
  private tabService: ClassicBrowserTabService;
  private womService: ClassicBrowserWOMService;
  private snapshotService: ClassicBrowserSnapshotService;
  
  // EventEmitter for event-driven architecture
  private eventEmitter: EventEmitter;

  constructor(deps: ClassicBrowserServiceDeps) {
    super('ClassicBrowserService', deps);
    
    // Use injected sub-services
    this.viewManager = deps.viewManager;
    this.stateService = deps.stateService;
    this.navigationService = deps.navigationService;
    this.tabService = deps.tabService;
    this.womService = deps.womService;
    this.snapshotService = deps.snapshotService;
    
    // Use the shared EventEmitter passed as a dependency
    this.eventEmitter = deps.eventEmitter;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Set up event handlers for view manager events
    this.setupViewManagerEventHandlers();
    
    // Initialize view manager (starts prefetch cleanup interval)
    await this.viewManager.initialize();
    
    // Initialize state service (sets up event listeners)
    await this.stateService.initialize();
    
    this.logInfo('Service initialized');
  }
  
  /**
   * Set up event handlers for view manager events
   */
  private setupViewManagerEventHandlers(): void {
    // Loading events
    this.eventEmitter.on('view:did-start-loading', ({ windowId }) => {
      this.stateService.sendStateUpdate(windowId, { isLoading: true, error: null });
    });

    this.eventEmitter.on('view:did-stop-loading', ({ windowId, url, title, canGoBack, canGoForward }) => {
      this.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        url,
        title,
        canGoBack,
        canGoForward,
      });
    });

    // Navigation events
    this.eventEmitter.on('view:did-navigate', async ({ windowId, url, title, canGoBack, canGoForward }) => {
      await this.handleNavigation(windowId, url, title, canGoBack, canGoForward);
    });

    this.eventEmitter.on('view:did-navigate-in-page', async ({ windowId, url, title, canGoBack, canGoForward }) => {
      await this.handleInPageNavigation(windowId, url, title, canGoBack, canGoForward);
    });

    // Title and favicon updates
    this.eventEmitter.on('view:page-title-updated', ({ windowId, title }) => {
      this.stateService.sendStateUpdate(windowId, { title });
    });

    this.eventEmitter.on('view:page-favicon-updated', ({ windowId, faviconUrl }) => {
      this.stateService.sendStateUpdate(windowId, { faviconUrl });
    });

    // Error handling
    this.eventEmitter.on('view:did-fail-load', ({ windowId, errorCode, errorDescription, validatedURL, currentUrl, canGoBack, canGoForward }) => {
      this.handleLoadError(windowId, errorCode, errorDescription, validatedURL, currentUrl, canGoBack, canGoForward);
    });

    this.eventEmitter.on('view:render-process-gone', ({ windowId, details }) => {
      this.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Browser content process crashed (Reason: ${details.reason}). Please try reloading.`,
      });
    });

    // Window open handling
    this.eventEmitter.on('view:window-open-request', ({ windowId, details }) => {
      this.handleWindowOpenRequest(windowId, details);
    });

    // Will-navigate handling
    this.eventEmitter.on('view:will-navigate', ({ windowId, event, url }) => {
      this.handleWillNavigate(windowId, event, url);
    });

    // Redirect navigation
    this.eventEmitter.on('view:did-redirect-navigation', ({ windowId, url }) => {
      this.stateService.sendStateUpdate(windowId, {
        url: url,
        isLoading: true,
      });
    });

    // Iframe window open requests
    this.eventEmitter.on('view:iframe-window-open-request', ({ windowId, details }) => {
      this.navigationService.loadUrl(windowId, details.url);
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
      isBookmarked = await this.deps.objectModel.existsBySourceUri(url);
      if (isBookmarked) {
        const bookmarkData = await this.deps.objectModel.getBySourceUri(url);
        if (bookmarkData) {
          bookmarkedAt = bookmarkData.createdAt.toISOString();
        }
      }
      this.logDebug(`windowId ${windowId}: URL ${url} bookmarked status: ${isBookmarked}, bookmarkedAt: ${bookmarkedAt}`);
    } catch (error) {
      this.logError(`Failed to check bookmark status for ${url}:`, error);
    }
    
    this.stateService.sendStateUpdate(windowId, {
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
      if (await this.navigationService.isSignificantNavigation(windowId, url)) {
        await this.deps.activityLogService.logActivity({
          activityType: 'browser_navigation',
          details: {
            windowId: windowId,
            url: url,
            title: title,
            baseUrl: this.navigationService.getBaseUrl(url),
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
      this.stateService.sendStateUpdate(windowId, {
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
    
    const browserState = this.stateService.states.get(windowId);
    const isMainFrameError = validatedURL === currentUrl || validatedURL === browserState?.initialUrl;
    
    if (isMainFrameError || !isAdOrTrackingUrl(validatedURL)) {
      this.stateService.sendStateUpdate(windowId, {
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
  private handleWindowOpenRequest(windowId: string, details: { url: string; disposition: string; [key: string]: unknown }): void {
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
        this.tabService.createTabWithState(windowId, details.url, makeActive);
        this.handlePostTabCreation(windowId);
        this.logInfo(`windowId ${windowId}: Created ${makeActive ? 'active' : 'background'} tab for ${details.url}`);
      } catch (err) {
        this.logError(`windowId ${windowId}: Failed to create new tab:`, err);
      }
    } else {
      // For regular clicks, navigate in the same window
      this.navigationService.loadUrl(windowId, details.url);
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
    return this.stateService.findTabState(tabId);
  }
  
  // Public methods to emit events (for external listeners)
  emit(event: string, data: unknown): void {
    this.eventEmitter.emit(event, data);
  }
  
  on(event: string, handler: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, handler);
  }
  
  /**
   * Synchronize WebContentsView stacking order based on window z-indices.
   * This should be called whenever window z-indices change.
   * 
   * @param windowsInOrder - Array of window IDs ordered by z-index (lowest to highest)
   */
  syncViewStackingOrder(windowsInOrder: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): void {
    this.viewManager.syncViewStackingOrder(windowsInOrder);
  }
  
  /**
   * Get all window IDs that have active WebContentsViews
   */
  getActiveViewWindowIds(): string[] {
    return this.viewManager.getActiveViewWindowIds();
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
    const tabId = this.tabService.createTab(windowId, url);
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
    this.womService.checkAndCreateTabGroup(windowId);
  }

  /**
   * Switches to a different tab in the browser window.
   * @param windowId - The window containing the tabs
   * @param tabId - The ID of the tab to switch to
   */
  switchTab(windowId: string, tabId: string): void {
    this.tabService.switchTab(windowId, tabId);
  }

  /**
   * Closes a tab in the browser window.
   * @param windowId - The window containing the tab
   * @param tabId - The ID of the tab to close
   */
  closeTab(windowId: string, tabId: string): void {
    this.womService.removeTabMapping(tabId);
    this.tabService.closeTab(windowId, tabId);
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
    this.stateService.updateTabBookmarkStatus(windowId, tabId, status, jobId, error);
  }


  // Public getter for a view
  public getView(windowId: string): WebContentsView | undefined {
    return this.viewManager.getView(windowId);
  }


  private sendStateUpdate(windowId: string, tabUpdate?: Partial<TabState>, activeTabId?: string) {
    this.stateService.sendStateUpdate(windowId, tabUpdate, activeTabId);
  }

  /**
   * Get the complete browser state for a window.
   * This is the source of truth that will be used for state synchronization.
   */
  public getBrowserState(windowId: string): ClassicBrowserPayload | null {
    return this.stateService.states.get(windowId) || null;
  }

  createBrowserView(windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): void {
    // Check if we already have state for this window (i.e., it's already live in this session)
    if (this.stateService.states.has(windowId)) {
      this.logInfo(`[CREATE] State for windowId ${windowId} already exists. Using existing state.`);
      
      // Check if view exists and is still valid
      const existingView = this.viewManager.getView(windowId);
      if (existingView) {
        try {
          // Check if the webContents is destroyed
          if (existingView.webContents && !existingView.webContents.isDestroyed()) {
            this.logWarn(`WebContentsView for windowId ${windowId} already exists and is valid. Updating bounds and sending state.`);
            this.viewManager.setBounds(windowId, bounds);
            // Immediately send the current, authoritative state back to the frontend
            this.stateService.sendStateUpdate(windowId);
            return;
          } else {
            // View exists but webContents is destroyed, clean it up but keep state
            this.logWarn(`WebContentsView for windowId ${windowId} exists but is destroyed. Recreating view while preserving state.`);
            this.navigationService.clearNavigationTracking(windowId);
            // DO NOT delete state - we want to preserve the state
          }
        } catch (error) {
          // If we can't check the view state, assume it's invalid and clean up view only
          this.logWarn(`Error checking WebContentsView state for windowId ${windowId}. Cleaning up view.`, error);
          this.navigationService.clearNavigationTracking(windowId);
          // DO NOT delete state - we want to preserve the state
        }
      }
      
      // Use the existing state, not the incoming payload
      const browserState = this.stateService.states.get(windowId)!;
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
    this.stateService.states.set(windowId, payload);
    
    // Continue with view creation using the seeded state
    this.createViewWithState(windowId, bounds, payload);
  }

  // Helper method to create the actual view with state
  private createViewWithState(windowId: string, bounds: Electron.Rectangle, browserState: ClassicBrowserPayload): void {
    // Delegate view creation to the view manager
    this.viewManager.createViewWithState(windowId, bounds, browserState);

    // Send initial complete state to renderer
    this.stateService.sendStateUpdate(windowId);

    // Load the active tab's URL
    const activeTab = browserState.tabs.find(t => t.id === browserState.activeTabId);
    const urlToLoad = activeTab?.url || 'about:blank';
    this.logDebug(`windowId ${windowId}: Loading active tab URL: ${urlToLoad}`);
    this.navigationService.loadUrl(windowId, urlToLoad).catch(err => {
      this.logError(`windowId ${windowId}: Failed to load active tab URL ${urlToLoad}:`, err);
      // State update for error already handled by did-fail-load typically
    });
  }

  // Delegate navigation methods to navigation service
  async loadUrl(windowId: string, url: string): Promise<void> {
    return this.navigationService.loadUrl(windowId, url);
  }

  navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    return this.navigationService.navigate(windowId, action);
  }

  setBounds(windowId: string, bounds: Electron.Rectangle): void {
    this.viewManager.setBounds(windowId, bounds);
  }

  setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused: boolean): void {
    this.viewManager.setVisibility(windowId, shouldBeDrawn, isFocused);
  }

  /**
   * Set the background color of the WebContentsView.
   * @param windowId - The window ID
   * @param color - The color string (e.g., '#ffffff' or 'transparent')
   */
  setBackgroundColor(windowId: string, color: string): void {
    this.viewManager.setBackgroundColor(windowId, color);
  }

  /**
   * Capture a snapshot of the browser view.
   * Delegates to the snapshot service.
   */
  async captureSnapshot(windowId: string): Promise<{ url: string; thumbnail: string } | undefined> {
    return this.snapshotService.captureSnapshot(windowId);
  }

  /**
   * Show and focus the browser view.
   * Delegates to the snapshot service for snapshot display logic.
   */
  async showAndFocusView(windowId: string): Promise<void> {
    const view = this.viewManager.getView(windowId);
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
    this.snapshotService.showAndFocusView(windowId);
  }

  async destroyBrowserView(windowId: string): Promise<void> {
    // Clean up WOM mappings
    this.womService.clearWindowTabMappings(windowId);

    // Clean up service-level tracking
    this.navigationService.clearNavigationTracking(windowId);
    this.stateService.states.delete(windowId);
    this.snapshotService.clearSnapshot(windowId);
    
    // Delegate view destruction to the view manager
    await this.viewManager.destroyBrowserView(windowId);
  }

  async destroyAllBrowserViews(): Promise<void> {
    // Get all window IDs before destroying
    const windowIds = this.viewManager.getActiveViewWindowIds();
    
    // Clean up each window's tracking
    for (const windowId of windowIds) {
      // Clean up WOM mappings
      this.womService.clearWindowTabMappings(windowId);
      
      // Clean up other tracking
      this.navigationService.clearNavigationTracking(windowId);
      this.stateService.states.delete(windowId);
      this.snapshotService.clearSnapshot(windowId);
    }
    
    // Delegate to view manager to destroy all views
    await this.viewManager.destroyAllBrowserViews();
  }

  /**
   * Prefetch favicon for a URL without displaying the window.
   * Delegates to the view manager.
   */
  async prefetchFavicon(windowId: string, url: string): Promise<string | null> {
    return this.viewManager.prefetchFavicon(windowId, url);
  }

  /**
   * Prefetch favicons for multiple windows in parallel.
   * Delegates to the view manager.
   */
  async prefetchFaviconsForWindows(
    windows: Array<{ windowId: string; url: string }>
  ): Promise<Map<string, string | null>> {
    return this.viewManager.prefetchFaviconsForWindows(windows);
  }

  /**
   * Refresh the tab state for a specific window.
   * This is useful when external changes (like bookmark deletion) need to be reflected in the UI.
   */
  async refreshTabState(windowId: string): Promise<void> {
    const view = this.viewManager.getView(windowId);
    const browserState = this.stateService.states.get(windowId);
    
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
      isBookmarked = await this.deps.objectModel.existsBySourceUri(currentUrl);
      
      // If bookmarked, get the creation date
      if (isBookmarked) {
        const bookmarkData = await this.deps.objectModel.getBySourceUri(currentUrl);
        if (bookmarkData) {
          bookmarkedAt = bookmarkData.createdAt.toISOString();
        }
      }
      
      this.logDebug(`[refreshTabState] windowId ${windowId}: URL ${currentUrl} bookmarked status: ${isBookmarked}, bookmarkedAt: ${bookmarkedAt}`);
    } catch (error) {
      this.logError(`[refreshTabState] Failed to check bookmark status for ${currentUrl}:`, error);
    }
    
    // Send the updated state through state service
    await this.stateService.refreshTabState(windowId, currentUrl, isBookmarked, bookmarkedAt);
  }
  

  /**
   * Clean up all resources when the service is destroyed
   */
  async cleanup(): Promise<void> {
    // Destroy all browser views
    try {
      await this.destroyAllBrowserViews();
    } catch (error) {
      this.logError('[ClassicBrowserService] Error destroying browser views during service cleanup:', error);
    }
    
    // Clear all tracking maps
    // Views are cleared by viewManager.cleanup()
    this.navigationService.clearAllNavigationTracking();
    this.snapshotService.clearAllSnapshots();
    this.stateService.states.clear();
    
    // Remove all event listeners
    this.eventEmitter.removeAllListeners();
    
    // Clean up the view manager
    await this.viewManager.cleanup();
    
    // Clean up the state service
    await this.stateService.cleanup();
    
    // Clean up the navigation service
    await this.navigationService.cleanup();
    
    // Clean up the tab service
    await this.tabService.cleanup();
    
    // Clean up the WOM service
    await this.womService.cleanup();
    
    // Clean up the snapshot service
    await this.snapshotService.cleanup();
    
    this.logInfo('[ClassicBrowserService] Service cleaned up');
  }
} 