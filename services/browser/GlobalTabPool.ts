
import { WebContentsView } from 'electron';
import { BaseService } from '../base/BaseService';
import { TabState } from '../../shared/types/window.types';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';

export interface GlobalTabPoolDeps {
  stateService: ClassicBrowserStateService;
}

/**
 * GlobalTabPool
 *
 * Manages a global pool of WebContentsViews to conserve memory.
 * Implements an LRU eviction policy. This service is a "dumb" factory,
 * controlled by the ClassicBrowserViewManager.
 */
export class GlobalTabPool extends BaseService<GlobalTabPoolDeps> {
  private pool: Map<string, WebContentsView> = new Map();
  private lruOrder: string[] = []; // Tab IDs, most recent first
  private preservedState: Map<string, Partial<TabState>> = new Map();
  private readonly MAX_POOL_SIZE = 5;

  constructor(deps: GlobalTabPoolDeps) {
    super('GlobalTabPool', deps);
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

    // Find the current tab state to get the URL
    let urlToLoad: string | null = null;
    
    // First, try preserved state (from evicted tabs)
    const preservedState = this.preservedState.get(tabId);
    if (preservedState?.url) {
      urlToLoad = preservedState.url;
    }
    
    // If no preserved state, look up the current tab state
    if (!urlToLoad) {
      const currentTab = this.findCurrentTabState(tabId);
      if (currentTab?.url) {
        urlToLoad = currentTab.url;
      }
    }
    
    // Load the URL if we found one
    if (urlToLoad && urlToLoad !== 'about:blank') {
      this.logDebug(`Loading URL for tab ${tabId}: ${urlToLoad}`);
      view.webContents.loadURL(urlToLoad);
    }

    return view;
  }

  /**
   * Destroys a WebContentsView and preserves its state.
   */
  private async destroyView(view: WebContentsView): Promise<void> {
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) {
      const tabId = this.findTabIdForWebContents(wc);
      if (tabId) {
        // TODO: Enhance state preservation.
        // For now, we only preserve the URL. Later, we can add:
        // - Scroll position: `await wc.executeJavaScript(...)`
        // - Navigation history: `wc.navigationHistory.getEntries()`
        this.preservedState.set(tabId, { url: wc.getURL() });
        this.logDebug(`Preserved state for tab ${tabId}.`);
      }

      wc.setAudioMuted(true);
      wc.stop();
      (wc as any).destroy();
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
   * Finds the current tab state for a given tab ID across all windows.
   */
  private findCurrentTabState(tabId: string): TabState | undefined {
    const allStates = this.deps.stateService.getAllStates();
    for (const [, browserState] of allStates) {
      const tab = browserState.tabs.find(t => t.id === tabId);
      if (tab) {
        return tab;
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
