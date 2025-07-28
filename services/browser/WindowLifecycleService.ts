import { BaseService } from '../base/BaseService';
import { BrowserEventBus } from './BrowserEventBus';
import type { WindowMeta } from '../../shared/types/window.types';

export interface WindowLifecycleServiceDeps {
  eventBus: BrowserEventBus;
}

/**
 * Service that bridges window store state changes to browser events.
 * This enables the browser services to react to window lifecycle changes
 * like focus, minimize, restore, and z-order updates.
 */
export class WindowLifecycleService extends BaseService<WindowLifecycleServiceDeps> {
  private previousWindows: Map<string, WindowMeta> = new Map();

  constructor(deps: WindowLifecycleServiceDeps) {
    super('WindowLifecycleService', deps);
  }

  /**
   * Processes window state changes and emits appropriate browser events.
   * This should be called whenever the window store state changes.
   */
  public async processWindowStateChanges(windows: WindowMeta[]): Promise<void> {
    return this.execute('processWindowStateChanges', async () => {
      const currentWindows = new Map(windows.map(w => [w.id, w]));
      const browserWindows = windows.filter(w => w.type === 'classic-browser');

      // Check for focus changes
      for (const window of browserWindows) {
        const previous = this.previousWindows.get(window.id);
        
        if (previous && previous.isFocused !== window.isFocused) {
          this.deps.eventBus.emit('window:focus-changed', {
            windowId: window.id,
            isFocused: window.isFocused,
            zIndex: window.zIndex
          });
        }

        // Check for minimize/restore
        if (previous) {
          const wasMinimized = previous.isMinimized || false;
          const isMinimized = window.isMinimized || false;

          if (!wasMinimized && isMinimized) {
            this.deps.eventBus.emit('window:minimized', {
              windowId: window.id
            });
          } else if (wasMinimized && !isMinimized) {
            this.deps.eventBus.emit('window:restored', {
              windowId: window.id,
              zIndex: window.zIndex
            });
          }
        }
      }

      // Check for z-order changes (if any browser window z-index changed)
      const hasZOrderChange = browserWindows.some(window => {
        const previous = this.previousWindows.get(window.id);
        return previous && previous.zIndex !== window.zIndex;
      });

      if (hasZOrderChange || this.hasBrowserWindowCountChanged(browserWindows)) {
        // Emit z-order update with all browser windows sorted by z-index
        const orderedWindows = browserWindows
          .sort((a, b) => a.zIndex - b.zIndex)
          .map(w => ({
            windowId: w.id,
            zIndex: w.zIndex,
            isFocused: w.isFocused,
            isMinimized: w.isMinimized || false
          }));

        this.deps.eventBus.emit('window:z-order-update', { orderedWindows });
      }

      // Update our cache
      this.previousWindows = currentWindows;
    });
  }

  private hasBrowserWindowCountChanged(currentBrowserWindows: WindowMeta[]): boolean {
    const previousBrowserWindows = Array.from(this.previousWindows.values())
      .filter(w => w.type === 'classic-browser');
    
    return currentBrowserWindows.length !== previousBrowserWindows.length;
  }

  async cleanup(): Promise<void> {
    this.previousWindows.clear();
    await super.cleanup();
  }
}