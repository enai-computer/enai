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
 * Service responsible for managing browser window states and IPC updates.
 * Provides direct Map access for simple operations and methods for complex state updates.
 */
export class ClassicBrowserStateService extends BaseService<ClassicBrowserStateServiceDeps> {
  // Store the complete state for each browser window - direct access is fine!
  public readonly states = new Map<string, ClassicBrowserPayload>();

  constructor(deps: ClassicBrowserStateServiceDeps) {
    super('ClassicBrowserStateService', deps);
  }

  /**
   * Initialize the service and set up event listeners
   */
  async initialize(): Promise<void> {
    // Listen for favicon updates from prefetch operations
    this.deps.eventEmitter.on('prefetch:favicon-found', ({ windowId, faviconUrl }: { windowId: string; faviconUrl: string }) => {
      this.logDebug(`[initialize] Received prefetch favicon for window ${windowId}: ${faviconUrl}`);
      this.sendStateUpdate(windowId, { faviconUrl });
    });
  }

  /**
   * Send state update to the renderer process
   * This is the main value-add method that handles IPC communication
   */
  sendStateUpdate(windowId: string, tabUpdate?: Partial<TabState>, activeTabId?: string): void {
    const browserState = this.states.get(windowId);
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
   * Find tab state by ID across all windows
   * Complex search logic that's worth abstracting
   */
  findTabState(tabId: string): { state: ClassicBrowserPayload; tab: TabState } | null {
    for (const [, state] of this.states.entries()) {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) {
        return { state, tab };
      }
    }
    return null;
  }

  /**
   * Update the bookmark processing status for a specific tab.
   * Complex update logic with multiple fields - worth keeping as a method
   */
  updateTabBookmarkStatus(
    windowId: string, 
    tabId: string, 
    status: TabState['bookmarkStatus'], 
    jobId?: string, 
    error?: string
  ): void {
    const browserState = this.states.get(windowId);
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
   * Handles external changes like bookmark deletion
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
   * Get the active tab for a window
   * @param windowId - The window ID
   * @returns The active tab or undefined if not found
   */
  public getActiveTab(windowId: string): TabState | undefined {
    const state = this.states.get(windowId);
    return state?.tabs.find(t => t.id === state.activeTabId);
  }

  /**
   * Get a specific tab by ID
   * @param windowId - The window ID
   * @param tabId - The tab ID
   * @returns The tab or undefined if not found
   */
  public getTab(windowId: string, tabId: string): TabState | undefined {
    const state = this.states.get(windowId);
    return state?.tabs.find(t => t.id === tabId);
  }

  /**
   * Get the active tab ID for a window
   * @param windowId - The window ID
   * @returns The active tab ID or undefined if not found
   */
  public getActiveTabId(windowId: string): string | undefined {
    return this.states.get(windowId)?.activeTabId;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Remove event listeners
    this.deps.eventEmitter.removeAllListeners('prefetch:favicon-found');
    
    this.states.clear();
    this.logInfo('State service cleaned up');
  }
}