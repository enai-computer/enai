
import { BrowserWindow } from 'electron';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserPayload, TabState, BrowserActionData } from '../../shared/types';
import { ClassicBrowserViewManager } from './ClassicBrowserViewManager';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from './ClassicBrowserNavigationService';
import { ClassicBrowserTabService } from './ClassicBrowserTabService';
import { ClassicBrowserSnapshotService } from './ClassicBrowserSnapshotService';
import { EventEmitter } from 'events';

export interface ClassicBrowserServiceDeps {
  mainWindow: BrowserWindow;
  viewManager: ClassicBrowserViewManager;
  stateService: ClassicBrowserStateService;
  navigationService: ClassicBrowserNavigationService;
  tabService: ClassicBrowserTabService;
  snapshotService: ClassicBrowserSnapshotService;
}

/**
 * The main entry point for all browser-related operations.
 * Delegates to other services to handle the actual logic.
 */
export class ClassicBrowserService extends BaseService<ClassicBrowserServiceDeps> {
  private eventEmitter = new EventEmitter();
  constructor(deps: ClassicBrowserServiceDeps) {
    super('ClassicBrowserService', deps);
  }

  async initialize(): Promise<void> {
    // Set up event listeners for tab metadata updates from WebContents
    const eventBus = this.deps.stateService.getEventBus();
    
    // Listen for title updates and update the active tab
    eventBus.on('view:page-title-updated', ({ windowId, title }) => {
      this.logDebug(`Received title update for window ${windowId}: ${title}`);
      const activeTabId = this.getActiveTabId(windowId);
      if (activeTabId) {
        this.deps.stateService.updateTab(windowId, activeTabId, { title });
      }
    });

    // Listen for favicon updates and update the active tab
    eventBus.on('view:page-favicon-updated', ({ windowId, faviconUrl }) => {
      this.logDebug(`Received favicon update for window ${windowId}: ${faviconUrl.length} favicons`);
      const favicon = faviconUrl.length > 0 ? faviconUrl[0] : null;
      const activeTabId = this.getActiveTabId(windowId);
      if (activeTabId) {
        this.deps.stateService.updateTab(windowId, activeTabId, { faviconUrl: favicon });
      }
    });
  }

  /**
   * Get the active tab ID for a window
   */
  private getActiveTabId(windowId: string): string | undefined {
    const state = this.deps.stateService.getState(windowId);
    return state?.activeTabId;
  }

  async cleanup(): Promise<void> {
    // Remove event listeners
    const eventBus = this.deps.stateService.getEventBus();
    eventBus.removeAllListeners('view:page-title-updated');
    eventBus.removeAllListeners('view:page-favicon-updated');
    await super.cleanup();
  }

  public createBrowserView(windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): void {
    const initialState = { ...payload, bounds };
    this.deps.stateService.setState(windowId, initialState);
    
    // Ensure there's always at least one tab when creating a browser window
    if (!initialState.tabs.length || !initialState.activeTabId) {
      this.deps.tabService.createTab(windowId, 'https://www.are.na');
    }
  }

  public createTab(windowId: string, url?: string): string {
    return this.deps.tabService.createTab(windowId, url);
  }

  public switchTab(windowId: string, tabId: string): void {
    this.deps.tabService.switchTab(windowId, tabId);
  }

  public closeTab(windowId: string, tabId: string): void {
    this.deps.tabService.closeTab(windowId, tabId);
  }

  public loadUrl(windowId: string, url: string): Promise<void> {
    return this.deps.navigationService.loadUrl(windowId, url);
  }

  public navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    this.deps.navigationService.navigate(windowId, action);
  }

  public setBounds(windowId: string, bounds: Electron.Rectangle): void {
    this.deps.stateService.setBounds(windowId, bounds);
  }

  public executeContextMenuAction(windowId: string, action: string, data?: BrowserActionData): Promise<void> {
    return this.deps.navigationService.executeContextMenuAction(windowId, action, data);
  }

  public async destroyBrowserView(windowId: string): Promise<void> {
    const state = this.deps.stateService.getState(windowId);
    if (state) {
      // Clean up view mappings for this window
      await this.deps.viewManager.cleanupWindow(windowId);
      
      // Release all tab views from the pool
      await Promise.all(state.tabs.map(tab => this.deps.viewManager.releaseView(tab.id)));
      
      // Remove state
      this.deps.stateService.removeState(windowId);
    }
  }

  // Event emitter methods for backward compatibility
  public on(event: string, listener: (...args: any[]) => void): this {
    this.eventEmitter.on(event, listener);
    return this;
  }

  public emit(event: string, ...args: any[]): boolean {
    return this.eventEmitter.emit(event, ...args);
  }

  // Missing methods that IPC handlers expect
  public setBackgroundColor(windowId: string, color: string): void {
    // Delegate to view manager or handle here
  }

  public setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused?: boolean): void {
    // Delegate to view manager or handle here
  }

  public async captureSnapshot(windowId: string): Promise<string> {
    return this.deps.snapshotService.captureSnapshotString(windowId);
  }

  public getBrowserState(windowId: string): ClassicBrowserPayload | undefined {
    return this.deps.stateService.getState(windowId);
  }

  public updateTabBookmarkStatus(windowId: string, tabId: string, isBookmarked: boolean, jobId?: string, errorMessage?: string): void {
    const updates: Partial<TabState> = { isBookmarked };
    if (jobId !== undefined) {
      (updates as any).jobId = jobId;
    }
    if (errorMessage !== undefined) {
      (updates as any).errorMessage = errorMessage;
    }
    this.deps.stateService.updateTab(windowId, tabId, updates);
  }

  public refreshTabState(windowId: string): void {
    // Force a state refresh (but not navigation check since state hasn't actually changed)
    const state = this.deps.stateService.getState(windowId);
    if (state) {
      this.deps.stateService.setState(windowId, state, false); // Don't force navigation check
    }
  }

  public hideContextMenuOverlay(windowId: string): void {
    // Delegate to view manager
  }

  public syncViewStackingOrder(orderedWindows: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): void {
    // Handle view stacking order
  }

  public showAndFocusView(windowId: string): void {
    // Show and focus the browser view
  }

  public async destroyAllBrowserViews(): Promise<void> {
    // Get all windows and destroy their views
    const allStates = this.deps.stateService.getAllStates();
    await Promise.all(Array.from(allStates.keys()).map(windowId => this.destroyBrowserView(windowId)));
  }

  public async prefetchFaviconsForWindows(windows: any[]): Promise<Map<string, string>> {
    // Prefetch favicons for the specified windows
    return new Map<string, string>();
  }

  public async transferTabToNotebook(sourceWindowId: string, tabId: string, targetNotebookId: string): Promise<void> {
    // TODO: Implement tab transfer to notebook functionality
    // This would involve:
    // 1. Getting the tab's URL and content
    // 2. Creating a new object/entry in the target notebook
    // 3. Optionally closing the tab from the browser
    throw new Error('transferTabToNotebook not yet implemented');
  }
}
