import { BrowserWindow, WebContentsView, ipcMain, WebContents } from 'electron';
import { ON_CLASSIC_BROWSER_STATE, CLASSIC_BROWSER_VIEW_FOCUSED } from '../shared/ipcChannels';
import { ClassicBrowserPayload } from '../shared/types';
import { getActivityLogService } from './ActivityLogService';
import { logger } from '../utils/logger';

export class ClassicBrowserService {
  private views: Map<string, WebContentsView> = new Map();
  private mainWindow: BrowserWindow;
  private navigationTracking: Map<string, { lastBaseUrl: string; lastNavigationTime: number }> = new Map();
  private prefetchViews: Map<string, WebContentsView> = new Map();

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
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
      logger.debug(`windowId ${windowId}: Intercepted new window request to ${details.url}`);
      // Navigate in the same WebLayer instead of opening a new window
      this.loadUrl(windowId, details.url);
      // Deny the new window creation
      return { action: 'deny' };
    });

    // Handle navigation attempts (including link clicks)
    wc.on('will-navigate', (event, url) => {
      logger.debug(`windowId ${windowId}: will-navigate to ${url}`);
      // Allow navigation to proceed normally within the same WebLayer
      // The default behavior is to navigate in the same webContents
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
    
    const view = this.views.get(windowId);
    if (!view) {
      logger.warn(`[DESTROY] No WebContentsView found for windowId ${windowId}. Nothing to destroy.`);
      return;
    }

    logger.debug(`[DESTROY] Found view for ${windowId}, proceeding with destruction.`);
    
    // Detach from window if attached
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
            // Check if the view is a child of the mainWindow's contentView
            if (this.mainWindow.contentView && this.mainWindow.contentView.children.includes(view)) {
                this.mainWindow.contentView.removeChildView(view); // Use contentView.removeChildView
            }
        } catch (error) {
            logger.debug(`[DESTROY] Error detaching view from window:`, error);
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
            
            // Only try to execute JavaScript if the page has loaded
            if (!wc.isLoading()) {
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
                    `);
                } catch (scriptError) {
                    // Ignore script errors, continue with destruction
                    logger.debug(`windowId ${windowId}: Script execution error (ignored):`, scriptError);
                }
            }
            
            // Small delay to ensure media cleanup takes effect
            await new Promise(resolve => setTimeout(resolve, 100));
            
            logger.debug(`windowId ${windowId}: Stopped media playback and cleared page.`);
        } catch (error) {
            logger.debug(`windowId ${windowId}: Error during media cleanup:`, error);
            // Continue with destruction even if script execution fails
        }
    }

    // Clean up the view from our tracking
    this.views.delete(windowId);
    this.navigationTracking.delete(windowId);
    
    // Destroy the webContents to ensure complete cleanup
    if (!view.webContents.isDestroyed()) {
      (view.webContents as any).destroy();
    }
    
    logger.debug(`windowId ${windowId}: WebContentsView destroyed and removed from map.`);
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
            // Enable JavaScript and images so sites that set favicons dynamically
            // (e.g. via <script>) are properly detected.
            javascript: true,
            images: true,
            webgl: false,
            plugins: false,
          }
        });

        this.prefetchViews.set(windowId, prefetchView);
        const wc = prefetchView.webContents;

        // Set a timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          logger.debug(`[prefetchFavicon] Timeout reached for ${windowId}`);
          if (!wc.isDestroyed()) {
            wc.stop();
            (wc as any).destroy();
          }
          this.prefetchViews.delete(windowId);
          resolve(null);
        }, 10000); // 10 second timeout

        // Listen for favicon
        let faviconFound = false;
        wc.on('page-favicon-updated', (_event, favicons) => {
          if (!faviconFound && favicons.length > 0) {
            faviconFound = true;
            const faviconUrl = favicons[0];
            logger.debug(`[prefetchFavicon] Found favicon for ${windowId}: ${faviconUrl}`);
            
            // Send state update with the favicon
            this.sendStateUpdate(windowId, { faviconUrl });
            
            // Clean up
            clearTimeout(timeoutId);
            if (!wc.isDestroyed()) {
              wc.stop();
              (wc as any).destroy();
            }
            this.prefetchViews.delete(windowId);
            resolve(faviconUrl);
          }
        });

        // Also listen for did-stop-loading in case there's no favicon
        wc.once('did-stop-loading', () => {
          if (!faviconFound) {
            logger.debug(`[prefetchFavicon] Page loaded but no favicon found for ${windowId}`);
            clearTimeout(timeoutId);
            if (!wc.isDestroyed()) {
              (wc as any).destroy();
            }
            this.prefetchViews.delete(windowId);
            resolve(null);
          }
        });

        // Handle errors
        wc.on('did-fail-load', (_event, errorCode, errorDescription) => {
          logger.debug(`[prefetchFavicon] Failed to load page for ${windowId}: ${errorDescription}`);
          clearTimeout(timeoutId);
          if (!wc.isDestroyed()) {
            (wc as any).destroy();
          }
          this.prefetchViews.delete(windowId);
          resolve(null);
        });

        // Start loading the page
        logger.debug(`[prefetchFavicon] Loading URL for ${windowId}: ${url}`);
        wc.loadURL(url);

      } catch (error) {
        logger.error(`[prefetchFavicon] Error during prefetch for ${windowId}:`, error);
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
} 