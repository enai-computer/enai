
import { BrowserWindow, WebContentsView } from 'electron';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserPayload } from '../../shared/types';
import { BrowserEventBus } from './BrowserEventBus';
import { GlobalTabPool } from './GlobalTabPool';

export interface ClassicBrowserViewManagerDeps {
  mainWindow: BrowserWindow;
  eventBus: BrowserEventBus;
  globalTabPool: GlobalTabPool;
}

/**
 * Manages the presentation layer of the browser, ensuring the visual
 * state of WebContentsViews matches the application state.
 */
export class ClassicBrowserViewManager extends BaseService<ClassicBrowserViewManagerDeps> {
  private activeViews: Map<string, WebContentsView> = new Map(); // windowId -> view

  constructor(deps: ClassicBrowserViewManagerDeps) {
    super('ClassicBrowserViewManager', deps);
  }

  async initialize(): Promise<void> {
    this.deps.eventBus.on('state-changed', this.handleStateChange.bind(this));
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

  async cleanup(): Promise<void> {
    this.deps.eventBus.removeAllListeners('state-changed');
    this.activeViews.forEach(view => this.detachView(view));
    this.activeViews.clear();
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
