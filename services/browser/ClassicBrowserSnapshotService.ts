import { BaseService } from '../base/BaseService';
import { ClassicBrowserViewManager } from './ClassicBrowserViewManager';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { ClassicBrowserNavigationService } from './ClassicBrowserNavigationService';
import { isAuthenticationUrl } from './url.helpers';

interface ClassicBrowserSnapshotServiceDeps {
  viewManager: ClassicBrowserViewManager;
  stateService: ClassicBrowserStateService;
  navigationService: ClassicBrowserNavigationService;
}

export class ClassicBrowserSnapshotService extends BaseService<ClassicBrowserSnapshotServiceDeps> {
  private snapshots: Map<string, string> = new Map();
  private static readonly MAX_SNAPSHOTS = 10;

  constructor(deps: ClassicBrowserSnapshotServiceDeps) {
    super('ClassicBrowserSnapshotService', deps);
  }

  async captureSnapshot(windowId: string): Promise<{ url: string; snapshot: string } | undefined> {
    // Get the active tab for this window
    const browserState = this.deps.stateService.states.get(windowId);
    if (!browserState || !browserState.activeTabId) {
      this.logWarn(`No active tab found for window ${windowId}`);
      return undefined;
    }

    const view = this.deps.viewManager.getView(browserState.activeTabId);
    if (!view) {
      this.logWarn(`No browser view found for active tab ${browserState.activeTabId} in window ${windowId}`);
      return undefined;
    }

    return this.execute('captureSnapshot', async () => {
      const currentUrl = view.webContents.getURL();
      if (isAuthenticationUrl(currentUrl)) {
        this.logInfo(`Skipping snapshot capture for authentication URL: ${currentUrl}`);
        return undefined;
      }

      try {
        const image = await view.webContents.capturePage();
        const snapshot = image.toDataURL();
        
        this.storeSnapshotWithLRU(windowId, snapshot);
        
        return { url: currentUrl, snapshot };
      } catch (error) {
        this.logError(`Failed to capture snapshot for window ${windowId}:`, error);
        return undefined;
      }
    });
  }

  showAndFocusView(windowId: string): void {
    const snapshot = this.snapshots.get(windowId);
    
    if (snapshot) {
      this.logDebug(`Showing snapshot for window ${windowId}`);
      // In a real implementation, this would emit an event or update state
      // to display the snapshot in the UI
    } else {
      this.logDebug(`No snapshot available for window ${windowId}`);
    }
  }

  clearSnapshot(windowId: string): void {
    if (this.snapshots.delete(windowId)) {
      this.logDebug(`Cleared snapshot for window ${windowId}`);
    }
  }

  clearAllSnapshots(): void {
    const count = this.snapshots.size;
    this.snapshots.clear();
    this.logInfo(`Cleared all ${count} snapshots`);
  }

  private storeSnapshotWithLRU(windowId: string, snapshot: string): void {
    // Remove the windowId if it already exists to re-add it at the end
    this.snapshots.delete(windowId);
    
    // If we're at max capacity, remove the oldest entry
    if (this.snapshots.size >= ClassicBrowserSnapshotService.MAX_SNAPSHOTS) {
      const oldestKey = this.snapshots.keys().next().value;
      if (oldestKey) {
        this.snapshots.delete(oldestKey);
        this.logDebug(`Removed oldest snapshot for window ${oldestKey} due to LRU`);
      }
    }
    
    // Add the new snapshot
    this.snapshots.set(windowId, snapshot);
    this.logDebug(`Stored snapshot for window ${windowId}. Total snapshots: ${this.snapshots.size}`);
  }

  getSnapshot(windowId: string): string | undefined {
    return this.snapshots.get(windowId);
  }

  getAllSnapshots(): Map<string, string> {
    return new Map(this.snapshots);
  }

  async cleanup(): Promise<void> {
    this.clearAllSnapshots();
    await super.cleanup();
  }

  // Simplified method that returns just the snapshot string for compatibility
  async captureSnapshotString(windowId: string): Promise<string> {
    const result = await this.captureSnapshot(windowId);
    return result?.snapshot || '';
  }
}