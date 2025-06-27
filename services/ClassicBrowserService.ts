import { BrowserWindow, WebContentsView, ipcMain, WebContents } from 'electron';
import { ON_CLASSIC_BROWSER_STATE, CLASSIC_BROWSER_VIEW_FOCUSED } from '../shared/ipcChannels';
import { ClassicBrowserPayload, TabState, ClassicBrowserStateUpdate } from '../shared/types';
import { MediaType } from '../shared/types/vector.types';
import { ActivityLogService } from './ActivityLogService';
import { ObjectModel } from '../models/ObjectModel';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './base/BaseService';
import { NotFoundError, ServiceError } from './base/ServiceError';
import { WOMIngestionService } from './WOMIngestionService';
import { CompositeObjectEnrichmentService } from './CompositeObjectEnrichmentService';
import { EventEmitter } from 'events';

// Default URL for new tabs
const DEFAULT_NEW_TAB_URL = 'https://www.are.na';

/**
 * Dependencies for ClassicBrowserService
 */
export interface ClassicBrowserServiceDeps {
  mainWindow: BrowserWindow;
  objectModel: ObjectModel;
  activityLogService: ActivityLogService;
  womIngestionService: WOMIngestionService;
  compositeEnrichmentService: CompositeObjectEnrichmentService;
}

export class ClassicBrowserService extends BaseService<ClassicBrowserServiceDeps> {
  private views: Map<string, WebContentsView> = new Map();
  private navigationTracking: Map<string, { lastBaseUrl: string; lastNavigationTime: number }> = new Map();
  private prefetchViews: Map<string, WebContentsView> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private snapshots: Map<string, string> = new Map();
  private static readonly MAX_SNAPSHOTS = 10;
  
  // New: Store the complete state for each browser window (source of truth)
  private browserStates: Map<string, ClassicBrowserPayload> = new Map();
  
  // WOM: Map to track webpage objects by tab ID
  private tabToObjectMap: Map<string, string> = new Map(); // tabId -> objectId
  
  // EventEmitter for event-driven architecture
  private eventEmitter = new EventEmitter();
  
  // Tab group update debouncing
  private tabGroupUpdateQueue = new Map<string, NodeJS.Timeout>();

  constructor(deps: ClassicBrowserServiceDeps) {
    super('ClassicBrowserService', deps);
    this.setupEventListeners();
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Start periodic cleanup of stale prefetch views
    this.startPrefetchCleanup();
    this.logInfo('Service initialized with periodic cleanup');
  }
  
  /**
   * Set up event listeners for WOM integration
   */
  private setupEventListeners(): void {
    // Listen for async ingestion completion
    this.eventEmitter.on('webpage:ingestion-complete', async ({ tabId, objectId }: { tabId: string; objectId: string }) => {
      // Link tab to webpage object
      this.tabToObjectMap.set(tabId, objectId);
      this.logDebug(`[WOM] Linked tab ${tabId} to object ${objectId}`);
    });

    this.eventEmitter.on('webpage:needs-refresh', async ({ objectId, url }: { objectId: string; url: string }) => {
      await this.deps.womIngestionService.scheduleRefresh(objectId, url);
    });
  }
  
  // Helper method to find tab state by ID across all windows
  private findTabState(tabId: string): { state: ClassicBrowserPayload; tab: TabState } | null {
    for (const [windowId, state] of this.browserStates.entries()) {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) {
        return { state, tab };
      }
    }
    return null;
  }
  
  // Public methods to emit events (for external listeners)
  emit(event: string, data: any): void {
    this.eventEmitter.emit(event, data);
  }
  
  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }
  
  /**
   * Synchronize WebContentsView stacking order based on window z-indices.
   * This should be called whenever window z-indices change.
   * 
   * @param windowsInOrder - Array of window IDs ordered by z-index (lowest to highest)
   */
  syncViewStackingOrder(windowsInOrder: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): void {
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
    // Only manipulate views if they're out of order
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
   * Get all window IDs that have active WebContentsViews
   */
  getActiveViewWindowIds(): string[] {
    return Array.from(this.views.keys());
  }

  /**
   * Start periodic cleanup of stale prefetch views to prevent memory leaks
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
      } catch (error) {
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
          (webContents as any).destroy();
        }
      } catch (error) {
        this.logDebug(`Error during WebContents cleanup for ${windowId}:`, error);
      }
    }
    
    // Remove from tracking map
    this.prefetchViews.delete(windowId);
    
    this.logDebug(`Cleaned up prefetch resources for ${windowId}`);
  }

  // Check if a URL is an OAuth/authentication URL that should open in a popup
  private isAuthenticationUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();
      
      // Common OAuth/SSO patterns
      const authPatterns = [
        // Google OAuth
        'accounts.google.com',
        'accounts.youtube.com',
        
        // GitHub OAuth
        'github.com/login',
        
        // Microsoft/Azure
        'login.microsoftonline.com',
        'login.microsoft.com',
        'login.live.com',
        
        // Facebook
        'facebook.com/login',
        'facebook.com/dialog/oauth',
        
        // Twitter/X
        'twitter.com/oauth',
        'x.com/oauth',
        
        // LinkedIn
        'linkedin.com/oauth',
        
        // Generic OAuth patterns
        '/oauth/',
        '/auth/',
        '/signin',
        '/login',
        '/sso/',
        'storagerelay://' // Google's OAuth relay
      ];
      
      // Check hostname
      if (authPatterns.some(pattern => hostname.includes(pattern))) {
        return true;
      }
      
      // Check pathname
      if (authPatterns.some(pattern => pathname.includes(pattern))) {
        return true;
      }
      
      // Check for OAuth2 query parameters
      const hasOAuthParams = urlObj.searchParams.has('client_id') || 
                            urlObj.searchParams.has('redirect_uri') ||
                            urlObj.searchParams.has('response_type') ||
                            urlObj.searchParams.has('scope');
      
      return hasOAuthParams;
    } catch (e) {
      return false;
    }
  }

  // Check if a URL is from an ad/tracking/analytics domain
  private isAdOrTrackingUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Common ad/tracking/analytics patterns
      const adPatterns = [
        // Ad networks
        'doubleclick', 'googlesyndication', 'googleadservices', 'googletag',
        'adsystem', 'adsrvr', 'adnxs', 'adsafeprotected', 'amazon-adsystem',
        'facebook.com/tr', 'fbcdn.net', 'moatads', 'openx', 'pubmatic',
        'rubicon', 'scorecardresearch', 'serving-sys', 'taboola', 'outbrain',
        
        // Analytics/tracking
        'google-analytics', 'googletagmanager', 'analytics', 'omniture',
        'segment.', 'mixpanel', 'hotjar', 'mouseflow', 'clicktale',
        'newrelic', 'pingdom', 'quantserve', 'comscore', 'chartbeat',
        
        // User sync/cookie matching
        'sync.', 'match.', 'pixel.', 'cm.', 'rtb.', 'bidder.',
        'partners.tremorhub', 'ad.turn', 'mathtag', 'bluekai',
        'demdex', 'exelator', 'eyeota', 'tapad', 'rlcdn', 'rfihub',
        'casalemedia', 'contextweb', 'districtm', 'sharethrough',
        
        // Other common patterns
        'metric.', 'telemetry.', 'tracking.', 'track.', 'tags.',
        'stats.', 'counter.', 'log.', 'logger.', 'collect.',
        'beacon.', 'pixel', 'impression', '.ads.', 'adserver',
        'creative.', 'banner.', 'popup.', 'pop.', 'affiliate'
      ];
      
      // Domain starts that are typically ads/tracking
      const domainStarts = [
        'ad.', 'ads.', 'adsdk.', 'adx.', 'analytics.', 'stats.',
        'metric.', 'telemetry.', 'tracking.', 'track.', 'pixel.',
        'sync.', 'match.', 'rtb.', 'ssp.', 'dsp.', 'cm.'
      ];
      
      // Check if hostname starts with any ad pattern
      if (domainStarts.some(start => hostname.startsWith(start))) {
        return true;
      }
      
      // Check if hostname contains any ad pattern
      if (adPatterns.some(pattern => hostname.includes(pattern))) {
        return true;
      }
      
      // Check path for common tracking endpoints
      const pathPatterns = ['/pixel', '/sync', '/match', '/track', '/collect', '/beacon', '/impression'];
      if (pathPatterns.some(pattern => urlObj.pathname.includes(pattern))) {
        return true;
      }
      
      return false;
    } catch (e) {
      // If URL parsing fails, don't filter it out
      return false;
    }
  }

  /**
   * Creates a new tab in the browser window with control over whether it becomes active.
   * @param windowId - The window to create the tab in
   * @param url - Optional URL to load in the new tab
   * @param makeActive - Whether to switch to the new tab (default: true for backward compatibility)
   * @returns The ID of the newly created tab
   */
  private createTabWithState(windowId: string, url?: string, makeActive: boolean = true): string {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    // Create new tab
    const tabId = uuidv4();
    const newTab: TabState = {
      id: tabId,
      url: url || DEFAULT_NEW_TAB_URL,
      title: 'New Tab',
      faviconUrl: null,
      isLoading: makeActive, // Only set loading if we're going to load it
      canGoBack: false,
      canGoForward: false,
      error: null
    };

    // Add to tabs array (create new array to ensure immutability)
    browserState.tabs = [...browserState.tabs, newTab];
    
    // Only update active tab ID if requested
    if (makeActive) {
      browserState.activeTabId = tabId;
      
      // Load the new tab's URL into the WebContentsView to synchronize view with state
      const view = this.views.get(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        const urlToLoad = newTab.url; // Use the URL from the tab we just created
        view.webContents.loadURL(urlToLoad).catch(err => {
          this.logError(`[createTabWithState] Failed to load URL ${urlToLoad}:`, err);
        });
        this.logDebug(`[createTabWithState] Loading ${urlToLoad} in new active tab ${tabId}`);
      }
    } else {
      this.logDebug(`[createTabWithState] Created background tab ${tabId} with URL ${newTab.url}`);
    }
    
    // Send state update - if makeActive is false, don't change activeTabId
    this.sendStateUpdate(windowId, makeActive ? newTab : undefined, makeActive ? tabId : undefined);
    
    // Check if we should create a tab group (2+ tabs)
    this.checkAndCreateTabGroup(windowId);
    
    // Schedule tab group update
    this.scheduleTabGroupUpdate(windowId);
    
    this.logDebug(`[createTabWithState] Created ${makeActive ? 'active' : 'background'} tab ${tabId} in window ${windowId}`);
    return tabId;
  }

  /**
   * Creates a new tab in the browser window.
   * @param windowId - The window to create the tab in
   * @param url - Optional URL to load in the new tab
   * @returns The ID of the newly created tab
   */
  createTab(windowId: string, url?: string): string {
    // Use the new helper method with makeActive = true for backward compatibility
    return this.createTabWithState(windowId, url, true);
  }

  /**
   * Switches to a different tab in the browser window.
   * @param windowId - The window containing the tabs
   * @param tabId - The ID of the tab to switch to
   */
  switchTab(windowId: string, tabId: string): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    const targetTab = browserState.tabs.find(t => t.id === tabId);
    if (!targetTab) {
      throw new Error(`Tab ${tabId} not found in window ${windowId}`);
    }

    // Save current tab's scroll position if we're switching away
    const currentTab = browserState.tabs.find(t => t.id === browserState.activeTabId);
    if (currentTab && currentTab.id !== tabId) {
      const view = this.views.get(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        // Store scroll position for the current tab
        view.webContents.executeJavaScript(`
          ({ x: window.scrollX, y: window.scrollY })
        `).then(scrollPos => {
          (currentTab as any).scrollPosition = scrollPos;
        }).catch(err => {
          this.logDebug(`[switchTab] Failed to save scroll position: ${err}`);
        });
      }
    }

    // Update active tab
    browserState.activeTabId = tabId;

    // Load the new tab's URL in the WebContentsView
    const view = this.views.get(windowId);
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      if (targetTab.url && targetTab.url !== 'about:blank') {
        view.webContents.loadURL(targetTab.url).catch(err => {
          this.logError(`[switchTab] Failed to load URL ${targetTab.url}:`, err);
        });
      } else {
        // For new tabs or blank tabs, update the state immediately
        const tabUpdate: Partial<TabState> = {
          url: 'about:blank',
          title: 'New Tab',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null
        };
        
        // Apply the update to the target tab
        const tabIndex = browserState.tabs.findIndex(t => t.id === tabId);
        if (tabIndex !== -1) {
          browserState.tabs[tabIndex] = { ...browserState.tabs[tabIndex], ...tabUpdate };
        }
      }
    } else {
      this.logWarn(`[switchTab] No valid view or webContents for window ${windowId}`);
    }

    // Send complete state update with updated tab info
    this.sendStateUpdate(windowId, undefined, tabId);
    
    this.logDebug(`[switchTab] Switched to tab ${tabId} in window ${windowId}`);
  }

  /**
   * Closes a tab in the browser window.
   * @param windowId - The window containing the tab
   * @param tabId - The ID of the tab to close
   */
  closeTab(windowId: string, tabId: string): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    const tabIndex = browserState.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) {
      throw new Error(`Tab ${tabId} not found in window ${windowId}`);
    }

    // Don't close if it's the last tab - create a new one instead
    if (browserState.tabs.length === 1) {
      // Reset the last tab to a new tab state (create new array for immutability)
      const newTabId = uuidv4();
      const newTab: TabState = {
        id: newTabId,
        url: DEFAULT_NEW_TAB_URL,
        title: 'New Tab',
        faviconUrl: null,
        isLoading: true, // Set to true since we're loading a real URL
        canGoBack: false,
        canGoForward: false,
        error: null
      };
      browserState.tabs = [newTab];
      browserState.activeTabId = newTabId;
      
      // Load the default URL into the WebContentsView
      const view = this.views.get(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.loadURL(DEFAULT_NEW_TAB_URL).catch(err => {
          this.logError(`[closeTab] Failed to load default URL:`, err);
        });
      }
      
      // Send complete state update
      this.sendStateUpdate(windowId, newTab, newTabId);
      this.logDebug(`[closeTab] Replaced last tab with new tab ${newTabId} in window ${windowId}`);
      return;
    }

    // Remove the tab (create new array to ensure immutability)
    browserState.tabs = browserState.tabs.filter((_, i) => i !== tabIndex);

    // Determine the next active tab
    let newActiveTabId = browserState.activeTabId;
    let newActiveTab: TabState | undefined;
    
    // If we're closing the active tab, determine which tab to activate
    if (browserState.activeTabId === tabId) {
      // Try to switch to the tab that was next to the closed one
      const newActiveIndex = Math.min(tabIndex, browserState.tabs.length - 1);
      newActiveTab = browserState.tabs[newActiveIndex];
      newActiveTabId = newActiveTab.id;
      browserState.activeTabId = newActiveTabId;
      
      // Load the new active tab's URL into the WebContentsView
      const view = this.views.get(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed() && newActiveTab && newActiveTab.url) {
        view.webContents.loadURL(newActiveTab.url).catch(err => {
          this.logError(`[closeTab] Failed to load URL ${newActiveTab?.url}:`, err);
        });
      }
    }
    
    // Send a single state update reflecting the complete new state
    this.sendStateUpdate(windowId, newActiveTab, newActiveTabId);
    
    // Schedule tab group update
    this.scheduleTabGroupUpdate(windowId);
    
    this.logDebug(`[closeTab] Closed tab ${tabId} in window ${windowId}, active tab is now ${newActiveTabId}`);
  }

  /**
   * Store a snapshot with LRU eviction policy.
   * When we exceed MAX_SNAPSHOTS, remove the oldest entry.
   */
  private storeSnapshotWithLRU(windowId: string, dataUrl: string): void {
    // If this windowId already exists, delete it first to maintain LRU order
    if (this.snapshots.has(windowId)) {
      this.snapshots.delete(windowId);
    }
    
    // Add the new snapshot
    this.snapshots.set(windowId, dataUrl);
    
    // If we've exceeded the limit, remove the oldest entry
    if (this.snapshots.size > ClassicBrowserService.MAX_SNAPSHOTS) {
      // The first entry in a Map is the oldest
      const firstKey = this.snapshots.keys().next().value;
      if (firstKey) {
        this.snapshots.delete(firstKey);
        this.logDebug(`[storeSnapshotWithLRU] Evicted oldest snapshot for windowId ${firstKey} (LRU policy)`);
      }
    }
  }

  // Public getter for a view
  public getView(windowId: string): WebContentsView | undefined {
    return this.views.get(windowId);
  }

  // Helper to extract base URL (protocol + hostname)
  private getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch {
      return url;
    }
  }

  // Determine if navigation is significant
  private async isSignificantNavigation(windowId: string, newUrl: string): Promise<boolean> {
    const tracking = this.navigationTracking.get(windowId);
    const newBaseUrl = this.getBaseUrl(newUrl);
    const currentTime = Date.now();
    
    if (!tracking) {
      // First navigation for this window
      this.navigationTracking.set(windowId, {
        lastBaseUrl: newBaseUrl,
        lastNavigationTime: currentTime
      });
      return true;
    }
    
    // Check if base URL changed or if enough time has passed (30 seconds)
    const baseUrlChanged = tracking.lastBaseUrl !== newBaseUrl;
    const timeElapsed = currentTime - tracking.lastNavigationTime;
    const significantTimeElapsed = timeElapsed > 30000; // 30 seconds
    
    if (baseUrlChanged || significantTimeElapsed) {
      this.navigationTracking.set(windowId, {
        lastBaseUrl: newBaseUrl,
        lastNavigationTime: currentTime
      });
      return true;
    }
    
    return false;
  }

  private sendStateUpdate(windowId: string, tabUpdate?: Partial<TabState>, activeTabId?: string) {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      this.logWarn(`[sendStateUpdate] No browser state found for windowId ${windowId}`);
      return;
    }

    // Update tab state if provided
    if (tabUpdate && browserState.activeTabId) {
      const tabIndex = browserState.tabs.findIndex(t => t.id === browserState.activeTabId);
      if (tabIndex !== -1) {
        // Update the tab in our source of truth (create new array for immutability)
        browserState.tabs = browserState.tabs.map((tab, i) => 
          i === tabIndex 
            ? { ...tab, ...tabUpdate }
            : tab
        );
      }
    }

    // Update active tab ID if provided
    if (activeTabId !== undefined) {
      browserState.activeTabId = activeTabId;
    }

    // Always send the complete state - no partial updates
    const update: ClassicBrowserStateUpdate = {
      windowId,
      update: {
        tabs: browserState.tabs,
        activeTabId: browserState.activeTabId
      }
    };

    // Send the complete state update to the renderer
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send(ON_CLASSIC_BROWSER_STATE, update);
      this.logDebug(`[sendStateUpdate] Sent complete state for window ${windowId}: ${browserState.tabs.length} tabs, active: ${browserState.activeTabId}`);
    }
  }

  /**
   * Get the complete browser state for a window.
   * This is the source of truth that will be used for state synchronization.
   */
  public getBrowserState(windowId: string): ClassicBrowserPayload | null {
    return this.browserStates.get(windowId) || null;
  }

  createBrowserView(windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): void {
    this.logDebug(`[CREATE] Attempting to create WebContentsView for windowId: ${windowId}`);
    this.logDebug(`[CREATE] Current views in map: ${Array.from(this.views.keys()).join(', ')}`);
    this.logDebug(`[CREATE] Caller stack:`, new Error().stack?.split('\n').slice(2, 5).join('\n'));
    
    // Check if we already have state for this window (i.e., it's already live in this session)
    if (this.browserStates.has(windowId)) {
      this.logInfo(`[CREATE] State for windowId ${windowId} already exists. Ignoring incoming payload and ensuring view is configured.`);
      
      // Check if view exists and is still valid
      const existingView = this.views.get(windowId);
      if (existingView) {
        try {
          // Check if the webContents is destroyed
          if (existingView.webContents && !existingView.webContents.isDestroyed()) {
            this.logWarn(`WebContentsView for windowId ${windowId} already exists and is valid. Updating bounds and sending state.`);
            existingView.setBounds(bounds);
            // Immediately send the current, authoritative state back to the frontend
            this.sendStateUpdate(windowId);
            return;
          } else {
            // View exists but webContents is destroyed, clean it up but keep state
            this.logWarn(`WebContentsView for windowId ${windowId} exists but is destroyed. Recreating view while preserving state.`);
            this.views.delete(windowId);
            this.navigationTracking.delete(windowId);
            // DO NOT delete browserStates - we want to preserve the state
          }
        } catch (error) {
          // If we can't check the view state, assume it's invalid and clean up view only
          this.logWarn(`Error checking WebContentsView state for windowId ${windowId}. Cleaning up view.`, error);
          this.views.delete(windowId);
          this.navigationTracking.delete(windowId);
          // DO NOT delete browserStates - we want to preserve the state
        }
      }
      
      // Use the existing state, not the incoming payload
      const browserState = this.browserStates.get(windowId)!;
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
    this.browserStates.set(windowId, payload);
    
    // Continue with view creation using the seeded state
    this.createViewWithState(windowId, bounds, payload);
  }

  // Helper method to create the actual view with state
  private createViewWithState(windowId: string, bounds: Electron.Rectangle, browserState: ClassicBrowserPayload): void {
    // Log Electron version (Checklist Item 1.2)
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
    this.logDebug(` Set initial transparent background for window ${windowId}`);

    // Apply border radius to the native view
    // WebLayer uses 18px border radius, regular windows use 10px (12px - 2px border inset)
    const borderRadius = windowId === '__WEBLAYER_SINGLETON__' ? 18 : 10;
    (view as any).setBorderRadius(borderRadius); 
    this.logDebug(`✅ setBorderRadius called for windowId: ${windowId} with radius: ${borderRadius}px`);
    this.logDebug('BorderRadius fn typeof:', typeof (view as any).setBorderRadius);
    this.logDebug('proto chain contains setBorderRadius?', 'setBorderRadius' in Object.getPrototypeOf(view));


    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) {
        this.logError('Main window is not available to attach WebContentsView.');
        this.views.delete(windowId); // Clean up
        throw new Error('Main window not available.');
    }

    // Reordered operations (Checklist Item 4.10)
    view.setBounds(bounds); // Set initial bounds
    // this.logDebug(`windowId ${windowId}: WebContentsView instance created. Setting autoResize.`); // setAutoResize removed
    // view.setAutoResize({ width: true, height: true }); // setAutoResize does not exist on WebContentsView
    this.deps.mainWindow.contentView.addChildView(view); // Use contentView.addChildView

    // Hook WebContentsView events
    const wc = view.webContents as WebContents;

    // --- Injected Script for CMD+Click Handling ---
    const cmdClickInterceptorScript = `
      (() => {
        document.addEventListener('click', (event) => {
          // Find the nearest ancestor 'a' tag
          const link = event.target.closest('a');
          if (link && (event.metaKey || event.ctrlKey)) {
            // Prevent the default action (opening in the same view or a new OS window)
            event.preventDefault();
            
            const targetUrl = link.href;
            if (targetUrl) {
              // Use a custom, non-existent protocol to send the URL to the main process.
              // This will be caught by the 'will-navigate' event listener.
              window.location.href = \`jeffers-ipc://cmd-click/\${encodeURIComponent(targetUrl)}\`;
            }
          }
        }, true); // Use capture phase to catch the event early
      })();
    `;

    wc.on('dom-ready', () => {
      wc.executeJavaScript(cmdClickInterceptorScript).catch(err => {
        this.logError(`windowId ${windowId}: Failed to inject CMD+click interceptor script:`, err);
      });
    });
    // --- End Injected Script ---

    wc.on('did-start-loading', () => {
      this.logDebug(`windowId ${windowId}: did-start-loading`);
      this.sendStateUpdate(windowId, { isLoading: true, error: null });
    });

    wc.on('did-stop-loading', () => {
      this.logDebug(`windowId ${windowId}: did-stop-loading`);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        url: wc.getURL(),
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    });

    wc.on('did-navigate', async (_event, url) => {
      this.logDebug(`windowId ${windowId}: did-navigate to ${url}`);
      
      // WOM: Handle navigation with synchronous critical path
      const title = wc.getTitle();
      const activeTab = this.browserStates.get(windowId)?.tabs.find(t => t.id === this.browserStates.get(windowId)?.activeTabId);
      const tabId = activeTab?.id;
      
      if (tabId) {
        // Check if webpage object exists
        let webpage = await this.deps.objectModel.findBySourceUri(url);
        
        if (webpage) {
          // Sync update for immediate feedback
          this.deps.objectModel.updateLastAccessed(webpage.id);
          this.tabToObjectMap.set(tabId, webpage.id);
          
          // Schedule potential refresh
          this.emit('webpage:needs-refresh', { objectId: webpage.id, url, windowId, tabId });
        } else {
          // Emit event for async ingestion
          this.emit('webpage:needs-ingestion', { url, title, windowId, tabId });
        }
        
        // Schedule debounced tab group update
        this.scheduleTabGroupUpdate(windowId);
      }
      
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
        this.logError(` Failed to check bookmark status for ${url}:`, error);
      }
      
      this.sendStateUpdate(windowId, {
        url: url,
        title: wc.getTitle(),
        isLoading: false, // Usually false after navigation, but did-stop-loading is more definitive
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        error: null,
        isBookmarked: isBookmarked,
        bookmarkedAt: bookmarkedAt,
      });
      
      // Log significant navigations
      try {
        if (await this.isSignificantNavigation(windowId, url)) {
          await this.deps.activityLogService.logActivity({
            activityType: 'browser_navigation',
            details: {
              windowId: windowId,
              url: url,
              title: wc.getTitle(),
              baseUrl: this.getBaseUrl(url),
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (logError) {
        this.logError('[ClassicBrowserService] Failed to log navigation activity:', logError);
      }
    });

    // Handle client-side navigation (hash changes, history.pushState, etc.)
    wc.on('did-navigate-in-page', async (_event, url, isMainFrame) => {
      if (!isMainFrame) return; // Only care about main frame navigations
      
      this.logDebug(`windowId ${windowId}: did-navigate-in-page to ${url}`);
      
      // WOM: Handle in-page navigation (similar to did-navigate)
      const title = wc.getTitle();
      const activeTab = this.browserStates.get(windowId)?.tabs.find(t => t.id === this.browserStates.get(windowId)?.activeTabId);
      const tabId = activeTab?.id;
      
      if (tabId) {
        // Check if webpage object exists
        let webpage = await this.deps.objectModel.findBySourceUri(url);
        
        if (webpage) {
          // Sync update for immediate feedback
          this.deps.objectModel.updateLastAccessed(webpage.id);
          this.tabToObjectMap.set(tabId, webpage.id);
          
          // Schedule potential refresh
          this.emit('webpage:needs-refresh', { objectId: webpage.id, url, windowId, tabId });
        } else {
          // Emit event for async ingestion
          this.emit('webpage:needs-ingestion', { url, title, windowId, tabId });
        }
      }
      
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
        this.logDebug(`windowId ${windowId}: URL ${url} bookmarked status (in-page): ${isBookmarked}, bookmarkedAt: ${bookmarkedAt}`);
      } catch (error) {
        this.logError(` Failed to check bookmark status for ${url}:`, error);
      }
      
      this.sendStateUpdate(windowId, {
        url: url,
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isBookmarked: isBookmarked,
        bookmarkedAt: bookmarkedAt,
      });
      
      // Log significant navigations
      try {
        if (await this.isSignificantNavigation(windowId, url)) {
          await this.deps.activityLogService.logActivity({
            activityType: 'browser_navigation',
            details: {
              windowId: windowId,
              url: url,
              title: wc.getTitle(),
              baseUrl: this.getBaseUrl(url),
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (logError) {
        this.logError('[ClassicBrowserService] Failed to log in-page navigation activity:', logError);
      }
    });

    wc.on('page-title-updated', (_event, title) => {
      this.logDebug(`windowId ${windowId}: page-title-updated to ${title}`);
      this.sendStateUpdate(windowId, { title });
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      this.logDebug(`windowId ${windowId}: page-favicon-updated with ${favicons.length} favicons`);
      // Use the first favicon URL if available
      const faviconUrl = favicons.length > 0 ? favicons[0] : null;
      this.sendStateUpdate(windowId, { faviconUrl });
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      // Always log the error for debugging
      this.logError(`windowId ${windowId}: did-fail-load for ${validatedURL}. Code: ${errorCode}, Desc: ${errorDescription}`);
      
      // Handle ERR_ABORTED (-3) specifically for redirects
      if (errorCode === -3) {
        this.logDebug(`windowId ${windowId}: Navigation aborted (ERR_ABORTED) for ${validatedURL} - likely due to redirect`);
        // Don't show this as an error to the user, just update loading state
        this.sendStateUpdate(windowId, {
          isLoading: false,
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
        });
        return;
      }
      
      // Filter out ad/tracking domain errors from UI
      if (this.isAdOrTrackingUrl(validatedURL)) {
        this.logDebug(`windowId ${windowId}: Filtered ad/tracking error from UI for ${validatedURL}`);
        return;
      }
      
      // Only show errors for the main frame or significant resources
      const currentUrl = wc.getURL();
      const browserState = this.browserStates.get(windowId);
      const isMainFrameError = validatedURL === currentUrl || validatedURL === browserState?.initialUrl;
      
      // For non-main-frame errors, only show if it's not an ad/tracking domain
      if (isMainFrameError || !this.isAdOrTrackingUrl(validatedURL)) {
        this.sendStateUpdate(windowId, {
          isLoading: false,
          error: `Failed to load: ${errorDescription} (Code: ${errorCode})`,
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
        });
      }
    });

    wc.on('render-process-gone', (_event, details) => {
      this.logError(`windowId ${windowId}: render-process-gone. Reason: ${details.reason}`);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Browser content process crashed (Reason: ${details.reason}). Please try reloading.`,
      });
      // Optionally, destroy and recreate the view or just leave it to be reloaded by user action.
    });

    // Handle navigation that would open in a new window
    wc.setWindowOpenHandler((details) => {
      // Log every attempt, regardless of disposition
      this.logDebug(`[setWindowOpenHandler] Intercepted window open request`, details);
      
      // Check if this is an authentication URL that needs a popup
      if (this.isAuthenticationUrl(details.url)) {
        this.logInfo(`windowId ${windowId}: Allowing OAuth popup for ${details.url}`);
        
        // Allow OAuth/SSO popups to open with specific settings
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 600,
            height: 700,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true
            },
            autoHideMenuBar: true,
            minimizable: true,
            maximizable: true,
            resizable: true,
            // Don't show in taskbar for cleaner UX
            skipTaskbar: false,
            // Keep it on top while authenticating
            alwaysOnTop: false
          }
        };
      }
      
      // Check if this is a tab-related disposition (CMD/Ctrl+click variations)
      const isTabRequest = details.disposition === 'foreground-tab' ||
                          details.disposition === 'background-tab';
      
      if (isTabRequest) {
        // Determine if tab should be opened in background or foreground
        // 'background-tab' = Cmd/Ctrl+click (open in background, don't switch)
        // 'foreground-tab' = Cmd/Ctrl+Shift+click (open and switch to it)
        const makeActive = details.disposition === 'foreground-tab';
        
        this.logDebug(`windowId ${windowId}: ${details.disposition} detected, creating ${makeActive ? 'active' : 'background'} tab for URL: ${details.url}`);
        
        // Create a new tab with the target URL
        try {
          this.createTabWithState(windowId, details.url, makeActive);
          this.logInfo(`windowId ${windowId}: Created ${makeActive ? 'active' : 'background'} tab for ${details.url}`);
        } catch (err) {
          this.logError(`windowId ${windowId}: Failed to create new tab:`, err);
        }
        
        // Deny the new window creation since we're handling it ourselves
        return { action: 'deny' };
      }
      
      // For regular clicks, navigate in the same window
      this.loadUrl(windowId, details.url);
      // Deny the new window creation
      return { action: 'deny' };
    });

    // Handle navigation attempts (including link clicks)
    wc.on('will-navigate', (event, url) => {
      // Check for our custom IPC protocol
      if (url.startsWith('jeffers-ipc://cmd-click/')) {
        // This is a CMD+click event we captured.
        event.preventDefault(); // Stop the bogus navigation
        
        try {
          const encodedUrl = url.substring('jeffers-ipc://cmd-click/'.length);
          const targetUrl = decodeURIComponent(encodedUrl);
          
          this.logDebug(`windowId ${windowId}: Intercepted CMD+click via custom protocol for URL: ${targetUrl}`);
          
          // Create a new tab with the target URL
          // Default to background tab (standard Cmd+click behavior)
          try {
            this.createTabWithState(windowId, targetUrl, false);
            this.logInfo(`windowId ${windowId}: Created background tab for CMD+click (via custom protocol) to ${targetUrl}`);
          } catch (err) {
            this.logError(`windowId ${windowId}: Failed to create new tab for CMD+click:`, err);
          }
        } catch (err) {
          this.logError(`windowId ${windowId}: Failed to decode CMD+click IPC URL:`, err);
        }
        return;
      }

      // Check for OAuth storage relay URLs (used by Google OAuth)
      if (url.startsWith('storagerelay://')) {
        this.logInfo(`windowId ${windowId}: OAuth storage relay detected, allowing navigation`);
        // Let the OAuth storage relay navigation proceed
        return;
      }

      this.logDebug(`windowId ${windowId}: will-navigate to ${url}, defaultPrevented: ${event.defaultPrevented}`);
      
      // Original logic for will-navigate can go here if any exists
    });

    // Add debug logging for redirect events
    wc.on('will-redirect', (event, url, isInPlace, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: will-redirect to ${url}, isInPlace: ${isInPlace}, isMainFrame: ${isMainFrame}`);
    });

    wc.on('did-redirect-navigation', (event, url, isInPlace, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: did-redirect-navigation to ${url}, isInPlace: ${isInPlace}, isMainFrame: ${isMainFrame}`);
      // Update the UI state with the new URL
      this.sendStateUpdate(windowId, {
        url: url,
        isLoading: true,
      });
    });

    // Add debug logging for navigation start
    wc.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      this.logDebug(`windowId ${windowId}: did-start-navigation to ${url}, isInPlace: ${isInPlace}, isMainFrame: ${isMainFrame}`);
    });

    // Handle iframe navigations that might try to open new windows
    wc.on('did-attach-webview', (event, webContents) => {
      this.logDebug(`windowId ${windowId}: Attached webview, setting up handlers`);
      webContents.setWindowOpenHandler((details) => {
        this.logDebug(`windowId ${windowId}: Iframe intercepted new window request to ${details.url}`);
        // Navigate in the parent WebLayer instead
        this.loadUrl(windowId, details.url);
        return { action: 'deny' };
      });
    });

    // NEW: Listen for focus events on the WebContentsView
    wc.on('focus', () => {
      this.logDebug(`windowId ${windowId}: WebContentsView received focus.`);
      
      // Notify the renderer that this view has gained focus.
      // The renderer will update its state and trigger the sync via the useEffect hook
      if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
        this.deps.mainWindow.webContents.send(CLASSIC_BROWSER_VIEW_FOCUSED, { windowId });
      }
    });

    // Send initial complete state to renderer
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      const initialStateUpdate: ClassicBrowserStateUpdate = {
        windowId,
        update: {
          tabs: browserState.tabs,
          activeTabId: browserState.activeTabId
        }
      };
      this.deps.mainWindow.webContents.send(ON_CLASSIC_BROWSER_STATE, initialStateUpdate);
      this.logDebug(`[createBrowserView] Sent initial state for window ${windowId}: ${browserState.tabs.length} tabs, active: ${browserState.activeTabId}`);
    }

    // Load the active tab's URL
    const activeTab = browserState.tabs.find(t => t.id === browserState.activeTabId);
    const urlToLoad = activeTab?.url || 'about:blank';
    this.logDebug(`windowId ${windowId}: Loading active tab URL: ${urlToLoad}`);
    this.loadUrl(windowId, urlToLoad).catch(err => {
      this.logError(`windowId ${windowId}: Failed to load active tab URL ${urlToLoad}:`, err);
      // State update for error already handled by did-fail-load typically
    });
    this.logDebug(`WebContentsView for windowId ${windowId} created and listeners attached.`);
  }

  async loadUrl(windowId: string, url: string): Promise<void> {
    const view = this.views.get(windowId);
    if (!view) {
      this.logError(`loadUrl: No WebContentsView found for windowId ${windowId}`);
      throw new Error(`WebContentsView with ID ${windowId} not found.`);
    }
    if (!url || typeof url !== 'string') {
        this.logError(`loadUrl: Invalid URL provided for windowId ${windowId}: ${url}`);
        throw new Error('Invalid URL provided.');
    }

    // Validate and fix URL format
    let validUrl = url;
    try {
      // Check if URL has a valid protocol
      const urlObj = new URL(url);
      validUrl = urlObj.href;
    } catch (e) {
      // If URL parsing fails, it might be missing a protocol
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        // Assume https:// for URLs without protocol
        validUrl = `https://${url}`;
        this.logDebug(`windowId ${windowId}: Added https:// protocol to URL: ${validUrl}`);
      }
    }

    this.logDebug(`windowId ${windowId}: Loading URL: ${validUrl}`);
    // Update URL immediately for the address bar to reflect the new target
    this.sendStateUpdate(windowId, { url: validUrl, isLoading: true, error: null });
    try {
      await view.webContents.loadURL(validUrl);
      // Success will be handled by 'did-navigate' or 'did-stop-loading' events
    } catch (error: any) {
      // Handle ERR_ABORTED specifically - this happens during redirects and is not a real error
      if (error.code === 'ERR_ABORTED' && error.errno === -3) {
        this.logDebug(`windowId ${windowId}: Navigation aborted (ERR_ABORTED) for ${url} - likely due to redirect`);
        // Don't throw or show error - the redirect will complete and trigger did-navigate
        return;
      }
      
      this.logError(`windowId ${windowId}: Error loading URL ${url}:`, error);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Failed to initiate loading for ${url}.`
      });
      throw error; // Re-throw to be caught by IPC handler
    }
  }

  navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const view = this.views.get(windowId);
    if (!view) {
      this.logError(`navigate: No WebContentsView found for windowId ${windowId}`);
      // Optionally throw new Error(`WebContentsView with ID ${windowId} not found.`);
      return; // Or throw, depending on desired strictness
    }

    this.logDebug(`windowId ${windowId}: Performing navigation action: ${action}`);
    const wc = view.webContents;
    switch (action) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.goBack();
        else this.logWarn(`windowId ${windowId}: Cannot go back, no history.`);
        break;
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.goForward();
        else this.logWarn(`windowId ${windowId}: Cannot go forward, no history.`);
        break;
      case 'reload':
        wc.reload();
        break;
      case 'stop':
        wc.stop();
        break;
      default:
        this.logWarn(`windowId ${windowId}: Unknown navigation action: ${action}`);
        return; // Or throw new Error for invalid action
    }
    // State updates (canGoBack, canGoForward, etc.) are typically handled by
    // 'did-navigate' and 'did-stop-loading' listeners after the action completes.
    // However, we can send an immediate update for some states if desired.
    this.sendStateUpdate(windowId, {
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isLoading: action === 'reload' // Reload implies loading starts
    });
  }

  setBounds(windowId: string, bounds: Electron.Rectangle): void {
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

  setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused: boolean): void {
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
    } else { // Not to be drawn (e.g., minimized or window explicitly hidden)
      (view as any).setVisible(false); // Make it not drawable
      this.logDebug(`windowId ${windowId}: Set WebContentsView to not visible because shouldBeDrawn is false.`);
      if (viewIsAttached) {
        this.deps.mainWindow.contentView.removeChildView(view);
        this.logDebug(`windowId ${windowId}: Removed WebContentsView from contentView because shouldBeDrawn is false.`);
      }
    }
  }

  /**
   * Set the background color of the WebContentsView.
   * @param windowId - The window ID
   * @param color - The color string (e.g., '#ffffff' or 'transparent')
   */
  setBackgroundColor(windowId: string, color: string): void {
    const view = this.views.get(windowId);
    if (!view) {
      this.logDebug(`setBackgroundColor: No WebContentsView found for windowId ${windowId}. Skipping.`);
      return;
    }

    try {
      view.setBackgroundColor(color);
      this.logDebug(` Set background color for window ${windowId} to ${color}`);
    } catch (error) {
      this.logError(` Error setting background color for window ${windowId}:`, error);
    }
  }

  /**
   * Capture a snapshot of the browser view.
   * Returns the data URL of the captured image.
   * This method only captures the snapshot and does not hide the view.
   */
  async captureSnapshot(windowId: string): Promise<string | null> {
    const view = this.views.get(windowId);
    if (!view) {
      this.logWarn(`[captureSnapshot] No WebContentsView found for windowId ${windowId}`);
      return null;
    }

    // Check if the webContents is destroyed
    if (!view.webContents || view.webContents.isDestroyed()) {
      this.logWarn(`[captureSnapshot] WebContents for windowId ${windowId} is destroyed`);
      // Clean up the view from our tracking
      this.views.delete(windowId);
      this.navigationTracking.delete(windowId);
      this.browserStates.delete(windowId);
      return null;
    }

    // No need to check if view is hidden - we just capture the snapshot

    // Skip snapshot capture for authentication windows
    const currentUrl = view.webContents.getURL();
    if (this.isAuthenticationUrl(currentUrl)) {
      this.logInfo(`[captureSnapshot] Skipping snapshot for authentication window ${windowId}`);
      return null;
    }

    try {
      // Performance timing for snapshot capture
      const startTime = performance.now();
      
      // Capture the current page as an image
      const image = await view.webContents.capturePage();
      const captureTime = performance.now() - startTime;
      
      const dataUrl = image.toDataURL();
      const totalTime = performance.now() - startTime;
      
      // Calculate snapshot size for logging
      const sizeInBytes = dataUrl.length * 0.75; // Approximate size
      const sizeInMB = (sizeInBytes / 1024 / 1024).toFixed(2);
      
      this.logInfo(`[captureSnapshot] Captured snapshot for windowId ${windowId} - Capture: ${captureTime.toFixed(1)}ms, Total: ${totalTime.toFixed(1)}ms, Size: ${sizeInMB}MB`);
      
      // Store the snapshot with LRU enforcement
      this.storeSnapshotWithLRU(windowId, dataUrl);
      
      return dataUrl;
    } catch (error) {
      this.logError(`[captureSnapshot] Failed to capture page for windowId ${windowId}:`, error);
      return null;
    }
  }

  /**
   * Show and focus the browser view, removing any stored snapshot.
   */
  async showAndFocusView(windowId: string): Promise<void> {
    const view = this.views.get(windowId);
    if (!view) {
      this.logDebug(`[showAndFocusView] No WebContentsView found for windowId ${windowId}. View might have been destroyed.`);
      return;
    }

    // Check if view is already visible (idempotency)
    const viewIsAttached = this.deps.mainWindow?.contentView?.children?.includes(view) ?? false;
    if (viewIsAttached && (view as any).visible !== false) {
      this.logDebug(`[showAndFocusView] View for windowId ${windowId} is already visible, just focusing`);
      view.webContents.focus();
      return;
    }

    // Re-attach and show the view
    this.setVisibility(windowId, true, true);
    
    // Focus the webContents
    view.webContents.focus();
    
    // Clean up the snapshot
    if (this.snapshots.has(windowId)) {
      this.snapshots.delete(windowId);
      this.logDebug(`[showAndFocusView] Removed snapshot for windowId ${windowId}`);
    }
  }

  async destroyBrowserView(windowId: string): Promise<void> {
    this.logDebug(`[DESTROY] Attempting to destroy WebContentsView for windowId: ${windowId}`);
    this.logDebug(`[DESTROY] Current views in map: ${Array.from(this.views.keys()).join(', ')}`);
    this.logDebug(`[DESTROY] Caller stack:`, new Error().stack?.split('\n').slice(2, 5).join('\n'));
    
    // Atomically get and remove the view from the map to prevent race conditions.
    const view = this.views.get(windowId);
    if (!view) {
      this.logWarn(`[DESTROY] No WebContentsView found for windowId ${windowId}. Nothing to destroy.`);
      return;
    }

    // By deleting it here, we prevent concurrent destroy calls from operating on the same view object.
    this.views.delete(windowId);
    this.navigationTracking.delete(windowId);
    this.browserStates.delete(windowId);
    // Also clear any stored snapshot
    this.snapshots.delete(windowId);
    this.logDebug(`[DESTROY] Found and removed view for ${windowId} from map. Proceeding with destruction.`);
    
    // Detach from window if attached
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
        try {
            // Check if the view is a child of the mainWindow's contentView
            if (this.deps.mainWindow.contentView && this.deps.mainWindow.contentView.children.includes(view)) {
                this.deps.mainWindow.contentView.removeChildView(view); // Use contentView.removeChildView
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

    // Finally, destroy the webContents to ensure complete cleanup if it still exists and isn't destroyed.
    if (view.webContents && !view.webContents.isDestroyed()) {
      (view.webContents as any).destroy();
    }
    
    this.logDebug(`windowId ${windowId}: WebContentsView destruction process completed.`);
  }

  async destroyAllBrowserViews(): Promise<void> {
    this.logDebug('Destroying all WebContentsViews.');
    const destroyPromises = Array.from(this.views.keys()).map(windowId => 
        this.destroyBrowserView(windowId)
    );
    await Promise.all(destroyPromises);
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
        (existingView.webContents as any).destroy();
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
            
            // Update state only if window exists (for live updates)
            if (this.views.has(windowId)) {
              this.sendStateUpdate(windowId, { faviconUrl });
              this.logDebug(`[prefetchFavicon] Updated state for existing window ${windowId}`);
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
          if (this.views.has(windowId)) {
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
   * Refresh the tab state for a specific window.
   * This is useful when external changes (like bookmark deletion) need to be reflected in the UI.
   */
  async refreshTabState(windowId: string): Promise<void> {
    const view = this.views.get(windowId);
    const browserState = this.browserStates.get(windowId);
    
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
    
    // Send the updated state
    this.sendStateUpdate(windowId, {
      isBookmarked: isBookmarked,
      bookmarkedAt: bookmarkedAt
    });
  }
  
  /**
   * Check if we should create a tab group for this window
   * Only creates tab groups for windows with 2+ tabs
   */
  private async checkAndCreateTabGroup(windowId: string): Promise<void> {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) return;
    
    // Only create tab groups for multi-tab windows
    if (browserState.tabs.length < 2) return;
    
    // Check if we already have a tab group
    if (browserState.tabGroupId) return;
    
    try {
      // Create the tab group object
      const tabGroup = await this.deps.objectModel.createOrUpdate({
        objectType: 'tab_group' as MediaType,
        sourceUri: `tab-group://window-${windowId}`,
        title: `Browser Window`,
        status: 'new',
        rawContentRef: null
      });
      
      browserState.tabGroupId = tabGroup.id;
      this.logInfo(`Created tab group ${tabGroup.id} for window ${windowId} with ${browserState.tabs.length} tabs`);
      
      // Schedule initial update to set child objects
      this.scheduleTabGroupUpdate(windowId);
    } catch (error) {
      this.logError(`Failed to create tab group for window ${windowId}:`, error);
    }
  }
  
  /**
   * Schedule a debounced update to tab group children
   */
  private scheduleTabGroupUpdate(windowId: string): void {
    // If a timer is already pending for this window, clear it
    if (this.tabGroupUpdateQueue.has(windowId)) {
      clearTimeout(this.tabGroupUpdateQueue.get(windowId));
    }
    
    // Set a new timer to perform the update after a short delay
    const timeout = setTimeout(async () => {
      await this.updateTabGroupChildren(windowId);
      this.tabGroupUpdateQueue.delete(windowId);
    }, 500); // 500ms delay
    
    this.tabGroupUpdateQueue.set(windowId, timeout);
  }
  
  /**
   * Update tab group children for WOM composite objects
   */
  private async updateTabGroupChildren(windowId: string): Promise<void> {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) return;
    
    // Check if this window has a tab group (only created for multi-tab windows)
    const tabGroupId = browserState.tabGroupId;
    if (!tabGroupId) return;
    
    // Collect child object IDs from all tabs
    const childObjectIds: string[] = [];
    for (const tab of browserState.tabs) {
      const objectId = this.tabToObjectMap.get(tab.id);
      if (objectId) {
        childObjectIds.push(objectId);
      }
    }
    
    if (childObjectIds.length > 0) {
      // Update the tab group object with current children
      this.deps.objectModel.updateChildIds(tabGroupId, childObjectIds);
      
      // Schedule enrichment if we have enough children
      await this.deps.compositeEnrichmentService.scheduleEnrichment(tabGroupId);
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
    
    // Clear all pending tab group updates
    this.tabGroupUpdateQueue.forEach(timeout => clearTimeout(timeout));
    this.tabGroupUpdateQueue.clear();
    
    // Clean up all remaining prefetch views
    for (const [windowId, view] of this.prefetchViews.entries()) {
      this.cleanupPrefetchResources(windowId, null, view.webContents);
    }
    
    // Destroy all browser views
    try {
      await this.destroyAllBrowserViews();
    } catch (error) {
      this.logError('[ClassicBrowserService] Error destroying browser views during service cleanup:', error);
    }
    
    // Clear all tracking maps
    this.views.clear();
    this.prefetchViews.clear();
    this.navigationTracking.clear();
    this.snapshots.clear();
    this.tabToObjectMap.clear();
    
    // Remove all event listeners
    this.eventEmitter.removeAllListeners();
    
    this.logInfo('[ClassicBrowserService] Service cleaned up');
  }
} 