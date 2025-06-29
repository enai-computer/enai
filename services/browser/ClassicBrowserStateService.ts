import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { ON_CLASSIC_BROWSER_STATE } from '../../shared/ipcChannels';
import { ClassicBrowserPayload, TabState, ClassicBrowserStateUpdate } from '../../shared/types';
import { BaseService } from '../base/BaseService';


/**
 * Dependencies for ClassicBrowserStateService
 */
export interface ClassicBrowserStateServiceDeps {
  mainWindow: BrowserWindow;
  eventEmitter: EventEmitter;
}

/**
 * Service responsible for managing browser window states.
 * This is the single source of truth for all browser window states.
 */
export class ClassicBrowserStateService extends BaseService<ClassicBrowserStateServiceDeps> {
  // Store the complete state for each browser window (source of truth)
  private browserStates: Map<string, ClassicBrowserPayload> = new Map();

  constructor(deps: ClassicBrowserStateServiceDeps) {
    super('ClassicBrowserStateService', deps);
  }

  /**
   * Send state update to the renderer process
   */
  sendStateUpdate(windowId: string, tabUpdate?: Partial<TabState>, activeTabId?: string): void {
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
  getBrowserState(windowId: string): ClassicBrowserPayload | null {
    return this.browserStates.get(windowId) || null;
  }

  /**
   * Find tab state by ID across all windows
   */
  findTabState(tabId: string): { state: ClassicBrowserPayload; tab: TabState } | null {
    for (const [, state] of this.browserStates.entries()) {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) {
        return { state, tab };
      }
    }
    return null;
  }

  /**
   * Update the bookmark processing status for a specific tab.
   */
  updateTabBookmarkStatus(
    windowId: string, 
    tabId: string, 
    status: TabState['bookmarkStatus'], 
    jobId?: string, 
    error?: string
  ): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      this.logWarn(`[updateTabBookmarkStatus] Browser state not found for window ${windowId}`);
      return;
    }

    const tabIndex = browserState.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) {
      this.logWarn(`[updateTabBookmarkStatus] Tab ${tabId} not found in window ${windowId}`);
      return;
    }

    // Update the tab's bookmark status
    browserState.tabs[tabIndex] = {
      ...browserState.tabs[tabIndex],
      bookmarkStatus: status,
      processingJobId: jobId,
      bookmarkError: error
    };

    // If status is completed, also update isBookmarked
    if (status === 'completed') {
      browserState.tabs[tabIndex].isBookmarked = true;
      browserState.tabs[tabIndex].bookmarkedAt = new Date().toISOString();
    }

    // Send state update with the updated tab
    this.sendStateUpdate(windowId, browserState.tabs[tabIndex]);

    this.logDebug(`[updateTabBookmarkStatus] Updated bookmark status for tab ${tabId} to ${status}`);
  }

  /**
   * Refresh the tab state for a specific window.
   * This is useful when external changes (like bookmark deletion) need to be reflected in the UI.
   */
  async refreshTabState(windowId: string, currentUrl: string, isBookmarked: boolean, bookmarkedAt: string | null): Promise<void> {
    this.logDebug(`[refreshTabState] windowId ${windowId}: URL ${currentUrl} bookmarked status: ${isBookmarked}, bookmarkedAt: ${bookmarkedAt}`);
    
    // Send the updated state
    this.sendStateUpdate(windowId, {
      isBookmarked: isBookmarked,
      bookmarkedAt: bookmarkedAt
    });
  }

  /**
   * Check if browser state exists for a window
   */
  hasState(windowId: string): boolean {
    return this.browserStates.has(windowId);
  }

  /**
   * Seed initial state for a window (when first creating)
   */
  seedInitialState(windowId: string, payload: ClassicBrowserPayload): void {
    this.logInfo(`[seedInitialState] Seeding state for windowId ${windowId} with ${payload.tabs.length} tabs`);
    this.browserStates.set(windowId, payload);
  }

  /**
   * Add a new tab to a window
   */
  addTab(windowId: string, tab: TabState): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    // Add to tabs array (create new array to ensure immutability)
    browserState.tabs = [...browserState.tabs, tab];
    
    this.logDebug(`[addTab] Added tab ${tab.id} to window ${windowId}`);
  }

  /**
   * Remove a tab from a window
   */
  removeTab(windowId: string, tabId: string): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    // Remove the tab (create new array to ensure immutability)
    browserState.tabs = browserState.tabs.filter(t => t.id !== tabId);
    
    this.logDebug(`[removeTab] Removed tab ${tabId} from window ${windowId}`);
  }

  /**
   * Replace all tabs in a window (used when closing last tab)
   */
  replaceTabs(windowId: string, tabs: TabState[]): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    browserState.tabs = tabs;
    
    this.logDebug(`[replaceTabs] Replaced tabs in window ${windowId} with ${tabs.length} tabs`);
  }

  /**
   * Set the active tab for a window
   */
  setActiveTab(windowId: string, tabId: string): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      throw new Error(`Browser window ${windowId} not found`);
    }

    browserState.activeTabId = tabId;
    
    this.logDebug(`[setActiveTab] Set active tab to ${tabId} in window ${windowId}`);
  }

  /**
   * Update a specific tab with partial data
   */
  updateTab(windowId: string, tabId: string, updates: Partial<TabState>): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      this.logWarn(`[updateTab] Browser state not found for window ${windowId}`);
      return;
    }

    const tabIndex = browserState.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) {
      this.logWarn(`[updateTab] Tab ${tabId} not found in window ${windowId}`);
      return;
    }

    // Update the tab (create new array for immutability)
    browserState.tabs = browserState.tabs.map((tab, i) => 
      i === tabIndex 
        ? { ...tab, ...updates }
        : tab
    );
    
    this.logDebug(`[updateTab] Updated tab ${tabId} in window ${windowId}`);
  }

  /**
   * Get a specific tab from a window
   */
  getTab(windowId: string, tabId: string): TabState | undefined {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      return undefined;
    }

    return browserState.tabs.find(t => t.id === tabId);
  }

  /**
   * Get the active tab for a window
   */
  getActiveTab(windowId: string): TabState | undefined {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      return undefined;
    }

    return browserState.tabs.find(t => t.id === browserState.activeTabId);
  }

  /**
   * Get all tabs for a window
   */
  getTabs(windowId: string): TabState[] {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      return [];
    }

    return browserState.tabs;
  }

  /**
   * Get the active tab ID for a window
   */
  getActiveTabId(windowId: string): string | undefined {
    const browserState = this.browserStates.get(windowId);
    return browserState?.activeTabId;
  }

  /**
   * Set the tab group ID for a window
   */
  setTabGroupId(windowId: string, tabGroupId: string): void {
    const browserState = this.browserStates.get(windowId);
    if (!browserState) {
      this.logWarn(`[setTabGroupId] Browser state not found for window ${windowId}`);
      return;
    }

    browserState.tabGroupId = tabGroupId;
    
    this.logDebug(`[setTabGroupId] Set tab group ID to ${tabGroupId} for window ${windowId}`);
  }

  /**
   * Get the tab group ID for a window
   */
  getTabGroupId(windowId: string): string | undefined {
    const browserState = this.browserStates.get(windowId);
    return browserState?.tabGroupId;
  }

  /**
   * Delete state for a window
   */
  deleteState(windowId: string): void {
    this.browserStates.delete(windowId);
    this.logDebug(`[deleteState] Deleted state for window ${windowId}`);
  }

  /**
   * Get all window IDs
   */
  getAllWindowIds(): string[] {
    return Array.from(this.browserStates.keys());
  }

  /**
   * Clear all states
   */
  clearAllStates(): void {
    this.browserStates.clear();
    this.logDebug(`[clearAllStates] Cleared all browser states`);
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.clearAllStates();
    this.logInfo('State service cleaned up');
  }
}