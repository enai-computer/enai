
import { WebContentsView } from 'electron';
import { BaseService } from '../base/BaseService';
import { TabState } from '../../shared/types/window.types';

/**
 * GlobalTabPool
 *
 * Manages a global pool of WebContentsViews to conserve memory.
 * Implements an LRU eviction policy. This service is a "dumb" factory,
 * controlled by the ClassicBrowserViewManager.
 */
export class GlobalTabPool extends BaseService<{}> {
  private pool: Map<string, WebContentsView> = new Map();
  private lruOrder: string[] = []; // Tab IDs, most recent first
  private preservedState: Map<string, Partial<TabState>> = new Map();
  private readonly MAX_POOL_SIZE = 5;

  constructor() {
    super('GlobalTabPool', {});
  }

  /**
   * Acquire a WebContentsView for a given tab.
   * If the tab is already in the pool, it's marked as most recently used.
   * If not, and the pool is full, the least recently used view is evicted.
   * A new view is then created.
   *
   * @param tabId The ID of the tab to acquire a view for.
   * @returns The acquired WebContentsView.
   */
  public async acquireView(tabId: string): Promise<WebContentsView> {
    return this.execute('acquireView', async () => {
      if (this.pool.has(tabId)) {
        this.updateLRU(tabId);
        this.logDebug(`Tab ${tabId} already in pool. Marked as most recent.`);
        return this.pool.get(tabId)!;
      }

      if (this.pool.size >= this.MAX_POOL_SIZE) {
        await this.evictOldest();
      }

      const view = this.createView(tabId);
      this.pool.set(tabId, view);
      this.updateLRU(tabId);

      this.logInfo(`Acquired new view for tab ${tabId}. Pool size: ${this.pool.size}`);
      return view;
    });
  }

  /**
   * Release a WebContentsView back to the pool, destroying it.
   * This should be called when a tab is closed.
   *
   * @param tabId The ID of the tab whose view should be released.
   */
  public async releaseView(tabId: string): Promise<void> {
    return this.execute('releaseView', async () => {
      const view = this.pool.get(tabId);
      if (view) {
        this.pool.delete(tabId);
        this.lruOrder = this.lruOrder.filter(id => id !== tabId);
        this.preservedState.delete(tabId);
        await this.destroyView(view);
        this.logInfo(`Released and destroyed view for tab ${tabId}. Pool size: ${this.pool.size}`);
      }
    });
  }

  /**
   * Retrieves a view from the pool if it exists.
   * Does not affect LRU order.
   */
  public getView(tabId: string): WebContentsView | undefined {
    return this.pool.get(tabId);
  }

  /**
   * Evicts the least recently used view from the pool.
   */
  private async evictOldest(): Promise<void> {
    const oldestTabId = this.lruOrder.pop();
    if (oldestTabId) {
      this.logInfo(`Evicting oldest tab ${oldestTabId} from pool.`);
      await this.releaseView(oldestTabId);
    }
  }

  /**
   * Creates a new WebContentsView instance.
   */
  private createView(tabId: string): WebContentsView {
    const securePrefs: Electron.WebPreferences = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: undefined,
      webSecurity: true,
      plugins: true,
    };

    const view = new WebContentsView({ webPreferences: securePrefs });
    view.setBackgroundColor('#FFFFFF'); // Default background

    // Set up WebContents event handlers for proper navigation tracking
    this.setupWebContentsEventHandlers(view, tabId);

    // Restore minimal state if it exists
    const state = this.preservedState.get(tabId);
    if (state?.url) {
      view.webContents.loadURL(state.url);
    }

    return view;
  }

  /**
   * Sets up event handlers for WebContents to track navigation state
   */
  private setupWebContentsEventHandlers(view: WebContentsView, tabId: string): void {
    const webContents = view.webContents;

    // Track loading state
    webContents.on('did-start-loading', () => {
      this.logDebug(`Tab ${tabId} started loading`);
      // TODO: Emit to event bus when available
      // this.eventBus?.emit('view:did-start-loading', { tabId, windowId });
    });

    webContents.on('did-stop-loading', () => {
      this.logDebug(`Tab ${tabId} stopped loading`);
      // TODO: Emit to event bus when available
      // this.eventBus?.emit('view:did-stop-loading', { tabId, windowId });
    });

    // Track navigation events
    webContents.on('did-navigate', (event, url, httpResponseCode, httpStatusText) => {
      this.logDebug(`Tab ${tabId} navigated to: ${url}`);
      // Update preserved state with new URL
      const currentState = this.preservedState.get(tabId) || {};
      this.preservedState.set(tabId, { ...currentState, url });
      // TODO: Emit to event bus when available
      // this.eventBus?.emit('view:did-navigate', { tabId, url, httpResponseCode, httpStatusText });
    });

    webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
      if (isMainFrame) {
        this.logDebug(`Tab ${tabId} navigated in-page to: ${url}`);
        // Update preserved state for in-page navigation too
        const currentState = this.preservedState.get(tabId) || {};
        this.preservedState.set(tabId, { ...currentState, url });
      }
    });

    // Track title changes
    webContents.on('page-title-updated', (event, title) => {
      this.logDebug(`Tab ${tabId} title updated: ${title}`);
      // Update preserved state with new title
      const currentState = this.preservedState.get(tabId) || {};
      this.preservedState.set(tabId, { ...currentState, title });
    });

    // Track errors
    webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        this.logWarn(`Tab ${tabId} failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
        // TODO: Emit to event bus when available
        // this.eventBus?.emit('view:did-fail-load', { tabId, errorCode, errorDescription, validatedURL });
      }
    });

    // Track focus events that might trigger reloads on certain sites
    webContents.on('focus', () => {
      this.logDebug(`Tab ${tabId} gained focus`);
    });

    webContents.on('blur', () => {
      this.logDebug(`Tab ${tabId} lost focus`);
    });

    // Store reference to cleanup listeners when view is destroyed
    // Note: WebContents doesn't have a destroy method, cleanup happens in destroyView
    (view as any)._tabId = tabId; // Store tabId for cleanup reference
  }

  /**
   * Destroys a WebContentsView and preserves its state.
   */
  private async destroyView(view: WebContentsView): Promise<void> {
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) {
      const tabId = (view as any)._tabId || this.findTabIdForWebContents(wc);
      if (tabId) {
        // TODO: Enhance state preservation.
        // For now, we only preserve the URL. Later, we can add:
        // - Scroll position: `await wc.executeJavaScript(...)`
        // - Navigation history: `wc.navigationHistory.getEntries()`
        this.preservedState.set(tabId, { url: wc.getURL() });
        this.logDebug(`Preserved state for tab ${tabId}.`);
      }

      // Clean up event listeners before destroying
      wc.removeAllListeners();
      wc.setAudioMuted(true);
      wc.stop();
      
      // Destroy the view itself (which will destroy the WebContents)
      try {
        (view as any).destroy?.();
      } catch (error) {
        this.logDebug(`View already destroyed or destroy method not available: ${error}`);
      }
    }
  }

  /**
   * Updates the LRU order for a given tab.
   */
  private updateLRU(tabId: string): void {
    this.lruOrder = this.lruOrder.filter(id => id !== tabId);
    this.lruOrder.unshift(tabId); // Add to the front (most recent)
  }

  /**
   * Finds the tab ID associated with a given WebContents instance.
   */
  private findTabIdForWebContents(webContents: Electron.WebContents): string | undefined {
    for (const [tabId, view] of this.pool.entries()) {
      if (view.webContents === webContents) {
        return tabId;
      }
    }
    return undefined;
  }

  /**
   * Cleans up all views in the pool.
   */
  public async cleanup(): Promise<void> {
    this.logInfo('Cleaning up GlobalTabPool...');
    const allTabs = Array.from(this.pool.keys());
    for (const tabId of allTabs) {
      await this.releaseView(tabId);
    }
    this.pool.clear();
    this.lruOrder = [];
    this.preservedState.clear();
    this.logInfo('GlobalTabPool cleanup complete.');
  }
}
