import { WebContentsView, clipboard } from 'electron';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserViewManager } from './ClassicBrowserViewManager';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { BrowserEventBus } from './BrowserEventBus';
import { isSecureUrl, isSecureUrlForClipboard, isSecureUrlForDownload, sanitizeUrl } from '../../utils/urlSecurity';
import { BrowserActionData } from '../../shared/types/window.types';

/**
 * Dependencies for ClassicBrowserNavigationService
 */
export interface ClassicBrowserNavigationServiceDeps {
  viewManager: ClassicBrowserViewManager;
  stateService: ClassicBrowserStateService;
  eventBus: BrowserEventBus;
}

/**
 * Service responsible for browser navigation mechanics.
 * Handles URL loading, navigation commands (back/forward/reload/stop),
 * and tracking of significant navigation events.
 */
export class ClassicBrowserNavigationService extends BaseService<ClassicBrowserNavigationServiceDeps> {
  private navigationTracking: Map<string, { lastBaseUrl: string; lastNavigationTime: number }> = new Map();

  constructor(deps: ClassicBrowserNavigationServiceDeps) {
    super('ClassicBrowserNavigationService', deps);
  }

  /**
   * Load a URL in the browser view
   */
  async loadUrl(windowId: string, url: string): Promise<void> {
    const view = this.deps.viewManager.getView(windowId);
    if (!view) {
      this.logError(`loadUrl: No WebContentsView found for windowId ${windowId}`);
      throw new Error(`WebContentsView with ID ${windowId} not found.`);
    }
    if (!url || typeof url !== 'string') {
        this.logError(`loadUrl: Invalid URL provided for windowId ${windowId}: ${url}`);
        throw new Error('Invalid URL provided.');
    }

    // Validate and fix URL format
    let validUrl = url;
    try {
      // Check if URL has a valid protocol
      const urlObj = new URL(url);
      validUrl = urlObj.href;
    } catch {
      // If URL parsing fails, it might be missing a protocol
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        // Assume https:// for URLs without protocol
        validUrl = `https://${url}`;
        this.logDebug(`windowId ${windowId}: Added https:// protocol to URL: ${validUrl}`);
      }
    }

    // Security validation
    if (!isSecureUrl(validUrl, { context: 'navigation' })) {
      this.logError(`windowId ${windowId}: Blocked insecure URL: ${validUrl}`);
      throw new Error(`URL failed security validation: ${validUrl}`);
    }

    this.logDebug(`windowId ${windowId}: Loading URL: ${validUrl}`);
    // Update URL immediately for the address bar to reflect the new target
    this.deps.stateService.sendStateUpdate(windowId, { url: validUrl, isLoading: true, error: null });
    try {
      await view.webContents.loadURL(validUrl);
      // Success will be handled by 'did-navigate' or 'did-stop-loading' events
    } catch (error) {
      // Handle ERR_ABORTED specifically - this happens during redirects and is not a real error
      // Note: Electron may return error.code as empty string or 'ERR_ABORTED'
      if (error instanceof Error && 'errno' in error && error.errno === -3) {
        this.logDebug(`windowId ${windowId}: Navigation aborted (errno -3) for ${url} - normal behavior during rapid navigation or redirects`);
        // Don't throw or show error - the new navigation will complete and trigger did-navigate
        return;
      }
      
      this.logError(`windowId ${windowId}: Error loading URL ${url}:`, error);
      this.deps.stateService.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Failed to initiate loading for ${url}.`
      });
      throw error; // Re-throw to be caught by IPC handler
    }
  }

  /**
   * Navigate the browser view (back, forward, reload, stop)
   */
  navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const view = this.deps.viewManager.getView(windowId);
    if (!view) {
      this.logError(`navigate: No WebContentsView found for windowId ${windowId}`);
      // Optionally throw new Error(`WebContentsView with ID ${windowId} not found.`);
      return; // Or throw, depending on desired strictness
    }

    this.logDebug(`windowId ${windowId}: Performing navigation action: ${action}`);
    const wc = view.webContents;
    switch (action) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.goBack();
        else this.logWarn(`windowId ${windowId}: Cannot go back, no history.`);
        break;
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.goForward();
        else this.logWarn(`windowId ${windowId}: Cannot go forward, no history.`);
        break;
      case 'reload':
        wc.reload();
        break;
      case 'stop':
        wc.stop();
        break;
      default:
        this.logWarn(`windowId ${windowId}: Unknown navigation action: ${action}`);
        return; // Or throw new Error for invalid action
    }
    // State updates (canGoBack, canGoForward, etc.) are typically handled by
    // 'did-navigate' and 'did-stop-loading' listeners after the action completes.
    // However, we can send an immediate update for some states if desired.
    this.deps.stateService.sendStateUpdate(windowId, {
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isLoading: action === 'reload' // Reload implies loading starts
    });
  }

  /**
   * Determine if navigation is significant (for activity logging)
   */
  async isSignificantNavigation(windowId: string, newUrl: string): Promise<boolean> {
    const tracking = this.navigationTracking.get(windowId);
    const newBaseUrl = this.getBaseUrl(newUrl);
    const currentTime = Date.now();
    
    if (!tracking) {
      // First navigation for this window
      this.navigationTracking.set(windowId, {
        lastBaseUrl: newBaseUrl,
        lastNavigationTime: currentTime
      });
      return true;
    }
    
    // Check if base URL changed or if enough time has passed (30 seconds)
    const baseUrlChanged = tracking.lastBaseUrl !== newBaseUrl;
    const timeElapsed = currentTime - tracking.lastNavigationTime;
    const significantTimeElapsed = timeElapsed > 30000; // 30 seconds
    
    if (baseUrlChanged || significantTimeElapsed) {
      this.navigationTracking.set(windowId, {
        lastBaseUrl: newBaseUrl,
        lastNavigationTime: currentTime
      });
      return true;
    }
    
    return false;
  }

  /**
   * Extract base URL (protocol + hostname)
   */
  getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch {
      return url;
    }
  }

  /**
   * Clear navigation tracking for a window
   */
  clearNavigationTracking(windowId: string): void {
    this.navigationTracking.delete(windowId);
  }

  /**
   * Clear all navigation tracking
   */
  clearAllNavigationTracking(): void {
    this.navigationTracking.clear();
  }

  /**
   * Execute a context menu action
   */
  async executeContextMenuAction(windowId: string, action: string, data?: BrowserActionData): Promise<void> {
    const view = this.deps.viewManager.getView(windowId);
    if (!view) {
      throw new Error(`WebContentsView with ID ${windowId} not found.`);
    }

    const webContents = view.webContents;
    this.logDebug(`Executing context menu action: ${action} for window ${windowId}`, data);

    switch (action) {
      // Navigation actions
      case 'navigate:back':
        this.navigate(windowId, 'back');
        break;
      case 'navigate:forward':
        this.navigate(windowId, 'forward');
        break;
      case 'navigate:reload':
        this.navigate(windowId, 'reload');
        break;
      case 'navigate:stop':
        this.navigate(windowId, 'stop');
        break;

      // Link actions
      case 'link:open-new-tab':
        if (data?.url) {
          if (!isSecureUrl(data.url, { context: 'link:open-new-tab' })) {
            this.logWarn(`Blocked insecure URL for new tab: ${data.url}`);
            return;
          }
          this.deps.eventBus.emit('tab:new', { url: data.url, windowId });
        }
        break;
      case 'link:open-background':
        if (data?.url) {
          if (!isSecureUrl(data.url, { context: 'link:open-background' })) {
            this.logWarn(`Blocked insecure URL for background tab: ${data.url}`);
            return;
          }
          // Open link in new tab (background functionality not yet implemented)
          this.deps.eventBus.emit('tab:new', { url: data.url, windowId });
        }
        break;
      case 'link:copy':
        if (data?.url) {
          if (!isSecureUrlForClipboard(data.url)) {
            this.logWarn(`Blocked insecure URL for clipboard: ${data.url}`);
            return;
          }
          // Copy link URL to clipboard
          clipboard.writeText(data.url);
        }
        break;

      // Image actions
      case 'image:open-new-tab':
        if (data?.url) {
          if (!isSecureUrl(data.url, { context: 'image:open-new-tab' })) {
            this.logWarn(`Blocked insecure image URL for new tab: ${data.url}`);
            return;
          }
          // Open image in a new tab
          this.deps.eventBus.emit('tab:new', { url: data.url, windowId });
        }
        break;
      case 'image:save':
        if (data?.url) {
          if (!isSecureUrlForDownload(data.url)) {
            this.logWarn(`Blocked insecure image URL for download: ${data.url}`);
            return;
          }
          // Download the image
          webContents.downloadURL(data.url);
        }
        break;
      case 'image:copy-url':
        if (data?.url) {
          if (!isSecureUrlForClipboard(data.url)) {
            this.logWarn(`Blocked insecure image URL for clipboard: ${data.url}`);
            return;
          }
          // Copy image URL to clipboard
          clipboard.writeText(data.url);
        }
        break;

      // Edit actions
      case 'edit:undo':
        webContents.undo();
        break;
      case 'edit:redo':
        webContents.redo();
        break;
      case 'edit:cut':
        webContents.cut();
        break;
      case 'edit:copy':
        webContents.copy();
        break;
      case 'edit:paste':
        webContents.paste();
        break;
      case 'edit:select-all':
        webContents.selectAll();
        break;

      // Developer actions
      case 'dev:view-source':
        // Open view-source URL in new tab
        const sourceUrl = `view-source:${webContents.getURL()}`;
        this.deps.eventBus.emit('tab:new', { url: sourceUrl });
        break;
      case 'dev:inspect':
        if (data?.x !== undefined && data?.y !== undefined) {
          // Open DevTools and inspect element at coordinates
          webContents.inspectElement(data.x, data.y);
        } else {
          // Just open DevTools
          webContents.openDevTools();
        }
        break;

      // Search actions
      case 'search:enai':
        if (data?.query) {
          // Emit event to trigger Enai search
          this.deps.eventBus.emit('search:enai', { query: data.query });
        }
        break;

      // Page actions
      case 'page:copy-url':
        if (data?.url) {
          if (!isSecureUrlForClipboard(data.url)) {
            this.logWarn(`Blocked insecure page URL for clipboard: ${data.url}`);
            return;
          }
          // Copy page URL to clipboard
          clipboard.writeText(data.url);
        }
        break;

      default:
        this.logWarn(`Unknown context menu action: ${action}`);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.navigationTracking.clear();
    this.logInfo('Navigation service cleaned up');
  }
}