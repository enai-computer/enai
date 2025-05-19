import { BrowserWindow, WebContentsView, ipcMain, WebContents } from 'electron';
import { ON_CLASSIC_BROWSER_STATE } from '../shared/ipcChannels';
import { ClassicBrowserPayload } from '../shared/types';

// Optional: Define a logger utility or use console
const logger = {
  debug: (...args: any[]) => console.log('[ClassicBrowserService]', ...args),
  warn: (...args: any[]) => console.warn('[ClassicBrowserService]', ...args),
  error: (...args: any[]) => console.error('[ClassicBrowserService]', ...args),
};

export class ClassicBrowserService {
  private views: Map<string, WebContentsView> = new Map();
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  private sendStateUpdate(windowId: string, state: Partial<ClassicBrowserPayload>) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(ON_CLASSIC_BROWSER_STATE, {
        windowId,
        state,
      });
    }
  }

  createBrowserView(windowId: string, bounds: Electron.Rectangle, initialUrl?: string): void {
    logger.debug(`Attempting to create WebContentsView for windowId: ${windowId}`);
    if (this.views.has(windowId)) {
      logger.warn(`WebContentsView for windowId ${windowId} already exists.`);
      // Optionally throw an error or simply return
      // throw new Error(`WebContentsView for windowId ${windowId} already exists.`);
      return;
    }

    // Log Electron version (Checklist Item 1.2)
    logger.debug('Electron version:', process.versions.electron);

    const securePrefs: Electron.WebPreferences = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: undefined, // Do not use the app's preload in the embedded browser
      webSecurity: true,
      // It's good practice to disable plugins if not strictly needed
      plugins: false,
    };

    const view = new WebContentsView({ webPreferences: securePrefs });
    this.views.set(windowId, view);

    // Apply border radius to the native view (Checklist Item 3.6 - increased radius)
    (view as any).setBorderRadius(20); 
    logger.debug('✅ setBorderRadius called for windowId:', windowId); // Checklist Item 2.5
    logger.debug('BorderRadius fn typeof:', typeof (view as any).setBorderRadius); // Checklist Item 1.1
    logger.debug('proto chain contains setBorderRadius?', 'setBorderRadius' in Object.getPrototypeOf(view)); // Checklist Item A.2

    // Temporarily set background color to transparent (Checklist Item 3.7)
    (view as any).setBackgroundColor('#00000000');
    logger.debug(`windowId ${windowId}: Set background color to transparent for testing.`);

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        logger.error('Main window is not available to attach WebContentsView.');
        this.views.delete(windowId); // Clean up
        throw new Error('Main window not available.');
    }

    // Reordered operations (Checklist Item 4.10)
    view.setBounds(bounds); // Set initial bounds
    // logger.debug(`windowId ${windowId}: WebContentsView instance created. Setting autoResize.`); // setAutoResize removed
    // view.setAutoResize({ width: true, height: true }); // setAutoResize does not exist on WebContentsView
    this.mainWindow.contentView.addChildView(view); // Use contentView.addChildView

    // Hook WebContentsView events
    const wc = view.webContents as WebContents;

    wc.on('did-start-loading', () => {
      logger.debug(`windowId ${windowId}: did-start-loading`);
      this.sendStateUpdate(windowId, { isLoading: true, error: null });
    });

    wc.on('did-stop-loading', () => {
      logger.debug(`windowId ${windowId}: did-stop-loading`);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        currentUrl: wc.getURL(),
        title: wc.getTitle(),
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
      });
    });

    wc.on('did-navigate', (_event, url) => {
      logger.debug(`windowId ${windowId}: did-navigate to ${url}`);
      this.sendStateUpdate(windowId, {
        currentUrl: url,
        requestedUrl: url, // Align requested and current on successful navigation
        title: wc.getTitle(),
        isLoading: false, // Usually false after navigation, but did-stop-loading is more definitive
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        error: null,
      });
    });

    wc.on('page-title-updated', (_event, title) => {
      logger.debug(`windowId ${windowId}: page-title-updated to ${title}`);
      this.sendStateUpdate(windowId, { title });
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      logger.error(`windowId ${windowId}: did-fail-load for ${validatedURL}. Code: ${errorCode}, Desc: ${errorDescription}`);
      // Avoid showing internal URLs or about:blank as failed URLs if they are not the target
      // if (validatedURL === wc.getURL() || validatedURL === initialUrl) { // Be more specific about which failures to report
      this.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Failed to load: ${errorDescription} (Code: ${errorCode})`,
        // Potentially reset other fields or keep them as is
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
      });
      // }
    });

    wc.on('render-process-gone', (_event, details) => {
      logger.error(`windowId ${windowId}: render-process-gone. Reason: ${details.reason}`);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Browser content process crashed (Reason: ${details.reason}). Please try reloading.`,
      });
      // Optionally, destroy and recreate the view or just leave it to be reloaded by user action.
    });

    if (initialUrl) {
      logger.debug(`windowId ${windowId}: Loading initial URL: ${initialUrl}`);
      // wc.loadURL(initialUrl); // loadUrl method will handle this
      this.loadUrl(windowId, initialUrl).catch(err => {
        logger.error(`windowId ${windowId}: Failed to load initial URL ${initialUrl}:`, err);
        // State update for error already handled by did-fail-load typically
      });
    }
    logger.debug(`WebContentsView for windowId ${windowId} created and listeners attached.`);
  }

  async loadUrl(windowId: string, url: string): Promise<void> {
    const view = this.views.get(windowId);
    if (!view) {
      logger.error(`loadUrl: No WebContentsView found for windowId ${windowId}`);
      throw new Error(`WebContentsView with ID ${windowId} not found.`);
    }
    if (!url || typeof url !== 'string') {
        logger.error(`loadUrl: Invalid URL provided for windowId ${windowId}: ${url}`);
        throw new Error('Invalid URL provided.');
    }

    logger.debug(`windowId ${windowId}: Loading URL: ${url}`);
    // Update requestedUrl immediately for the address bar to reflect the new target
    this.sendStateUpdate(windowId, { requestedUrl: url, isLoading: true, error: null });
    try {
      await view.webContents.loadURL(url);
      // Success will be handled by 'did-navigate' or 'did-stop-loading' events
    } catch (error) {
      logger.error(`windowId ${windowId}: Error loading URL ${url}:`, error);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Failed to initiate loading for ${url}.`
      });
      throw error; // Re-throw to be caught by IPC handler
    }
  }

  navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const view = this.views.get(windowId);
    if (!view) {
      logger.error(`navigate: No WebContentsView found for windowId ${windowId}`);
      // Optionally throw new Error(`WebContentsView with ID ${windowId} not found.`);
      return; // Or throw, depending on desired strictness
    }

    logger.debug(`windowId ${windowId}: Performing navigation action: ${action}`);
    const wc = view.webContents;
    switch (action) {
      case 'back':
        if (wc.canGoBack()) wc.goBack();
        else logger.warn(`windowId ${windowId}: Cannot go back, no history.`);
        break;
      case 'forward':
        if (wc.canGoForward()) wc.goForward();
        else logger.warn(`windowId ${windowId}: Cannot go forward, no history.`);
        break;
      case 'reload':
        wc.reload();
        break;
      case 'stop':
        wc.stop();
        break;
      default:
        logger.warn(`windowId ${windowId}: Unknown navigation action: ${action}`);
        return; // Or throw new Error for invalid action
    }
    // State updates (canGoBack, canGoForward, etc.) are typically handled by
    // 'did-navigate' and 'did-stop-loading' listeners after the action completes.
    // However, we can send an immediate update for some states if desired.
    this.sendStateUpdate(windowId, {
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        isLoading: action === 'reload' // Reload implies loading starts
    });
  }

  setBounds(windowId: string, bounds: Electron.Rectangle): void {
    const view = this.views.get(windowId);
    if (!view) {
      logger.warn(`setBounds: No WebContentsView found for windowId ${windowId}. Cannot set bounds.`);
      return;
    }
    logger.debug(`windowId ${windowId}: Setting bounds to ${JSON.stringify(bounds)}`);
    view.setBounds(bounds);
  }

  setVisibility(windowId: string, isVisible: boolean): void {
    const view = this.views.get(windowId);
    if (!view) {
      logger.warn(`setVisibility: No WebContentsView found for windowId ${windowId}. Cannot set visibility.`);
      return;
    }

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        logger.error('setVisibility: Main window is not available.');
        return;
    }

    logger.debug(`windowId ${windowId}: Setting visibility to ${isVisible}`);
    // Check if the view is a child of the mainWindow's contentView
    const viewIsAttached = this.mainWindow.contentView.children.includes(view);

    if (isVisible) {
      if (!viewIsAttached) {
        this.mainWindow.contentView.addChildView(view); // Use contentView.addChildView
        logger.debug(`windowId ${windowId}: Attached WebContentsView.`);
      }
      // Potentially bring to front if multiple views are supported more actively.
      // For now, addBrowserView should place it on top of existing ones if it was removed.
      // If already attached, it might need specific z-ordering logic if views overlap.
    } else {
      if (viewIsAttached) {
        this.mainWindow.contentView.removeChildView(view); // Use contentView.removeChildView
        logger.debug(`windowId ${windowId}: Removed WebContentsView.`);
      }
    }
  }

  destroyBrowserView(windowId: string): void {
    const view = this.views.get(windowId);
    if (!view) {
      logger.warn(`destroyBrowserView: No WebContentsView found for windowId ${windowId}. Nothing to destroy.`);
      return;
    }

    logger.debug(`windowId ${windowId}: Destroying WebContentsView.`);
    
    // Detach from window if attached
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        // Check if the view is a child of the mainWindow's contentView
        if (this.mainWindow.contentView.children.includes(view)) {
            this.mainWindow.contentView.removeChildView(view); // Use contentView.removeChildView
        }
    }

    // Electron's documentation for BrowserView.destroy() is missing.
    // WebContents.destroy() is not a valid method.
    // Removing the view from the BrowserWindow and dereferencing it (by deleting from the map)
    // is the standard way to allow it to be garbage collected along with its WebContents.
    // If specific webContents cleanup is needed (e.g., stopping pending navigations), it can be done here:
    // if (view.webContents && !view.webContents.isDestroyed()) {
    //   view.webContents.stop(); // Example: stop any pending loads
    // }

    this.views.delete(windowId);
    logger.debug(`windowId ${windowId}: WebContentsView destroyed and removed from map.`);
  }

  destroyAllBrowserViews(): void {
    logger.debug('Destroying all WebContentsViews.');
    this.views.forEach((_view, windowId) => {
        this.destroyBrowserView(windowId);
    });
  }
} 