import { BrowserWindow, WebContentsView, ipcMain, WebContents } from 'electron';
import { ON_CLASSIC_BROWSER_STATE, CLASSIC_BROWSER_VIEW_FOCUSED, ON_CLASSIC_BROWSER_CMD_CLICK } from '../shared/ipcChannels';
import { ClassicBrowserPayload } from '../shared/types';
import { getActivityLogService } from './ActivityLogService';
import { logger } from '../utils/logger';

export class ClassicBrowserService {
  private views: Map<string, WebContentsView> = new Map();
  private mainWindow: BrowserWindow;
  private navigationTracking: Map<string, { lastBaseUrl: string; lastNavigationTime: number }> = new Map();
  private prefetchViews: Map<string, WebContentsView> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    // Start periodic cleanup of stale prefetch views
    this.startPrefetchCleanup();
  }

  /**
   * Start periodic cleanup of stale prefetch views to prevent memory leaks
   */
  private startPrefetchCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePrefetchViews();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Clean up any stale prefetch views that may have been abandoned
   */
  private cleanupStalePrefetchViews(): void {
    const staleEntries: string[] = [];
    
    for (const [windowId, view] of this.prefetchViews.entries()) {
      try {
        // Check if the WebContents still exists and isn't destroyed
        if (!view || !view.webContents || view.webContents.isDestroyed()) {
          staleEntries.push(windowId);
        }
      } catch (error) {
        // If accessing webContents throws, it's definitely stale
        staleEntries.push(windowId);
      }
    }
    
    if (staleEntries.length > 0) {
      logger.debug(`[ClassicBrowserService] Cleaning up ${staleEntries.length} stale prefetch views`);
      staleEntries.forEach(windowId => this.prefetchViews.delete(windowId));
    }
  }

  /**
   * Clean up prefetch resources for a specific window
   */
  private cleanupPrefetchResources(
    windowId: string, 
    timeoutId: NodeJS.Timeout | null, 
    webContents: Electron.WebContents | null
  ): void {
    // Clear timeout if it exists
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    // Stop and destroy WebContents if it exists and isn't destroyed
    if (webContents) {
      try {
        if (!webContents.isDestroyed()) {
          webContents.stop();
          // Use type assertion to access destroy method
          (webContents as any).destroy();
        }
      } catch (error) {
        logger.debug(`[ClassicBrowserService] Error during WebContents cleanup for ${windowId}:`, error);
      }
    }
    
    // Remove from tracking map
    this.prefetchViews.delete(windowId);
    
    logger.debug(`[ClassicBrowserService] Cleaned up prefetch resources for ${windowId}`);
  }

  // Check if a URL is from an ad/tracking/analytics domain
  private isAdOrTrackingUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Common ad/tracking/analytics patterns
      const adPatterns = [
        // Ad networks
        'doubleclick', 'googlesyndication', 'googleadservices', 'googletag',
        'adsystem', 'adsrvr', 'adnxs', 'adsafeprotected', 'amazon-adsystem',
        'facebook.com/tr', 'fbcdn.net', 'moatads', 'openx', 'pubmatic',
        'rubicon', 'scorecardresearch', 'serving-sys', 'taboola', 'outbrain',
        
        // Analytics/tracking
        'google-analytics', 'googletagmanager', 'analytics', 'omniture',
        'segment.', 'mixpanel', 'hotjar', 'mouseflow', 'clicktale',
        'newrelic', 'pingdom', 'quantserve', 'comscore', 'chartbeat',
        
        // User sync/cookie matching
        'sync.', 'match.', 'pixel.', 'cm.', 'rtb.', 'bidder.',
        'partners.tremorhub', 'ad.turn', 'mathtag', 'bluekai',
        'demdex', 'exelator', 'eyeota', 'tapad', 'rlcdn', 'rfihub',
        'casalemedia', 'contextweb', 'districtm', 'sharethrough',
        
        // Other common patterns
        'metric.', 'telemetry.', 'tracking.', 'track.', 'tags.',
        'stats.', 'counter.', 'log.', 'logger.', 'collect.',
        'beacon.', 'pixel', 'impression', '.ads.', 'adserver',
        'creative.', 'banner.', 'popup.', 'pop.', 'affiliate'
      ];
      
      // Domain starts that are typically ads/tracking
      const domainStarts = [
        'ad.', 'ads.', 'adsdk.', 'adx.', 'analytics.', 'stats.',
        'metric.', 'telemetry.', 'tracking.', 'track.', 'pixel.',
        'sync.', 'match.', 'rtb.', 'ssp.', 'dsp.', 'cm.'
      ];
      
      // Check if hostname starts with any ad pattern
      if (domainStarts.some(start => hostname.startsWith(start))) {
        return true;
      }
      
      // Check if hostname contains any ad pattern
      if (adPatterns.some(pattern => hostname.includes(pattern))) {
        return true;
      }
      
      // Check path for common tracking endpoints
      const pathPatterns = ['/pixel', '/sync', '/match', '/track', '/collect', '/beacon', '/impression'];
      if (pathPatterns.some(pattern => urlObj.pathname.includes(pattern))) {
        return true;
      }
      
      return false;
    } catch (e) {
      // If URL parsing fails, don't filter it out
      return false;
    }
  }

  // Public getter for a view
  public getView(windowId: string): WebContentsView | undefined {
    return this.views.get(windowId);
  }

  // Helper to extract base URL (protocol + hostname)
  private getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch {
      return url;
    }
  }

  // Determine if navigation is significant
  private async isSignificantNavigation(windowId: string, newUrl: string): Promise<boolean> {
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

  private sendStateUpdate(windowId: string, state: Partial<ClassicBrowserPayload>) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(ON_CLASSIC_BROWSER_STATE, {
        windowId,
        state,
      });
    }
  }

  createBrowserView(windowId: string, bounds: Electron.Rectangle, initialUrl?: string): void {
    logger.debug(`[CREATE] Attempting to create WebContentsView for windowId: ${windowId}`);
    logger.debug(`[CREATE] Current views in map: ${Array.from(this.views.keys()).join(', ')}`);
    logger.debug(`[CREATE] Caller stack:`, new Error().stack?.split('\n').slice(2, 5).join('\n'));
    
    // Check if view exists and is still valid
    const existingView = this.views.get(windowId);
    if (existingView) {
      try {
        // Check if the webContents is destroyed
        if (existingView.webContents && !existingView.webContents.isDestroyed()) {
          logger.warn(`WebContentsView for windowId ${windowId} already exists and is valid. Loading new URL.`);
          // If view already exists and is valid, just load the new URL
          if (initialUrl) {
            this.loadUrl(windowId, initialUrl);
          }
          return;
        } else {
          // View exists but webContents is destroyed, clean it up
          logger.warn(`WebContentsView for windowId ${windowId} exists but is destroyed. Cleaning up.`);
          this.views.delete(windowId);
          this.navigationTracking.delete(windowId);
        }
      } catch (error) {
        // If we can't check the view state, assume it's invalid and clean up
        logger.warn(`Error checking WebContentsView state for windowId ${windowId}. Cleaning up.`, error);
        this.views.delete(windowId);
        this.navigationTracking.delete(windowId);
      }
    }

    // Log Electron version (Checklist Item 1.2)
    logger.debug('Electron version:', process.versions.electron);

    const securePrefs: Electron.WebPreferences = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: undefined, // Do not use the app's preload in the embedded browser
      webSecurity: true,
      // Enable plugins to support PDF viewer
      plugins: true,
    };

    const view = new WebContentsView({ webPreferences: securePrefs });
    this.views.set(windowId, view);

    // Apply border radius to the native view
    // WebLayer uses 18px border radius, regular windows use 10px (12px - 2px border inset)
    const borderRadius = windowId === '__WEBLAYER_SINGLETON__' ? 18 : 10;
    (view as any).setBorderRadius(borderRadius); 
    logger.debug(`✅ setBorderRadius called for windowId: ${windowId} with radius: ${borderRadius}px`);
    logger.debug('BorderRadius fn typeof:', typeof (view as any).setBorderRadius);
    logger.debug('proto chain contains setBorderRadius?', 'setBorderRadius' in Object.getPrototypeOf(view));

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

    // --- Injected Script for CMD+Click Handling ---
    const cmdClickInterceptorScript = `
      (() => {
        document.addEventListener('click', (event) => {
          // Find the nearest ancestor 'a' tag
          const link = event.target.closest('a');
          if (link && (event.metaKey || event.ctrlKey)) {
            // Prevent the default action (opening in the same view or a new OS window)
            event.preventDefault();
            
            const targetUrl = link.href;
            if (targetUrl) {
              // Use a custom, non-existent protocol to send the URL to the main process.
              // This will be caught by the 'will-navigate' event listener.
              window.location.href = \`jeffers-ipc://cmd-click/\${encodeURIComponent(targetUrl)}\`;
            }
          }
        }, true); // Use capture phase to catch the event early
      })();
    `;

    wc.on('dom-ready', () => {
      wc.executeJavaScript(cmdClickInterceptorScript).catch(err => {
        logger.error(`windowId ${windowId}: Failed to inject CMD+click interceptor script:`, err);
      });
    });
    // --- End Injected Script ---

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

    wc.on('did-navigate', async (_event, url) => {
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
      
      // Log significant navigations
      try {
        if (await this.isSignificantNavigation(windowId, url)) {
          await getActivityLogService().logActivity({
            activityType: 'browser_navigation',
            details: {
              windowId: windowId,
              url: url,
              title: wc.getTitle(),
              baseUrl: this.getBaseUrl(url),
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (logError) {
        logger.error('[ClassicBrowserService] Failed to log navigation activity:', logError);
      }
    });

    wc.on('page-title-updated', (_event, title) => {
      logger.debug(`windowId ${windowId}: page-title-updated to ${title}`);
      this.sendStateUpdate(windowId, { title });
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      logger.debug(`windowId ${windowId}: page-favicon-updated with ${favicons.length} favicons`);
      // Use the first favicon URL if available
      const faviconUrl = favicons.length > 0 ? favicons[0] : null;
      this.sendStateUpdate(windowId, { faviconUrl });
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      // Always log the error for debugging
      logger.error(`windowId ${windowId}: did-fail-load for ${validatedURL}. Code: ${errorCode}, Desc: ${errorDescription}`);
      
      // Filter out ad/tracking domain errors from UI
      if (this.isAdOrTrackingUrl(validatedURL)) {
        logger.debug(`windowId ${windowId}: Filtered ad/tracking error from UI for ${validatedURL}`);
        return;
      }
      
      // Only show errors for the main frame or significant resources
      const currentUrl = wc.getURL();
      const isMainFrameError = validatedURL === currentUrl || validatedURL === initialUrl;
      
      // For non-main-frame errors, only show if it's not an ad/tracking domain
      if (isMainFrameError || !this.isAdOrTrackingUrl(validatedURL)) {
        this.sendStateUpdate(windowId, {
          isLoading: false,
          error: `Failed to load: ${errorDescription} (Code: ${errorCode})`,
          canGoBack: wc.canGoBack(),
          canGoForward: wc.canGoForward(),
        });
      }
    });

    wc.on('render-process-gone', (_event, details) => {
      logger.error(`windowId ${windowId}: render-process-gone. Reason: ${details.reason}`);
      this.sendStateUpdate(windowId, {
        isLoading: false,
        error: `Browser content process crashed (Reason: ${details.reason}). Please try reloading.`,
      });
      // Optionally, destroy and recreate the view or just leave it to be reloaded by user action.
    });

    // Handle navigation that would open in a new window
    wc.setWindowOpenHandler((details) => {
      // Log every attempt, regardless of disposition
      logger.debug(`[setWindowOpenHandler] Intercepted window open request`, details);
      
      // Check if this is a CMD+click (or middle-click) which typically opens in new tab/window
      const isNewWindowRequest = details.disposition === 'new-window' || 
                                 details.disposition === 'foreground-tab' ||
                                 details.disposition === 'background-tab';
      
      if (isNewWindowRequest) {
        // For CMD+click, notify the renderer to create a new minimized browser
        logger.debug(`windowId ${windowId}: CMD+click detected, notifying renderer to create minimized browser`);
        
        // Send message to renderer to create a new minimized browser
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(ON_CLASSIC_BROWSER_CMD_CLICK, {
            sourceWindowId: windowId,
            targetUrl: details.url
          });
        }
        
        // Deny the new window creation since we're handling it ourselves
        return { action: 'deny' };
      }
      
      // For regular clicks, navigate in the same window
      this.loadUrl(windowId, details.url);
      // Deny the new window creation
      return { action: 'deny' };
    });

    // Handle navigation attempts (including link clicks)
    wc.on('will-navigate', (event, url) => {
      // Check for our custom IPC protocol
      if (url.startsWith('jeffers-ipc://cmd-click/')) {
        // This is a CMD+click event we captured.
        event.preventDefault(); // Stop the bogus navigation
        
        try {
          const encodedUrl = url.substring('jeffers-ipc://cmd-click/'.length);
          const targetUrl = decodeURIComponent(encodedUrl);
          
          logger.debug(`windowId ${windowId}: Intercepted CMD+click via custom protocol for URL: ${targetUrl}`);
          
          // Send the message to the renderer to create a new minimized browser
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(ON_CLASSIC_BROWSER_CMD_CLICK, {
              sourceWindowId: windowId,
              targetUrl: targetUrl
            });
          }
        } catch (err) {
          logger.error(`windowId ${windowId}: Failed to decode CMD+click IPC URL:`, err);
        }
        return;
      }

      logger.debug(`windowId ${windowId}: will-navigate to ${url}`);
      
      // Original logic for will-navigate can go here if any exists
    });

    // Handle iframe navigations that might try to open new windows
    wc.on('did-attach-webview', (event, webContents) => {
      logger.debug(`windowId ${windowId}: Attached webview, setting up handlers`);
      webContents.setWindowOpenHandler((details) => {
        logger.debug(`windowId ${windowId}: Iframe intercepted new window request to ${details.url}`);
        // Navigate in the parent WebLayer instead
        this.loadUrl(windowId, details.url);
        return { action: 'deny' };
      });
    });

    // NEW: Listen for focus events on the WebContentsView
    wc.on('focus', () => {
      logger.debug(`windowId ${windowId}: WebContentsView received focus.`);
      // Action 1: Bring the native view to the top of other native views.
      // WebContents.hostWebContentsView is not a documented API.
      // We need to ensure 'view' (the WebContentsView instance) is accessible here.
      // 'view' is in scope from the outer createBrowserView function.
      const view = this.views.get(windowId);
      if (this.mainWindow && !this.mainWindow.isDestroyed() && view) {
        this.mainWindow.contentView.addChildView(view); // Re-adding brings to front
        logger.debug(`windowId ${windowId}: Native view brought to front via addChildView on focus.`);
      }

      // Action 2: Notify the renderer that this view has gained focus.
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(CLASSIC_BROWSER_VIEW_FOCUSED, { windowId });
      }
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

    // Validate and fix URL format
    let validUrl = url;
    try {
      // Check if URL has a valid protocol
      const urlObj = new URL(url);
      validUrl = urlObj.href;
    } catch (e) {
      // If URL parsing fails, it might be missing a protocol
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        // Assume https:// for URLs without protocol
        validUrl = `https://${url}`;
        logger.debug(`windowId ${windowId}: Added https:// protocol to URL: ${validUrl}`);
      }
    }

    logger.debug(`windowId ${windowId}: Loading URL: ${validUrl}`);
    // Update requestedUrl immediately for the address bar to reflect the new target
    this.sendStateUpdate(windowId, { requestedUrl: validUrl, isLoading: true, error: null });
    try {
      await view.webContents.loadURL(validUrl);
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

  setVisibility(windowId: string, shouldBeDrawn: boolean, isFocused: boolean): void {
    const view = this.views.get(windowId);
    if (!view) {
      logger.warn(`setVisibility: No WebContentsView found for windowId ${windowId}. Cannot set visibility.`);
      return;
    }

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        logger.error('setVisibility: Main window is not available.');
        return;
    }

    // The 'isFocused' parameter is no longer used here to re-order views.
    // Focus-based re-ordering is now handled by the 'focus' event listener on webContents.
    logger.debug(`windowId ${windowId}: Setting visibility - shouldBeDrawn: ${shouldBeDrawn}. 'isFocused' (${isFocused}) is ignored for stacking here.`);
    
    const viewIsAttached = this.mainWindow.contentView.children.includes(view);

    if (shouldBeDrawn) {
      if (!viewIsAttached) {
        this.mainWindow.contentView.addChildView(view); 
        logger.debug(`windowId ${windowId}: Attached WebContentsView because shouldBeDrawn is true and not attached.`);
      }
      (view as any).setVisible(true); // Make sure it's drawable

      // If this view is also meant to be focused, ensure it's the top-most native view.
      if (isFocused) {
        this.mainWindow.contentView.addChildView(view); // Re-adding an existing child brings it to the front.
        logger.debug(`windowId ${windowId}: Explicitly brought to front in setVisibility (shouldBeDrawn=true, isFocused=true).`);
      }

    } else { // Not to be drawn (e.g., minimized or window explicitly hidden)
      (view as any).setVisible(false); // Make it not drawable
      logger.debug(`windowId ${windowId}: Set WebContentsView to not visible because shouldBeDrawn is false.`);
      if (viewIsAttached) {
        this.mainWindow.contentView.removeChildView(view);
        logger.debug(`windowId ${windowId}: Removed WebContentsView from contentView because shouldBeDrawn is false.`);
      }
    }
  }

  async destroyBrowserView(windowId: string): Promise<void> {
    logger.debug(`[DESTROY] Attempting to destroy WebContentsView for windowId: ${windowId}`);
    logger.debug(`[DESTROY] Current views in map: ${Array.from(this.views.keys()).join(', ')}`);
    logger.debug(`[DESTROY] Caller stack:`, new Error().stack?.split('\n').slice(2, 5).join('\n'));
    
    // Atomically get and remove the view from the map to prevent race conditions.
    const view = this.views.get(windowId);
    if (!view) {
      logger.warn(`[DESTROY] No WebContentsView found for windowId ${windowId}. Nothing to destroy.`);
      return;
    }

    // By deleting it here, we prevent concurrent destroy calls from operating on the same view object.
    this.views.delete(windowId);
    this.navigationTracking.delete(windowId);
    logger.debug(`[DESTROY] Found and removed view for ${windowId} from map. Proceeding with destruction.`);
    
    // Detach from window if attached
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
            // Check if the view is a child of the mainWindow's contentView
            if (this.mainWindow.contentView && this.mainWindow.contentView.children.includes(view)) {
                this.mainWindow.contentView.removeChildView(view); // Use contentView.removeChildView
            }
        } catch (error) {
            logger.warn(`[DESTROY] Error detaching view from window (might already be detached):`, error);
        }
    }

    // Stop any media playback and cleanup before destroying
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) {
        try {
            // Mute audio immediately to stop sound
            wc.setAudioMuted(true);
            
            // Stop any pending loads
            wc.stop();
            
            // Only try to execute JavaScript if the page has loaded and not crashed
            if (!wc.isLoading() && !wc.isCrashed()) {
                try {
                    // Execute JavaScript to pause all media elements
                    await wc.executeJavaScript(`
                        (function() {
                            try {
                                // Pause all video elements
                                const videos = document.querySelectorAll('video');
                                videos.forEach(video => {
                                    try {
                                        video.pause();
                                        video.currentTime = 0;
                                    } catch (e) {}
                                });
                                
                                // Pause all audio elements
                                const audios = document.querySelectorAll('audio');
                                audios.forEach(audio => {
                                    try {
                                        audio.pause();
                                        audio.currentTime = 0;
                                    } catch (e) {}
                                });
                                
                                // YouTube specific: stop via YouTube API if available
                                if (typeof window !== 'undefined' && window.YT) {
                                    try {
                                        const players = document.querySelectorAll('.html5-video-player');
                                        players.forEach(player => {
                                            if (player.pauseVideo) player.pauseVideo();
                                        });
                                    } catch (e) {}
                                }
                            } catch (e) {
                                // Ignore errors, best effort cleanup
                            }
                            return true;
                        })();
                    `, true); // Add userGesture to be safe
                } catch (scriptError) {
                    // Ignore script errors, continue with destruction
                    logger.debug(`windowId ${windowId}: Script execution error during cleanup (ignored):`, scriptError);
                }
            }
            
            // Small delay to ensure media cleanup takes effect
            await new Promise(resolve => setTimeout(resolve, 50));
            
            logger.debug(`windowId ${windowId}: Stopped media playback and cleared page.`);
        } catch (error) {
            logger.warn(`windowId ${windowId}: Error during media cleanup (ignored):`, error);
        }
    }

    // Finally, destroy the webContents to ensure complete cleanup if it still exists and isn't destroyed.
    if (view.webContents && !view.webContents.isDestroyed()) {
      (view.webContents as any).destroy();
    }
    
    logger.debug(`windowId ${windowId}: WebContentsView destruction process completed.`);
  }

  async destroyAllBrowserViews(): Promise<void> {
    logger.debug('Destroying all WebContentsViews.');
    const destroyPromises = Array.from(this.views.keys()).map(windowId => 
        this.destroyBrowserView(windowId)
    );
    await Promise.all(destroyPromises);
  }

  /**
   * Prefetch favicon for a URL without displaying the window.
   * This creates a hidden WebContentsView that loads the page just enough to get the favicon.
   */
  async prefetchFavicon(windowId: string, url: string): Promise<string | null> {
    logger.debug(`[prefetchFavicon] Starting favicon prefetch for ${windowId} with URL: ${url}`);
    
    // Don't prefetch for file:// URLs (PDFs, local files)
    if (url.startsWith('file://')) {
      logger.debug(`[prefetchFavicon] Skipping file:// URL for ${windowId}`);
      return null;
    }

    // Clean up any existing prefetch view for this window
    const existingView = this.prefetchViews.get(windowId);
    if (existingView) {
      logger.debug(`[prefetchFavicon] Cleaning up existing prefetch view for ${windowId}`);
      if (!existingView.webContents.isDestroyed()) {
        (existingView.webContents as any).destroy();
      }
      this.prefetchViews.delete(windowId);
    }

    return new Promise((resolve) => {
      try {
        // Create a hidden WebContentsView for prefetching
        const prefetchView = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            javascript: false, // Disable JS for security and performance
            images: false, // Don't load images, we only need the favicon
            webgl: false,
            plugins: false,
          }
        });

        this.prefetchViews.set(windowId, prefetchView);
        const wc = prefetchView.webContents;

        // Set a timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          logger.warn(`[prefetchFavicon] Timeout reached for ${windowId}`);
          this.cleanupPrefetchResources(windowId, null, wc);
          resolve(null);
        }, 10000); // 10 second timeout

        // Listen for favicon
        let faviconFound = false;
        wc.on('page-favicon-updated', (_event, favicons) => {
          if (!faviconFound && favicons.length > 0) {
            faviconFound = true;
            const faviconUrl = favicons[0];
            logger.debug(`[prefetchFavicon] Found favicon for ${windowId}: ${faviconUrl}`);
            
            // Check if window still exists before updating state
            if (this.views.has(windowId)) {
              this.sendStateUpdate(windowId, { faviconUrl });
            } else {
              logger.debug(`[prefetchFavicon] Window ${windowId} no longer exists, skipping favicon update`);
            }
            
            // Clean up using the helper method
            this.cleanupPrefetchResources(windowId, timeoutId, wc);
            resolve(faviconUrl);
          }
        });

        // Also listen for did-stop-loading in case there's no favicon
        wc.once('did-stop-loading', () => {
          // Wait a bit after page load to see if favicon appears
          setTimeout(() => {
            if (!faviconFound && this.prefetchViews.has(windowId)) {
              logger.debug(`[prefetchFavicon] No favicon found for ${windowId} after page load`);
              this.cleanupPrefetchResources(windowId, timeoutId, wc);
              resolve(null);
            }
          }, 1000);
        });

        // Handle errors
        wc.on('did-fail-load', (_event, errorCode, errorDescription) => {
          // Only log error if window still exists (otherwise it's expected)
          if (this.views.has(windowId)) {
            logger.error(`[prefetchFavicon] Failed to load page for active window ${windowId}: ${errorDescription}`);
          } else {
            logger.debug(`[prefetchFavicon] Load failed for destroyed window ${windowId} (expected)`);
          }
          this.cleanupPrefetchResources(windowId, timeoutId, wc);
          resolve(null);
        });

        // Start loading the page
        logger.debug(`[prefetchFavicon] Loading URL for ${windowId}: ${url}`);
        wc.loadURL(url);

      } catch (error) {
        logger.error(`[prefetchFavicon] Error during prefetch for ${windowId}:`, error);
        this.cleanupPrefetchResources(windowId, null, null);
        resolve(null);
      }
    });
  }

  /**
   * Prefetch favicons for multiple windows in parallel.
   * Used after notebook composition to load favicons for all minimized browser windows.
   */
  async prefetchFaviconsForWindows(windows: Array<{ windowId: string; url: string }>): Promise<void> {
    logger.info(`[prefetchFaviconsForWindows] Prefetching favicons for ${windows.length} windows`);
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 3;
    for (let i = 0; i < windows.length; i += batchSize) {
      const batch = windows.slice(i, i + batchSize);
      const promises = batch.map(({ windowId, url }) => 
        this.prefetchFavicon(windowId, url).catch(error => {
          logger.error(`[prefetchFaviconsForWindows] Error prefetching favicon for ${windowId}:`, error);
          return null;
        })
      );
      
      await Promise.all(promises);
      
      // Small delay between batches to be respectful
      if (i + batchSize < windows.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    logger.info(`[prefetchFaviconsForWindows] Completed favicon prefetching`);
  }

  /**
   * Clean up all resources when the service is destroyed
   */
  public destroy(): void {
    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Clean up all remaining prefetch views
    for (const [windowId, view] of this.prefetchViews.entries()) {
      this.cleanupPrefetchResources(windowId, null, view.webContents);
    }
    
    // Destroy all browser views
    this.destroyAllBrowserViews().catch(error => {
      logger.error('[ClassicBrowserService] Error destroying browser views during service cleanup:', error);
    });
    
    // Clear all tracking maps
    this.views.clear();
    this.prefetchViews.clear();
    this.navigationTracking.clear();
    
    logger.info('[ClassicBrowserService] Service destroyed and cleaned up');
  }
} 