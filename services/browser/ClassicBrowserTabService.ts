import { TabState } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { ClassicBrowserViewManager } from './ClassicBrowserViewManager';
import { ClassicBrowserNavigationService } from './ClassicBrowserNavigationService';
import { BaseService } from '../base/BaseService';

// Default URL for new tabs
const DEFAULT_NEW_TAB_URL = 'https://www.are.na';

/**
 * Dependencies for ClassicBrowserTabService
 */
export interface ClassicBrowserTabServiceDeps {
  stateService: ClassicBrowserStateService;
  viewManager: ClassicBrowserViewManager;
  navigationService: ClassicBrowserNavigationService;
}

/**
 * Service responsible for managing browser tabs.
 * This service orchestrates tab creation, switching, and closing operations
 * by coordinating between the state, view, and navigation services.
 */
export class ClassicBrowserTabService extends BaseService<ClassicBrowserTabServiceDeps> {
  constructor(deps: ClassicBrowserTabServiceDeps) {
    super('ClassicBrowserTabService', deps);
  }

  /**
   * Creates a new tab in the browser window with control over whether it becomes active.
   * @param windowId - The window to create the tab in
   * @param url - Optional URL to load in the new tab
   * @param makeActive - Whether to switch to the new tab (default: true for backward compatibility)
   * @returns The ID of the newly created tab
   */
  public createTabWithState(windowId: string, url?: string, makeActive: boolean = true): string {
    const browserState = this.deps.stateService.states.get(windowId);
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

    // Add to tabs array
    const state = this.deps.stateService.states.get(windowId);
    if (!state) throw new Error(`Browser window ${windowId} not found`);
    state.tabs = [...state.tabs, newTab];
    
    // Only update active tab ID if requested
    if (makeActive) {
      if (state) state.activeTabId = tabId;
      
      // Load the new tab's URL into the WebContentsView to synchronize view with state
      const view = this.deps.viewManager.getView(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        const urlToLoad = newTab.url; // Use the URL from the tab we just created
        // Use the navigation service's loadUrl method for consistent error handling
        this.deps.navigationService.loadUrl(windowId, urlToLoad).catch(err => {
          this.logError(`createTabWithState: Failed to load URL ${urlToLoad}:`, err);
        });
        this.logDebug(`createTabWithState: Loading ${urlToLoad} in new active tab ${tabId}`);
      }
    } else {
      this.logDebug(`createTabWithState: Created background tab ${tabId} with URL ${newTab.url}`);
    }
    
    // Send state update - if makeActive is false, don't change activeTabId
    this.deps.stateService.sendStateUpdate(windowId, makeActive ? newTab : undefined, makeActive ? tabId : undefined);
    
    this.logDebug(`createTabWithState: Created ${makeActive ? 'active' : 'background'} tab ${tabId} in window ${windowId}`);
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
    const browserState = this.deps.stateService.states.get(windowId);
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
      const view = this.deps.viewManager.getView(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        // Store scroll position for the current tab
        view.webContents.executeJavaScript(`
          ({ x: window.scrollX, y: window.scrollY })
        `).then(scrollPos => {
          (currentTab as TabState & { scrollPosition?: { x: number; y: number } }).scrollPosition = scrollPos;
        }).catch(err => {
          this.logDebug(`switchTab: Failed to save scroll position: ${err}`);
        });
      }
    }

    // Update active tab
    if (browserState) browserState.activeTabId = tabId;

    // Load the new tab's URL in the WebContentsView
    const view = this.deps.viewManager.getView(windowId);
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      if (targetTab.url && targetTab.url !== 'about:blank') {
        // Use the navigation service's loadUrl method for consistent error handling
        this.deps.navigationService.loadUrl(windowId, targetTab.url).catch(err => {
          this.logError(`switchTab: Failed to load URL ${targetTab.url}:`, err);
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
          browserState.tabs = browserState.tabs.map((tab, i) => 
            i === tabIndex ? { ...tab, ...tabUpdate } : tab
          );
        }
      }
    } else {
      this.logWarn(`switchTab: No valid view or webContents for window ${windowId}`);
    }

    // Send complete state update with updated tab info
    this.deps.stateService.sendStateUpdate(windowId, undefined, tabId);
    
    this.logDebug(`switchTab: Switched to tab ${tabId} in window ${windowId}`);
  }

  /**
   * Closes a tab in the browser window.
   * @param windowId - The window containing the tab
   * @param tabId - The ID of the tab to close
   */
  closeTab(windowId: string, tabId: string): void {
    const browserState = this.deps.stateService.states.get(windowId);
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
      const state = this.deps.stateService.states.get(windowId);
      if (state) state.tabs = [newTab];
      if (state) state.activeTabId = newTabId;
      
      // Load the default URL into the WebContentsView
      const view = this.deps.viewManager.getView(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        // Use the navigation service's loadUrl method for consistent error handling
        this.deps.navigationService.loadUrl(windowId, DEFAULT_NEW_TAB_URL).catch(err => {
          this.logError(`closeTab: Failed to load default URL:`, err);
        });
      }
      
      // Send complete state update
      this.deps.stateService.sendStateUpdate(windowId, newTab, newTabId);
      this.logDebug(`closeTab: Replaced last tab with new tab ${newTabId} in window ${windowId}`);
      return;
    }

    // Remove the tab
    const state = this.deps.stateService.states.get(windowId);
    if (state) state.tabs = state.tabs.filter(t => t.id !== tabId);

    // Determine the next active tab
    const currentActiveTabId = state?.activeTabId;
    let newActiveTabId = currentActiveTabId;
    let newActiveTab: TabState | undefined;
    
    // If we're closing the active tab, determine which tab to activate
    if (currentActiveTabId === tabId) {
      const remainingTabs = state?.tabs || [];
      // Try to switch to the tab that was next to the closed one
      const newActiveIndex = Math.min(tabIndex, remainingTabs.length - 1);
      newActiveTab = remainingTabs[newActiveIndex];
      newActiveTabId = newActiveTab.id;
      if (state) state.activeTabId = newActiveTabId;
      
      // Load the new active tab's URL into the WebContentsView
      const view = this.deps.viewManager.getView(windowId);
      if (view && view.webContents && !view.webContents.isDestroyed() && newActiveTab && newActiveTab.url) {
        // Use the navigation service's loadUrl method for consistent error handling
        this.deps.navigationService.loadUrl(windowId, newActiveTab.url).catch(err => {
          this.logError(`closeTab: Failed to load URL ${newActiveTab?.url}:`, err);
        });
      }
    }
    
    // Send a single state update reflecting the complete new state
    this.deps.stateService.sendStateUpdate(windowId, newActiveTab, newActiveTabId);
    
    this.logDebug(`closeTab: Closed tab ${tabId} in window ${windowId}, active tab is now ${newActiveTabId}`);
  }

  /**
   * Clean up any resources when the service is destroyed
   */
  async cleanup(): Promise<void> {
    this.logInfo('Service cleaned up');
  }
}