
import { BrowserWindow, WebContentsView } from 'electron';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserPayload } from '../../shared/types';
import { BrowserEventBus } from './BrowserEventBus';
import { GlobalTabPool } from './GlobalTabPool';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';

export interface ClassicBrowserViewManagerDeps {
  mainWindow: BrowserWindow;
  eventBus: BrowserEventBus;
  globalTabPool: GlobalTabPool;
  stateService: ClassicBrowserStateService;
}

/**
 * Manages the presentation layer of the browser, ensuring the visual
 * state of WebContentsViews matches the application state.
 */
export class ClassicBrowserViewManager extends BaseService<ClassicBrowserViewManagerDeps> {
  private activeViews: Map<string, WebContentsView> = new Map(); // windowId -> view
  private detachedViews: Map<string, WebContentsView> = new Map(); // windowId -> view (for minimized windows)

  constructor(deps: ClassicBrowserViewManagerDeps) {
    super('ClassicBrowserViewManager', deps);
  }

  async initialize(): Promise<void> {
    this.deps.eventBus.on('state-changed', this.handleStateChange.bind(this));
    this.deps.eventBus.on('window:focus-changed', this.handleWindowFocusChanged.bind(this));
    this.deps.eventBus.on('window:minimized', this.handleWindowMinimized.bind(this));
    this.deps.eventBus.on('window:restored', this.handleWindowRestored.bind(this));
    this.deps.eventBus.on('window:z-order-update', this.handleZOrderUpdate.bind(this));
  }

  private async handleStateChange({ windowId, newState }: { windowId: string; newState: ClassicBrowserPayload }): Promise<void> {
    const activeTabId = newState.activeTabId;
    const currentView = this.activeViews.get(windowId);
    const currentViewTabId = this.findTabIdForView(currentView);

    if (currentViewTabId === activeTabId) {
      // The correct tab is already active, do nothing.
      return;
    }

    // A different tab needs to be shown. First, detach the old view.
    if (currentView) {
      this.detachView(currentView);
      this.activeViews.delete(windowId);
    }

    // Now, acquire and attach the new view.
    if (activeTabId) {
      const newView = await this.deps.globalTabPool.acquireView(activeTabId);
      this.activeViews.set(windowId, newView);
      this.attachView(newView, windowId, newState.bounds);
    }
  }

  private attachView(view: WebContentsView, windowId: string, bounds: Electron.Rectangle): void {
    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) return;

    view.setBounds(bounds);
    this.deps.mainWindow.contentView.addChildView(view);
  }

  private detachView(view: WebContentsView): void {
    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) return;

    if (this.deps.mainWindow.contentView.children.includes(view)) {
      this.deps.mainWindow.contentView.removeChildView(view);
    }
  }

  private findTabIdForView(view?: WebContentsView): string | undefined {
    if (!view) return undefined;
    for (const [tabId, activeView] of this.activeViews.entries()) {
      if (activeView === view) {
        return tabId;
      }
    }
    return undefined;
  }

  private async handleWindowFocusChanged({ windowId, isFocused }: { windowId: string; isFocused: boolean }): Promise<void> {
    this.logDebug(`Window focus changed: ${windowId}, focused: ${isFocused}`);
    
    if (isFocused) {
      // When a window gains focus, ensure its view is on top
      const view = this.activeViews.get(windowId);
      if (view) {
        this.bringViewToTop(view);
      }
    }
  }

  private async handleWindowMinimized({ windowId }: { windowId: string }): Promise<void> {
    this.logDebug(`Window minimized: ${windowId}`);
    
    const view = this.activeViews.get(windowId);
    if (view) {
      // Detach the view from the main window
      this.detachView(view);
      this.detachedViews.set(windowId, view);
      this.activeViews.delete(windowId);
      this.logDebug(`Detached view for minimized window: ${windowId}`);
    }
  }

  private async handleWindowRestored({ windowId, zIndex }: { windowId: string; zIndex: number }): Promise<void> {
    this.logDebug(`Window restored: ${windowId}, zIndex: ${zIndex}`);
    
    const view = this.detachedViews.get(windowId);
    if (view) {
      // Move view back to active views
      this.detachedViews.delete(windowId);
      this.activeViews.set(windowId, view);
      
      // Re-attach the view - it will be positioned correctly by z-order update
      const bounds = this.getBoundsForWindow(windowId);
      if (bounds) {
        this.attachView(view, windowId, bounds);
      }
      this.logDebug(`Restored view for window: ${windowId}`);
    }
  }

  private async handleZOrderUpdate({ orderedWindows }: { orderedWindows: Array<{ windowId: string; zIndex: number; isFocused: boolean; isMinimized: boolean }> }): Promise<void> {
    this.logDebug(`Z-order update for ${orderedWindows.length} windows`);
    
    // Re-attach all non-minimized views in correct z-order (lowest to highest)
    const activeWindowsInOrder = orderedWindows
      .filter(w => !w.isMinimized)
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const { windowId } of activeWindowsInOrder) {
      const view = this.activeViews.get(windowId);
      if (view) {
        this.bringViewToTop(view);
      }
    }
  }

  private bringViewToTop(view: WebContentsView): void {
    if (!this.deps.mainWindow || this.deps.mainWindow.isDestroyed()) return;
    
    // The only way to change z-order in Electron is to remove and re-add the view
    if (this.deps.mainWindow.contentView.children.includes(view)) {
      this.deps.mainWindow.contentView.removeChildView(view);
      this.deps.mainWindow.contentView.addChildView(view);
    }
  }

  private getBoundsForWindow(windowId: string): Electron.Rectangle | null {
    // Get bounds from the browser state service
    const state = this.deps.stateService?.getState(windowId);
    if (state?.bounds) {
      return state.bounds;
    }
    
    // Fallback to default bounds
    this.logWarn(`No bounds found for window ${windowId}, using default`);
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  async cleanup(): Promise<void> {
    this.deps.eventBus.removeAllListeners('state-changed');
    this.deps.eventBus.removeAllListeners('window:focus-changed');
    this.deps.eventBus.removeAllListeners('window:minimized');
    this.deps.eventBus.removeAllListeners('window:restored');
    this.deps.eventBus.removeAllListeners('window:z-order-update');
    
    this.activeViews.forEach(view => this.detachView(view));
    this.detachedViews.forEach(view => this.detachView(view));
    this.activeViews.clear();
    this.detachedViews.clear();
  }

  // Missing methods that IPC handlers expect
  public async releaseView(tabId: string): Promise<void> {
    return this.deps.globalTabPool.releaseView(tabId);
  }

  public getView(tabId: string): WebContentsView | undefined {
    return this.deps.globalTabPool.getView(tabId);
  }

  public async showContextMenuOverlay(windowId: string, data: any): Promise<void> {
    // Handle context menu overlay display
    this.logDebug(`Showing context menu overlay for window ${windowId}`);
  }

  public handleOverlayReady(windowId: string): void {
    // Handle overlay ready event
    this.logDebug(`Overlay ready for window ${windowId}`);
  }
}
