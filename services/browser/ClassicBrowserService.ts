
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

  public createBrowserView(windowId: string, bounds: Electron.Rectangle, payload: ClassicBrowserPayload): void {
    const initialState = { ...payload, bounds };
    this.deps.stateService.setState(windowId, initialState);
    
    // Ensure there's always at least one tab when creating a browser window
    if (!initialState.tabs.length || !initialState.activeTabId) {
      this.logDebug(`Creating initial tab for browser window ${windowId} - tabs: ${initialState.tabs.length}, activeTabId: ${initialState.activeTabId}`);
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

  public destroyBrowserView(windowId: string): void {
    const state = this.deps.stateService.getState(windowId);
    if (state) {
      state.tabs.forEach(tab => this.deps.viewManager.releaseView(tab.id));
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
    this.logDebug(`Setting background color for window ${windowId} to ${color}`);
  }

  public setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused?: boolean): void {
    // Delegate to view manager or handle here
    this.logDebug(`Setting visibility for window ${windowId} - drawn: ${shouldBeDrawn}, focused: ${isFocused}`);
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
    this.logDebug(`Hiding context menu overlay for window ${windowId}`);
  }

  public syncViewStackingOrder(orderedWindows: Array<{ id: string; isFrozen: boolean; isMinimized: boolean }>): void {
    // Handle view stacking order
    this.logDebug(`Syncing view stacking order for ${orderedWindows.length} windows`);
  }

  public showAndFocusView(windowId: string): void {
    // Show and focus the browser view
    this.logDebug(`Showing and focusing view for window ${windowId}`);
  }

  public async destroyAllBrowserViews(): Promise<void> {
    // Get all windows and destroy their views
    const allStates = this.deps.stateService.getAllStates();
    for (const windowId of allStates.keys()) {
      this.destroyBrowserView(windowId);
    }
  }

  public async prefetchFaviconsForWindows(windows: any[]): Promise<Map<string, string>> {
    // Prefetch favicons for the specified windows
    this.logDebug(`Prefetching favicons for ${windows.length} windows`);
    return new Map<string, string>();
  }
}
