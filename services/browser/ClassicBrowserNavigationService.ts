
import { WebContentsView, clipboard } from 'electron';
import { BaseService } from '../base/BaseService';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { GlobalTabPool } from './GlobalTabPool';
import { BrowserEventBus } from './BrowserEventBus';
import { isSecureUrl, isSecureUrlForClipboard, isSecureUrlForDownload } from '../../utils/urlSecurity';
import { BrowserActionData } from '../../shared/types/window.types';

export interface ClassicBrowserNavigationServiceDeps {
  stateService: ClassicBrowserStateService;
  globalTabPool: GlobalTabPool;
  eventBus: BrowserEventBus;
}

/**
 * Service responsible for browser navigation mechanics.
 */
export class ClassicBrowserNavigationService extends BaseService<ClassicBrowserNavigationServiceDeps> {
  private navigationTracking: Map<string, { lastBaseUrl: string; lastNavigationTime: number }> = new Map();

  constructor(deps: ClassicBrowserNavigationServiceDeps) {
    super('ClassicBrowserNavigationService', deps);
  }

  async loadUrl(windowId: string, url: string): Promise<void> {
    const browserState = this.deps.stateService.getState(windowId);
    const activeTabId = browserState?.activeTabId;
    if (!activeTabId) {
      throw new Error(`No active tab found for windowId ${windowId}`);
    }

    const view = this.deps.globalTabPool.getView(activeTabId);
    if (!view) {
      throw new Error(`WebContentsView for active tab ${activeTabId} not found.`);
    }

    let validUrl = url;
    if (!url.startsWith('http') && !url.startsWith('file')) {
      validUrl = `https://${url}`;
    }

    if (!isSecureUrl(validUrl, { context: 'navigation' })) {
      throw new Error(`URL failed security validation: ${validUrl}`);
    }

    this.deps.stateService.updateTab(windowId, activeTabId, { url: validUrl, isLoading: true, error: null });
    await view.webContents.loadURL(validUrl);
  }

  navigate(windowId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const browserState = this.deps.stateService.getState(windowId);
    const activeTabId = browserState?.activeTabId;
    if (!activeTabId) return;

    const view = this.deps.globalTabPool.getView(activeTabId);
    if (!view) return;

    const wc = view.webContents;
    switch (action) {
      case 'back': wc.goBack(); break;
      case 'forward': wc.goForward(); break;
      case 'reload': wc.reload(); break;
      case 'stop': wc.stop(); break;
    }
  }

  async executeContextMenuAction(windowId: string, action: string, data?: BrowserActionData): Promise<void> {
    const browserState = this.deps.stateService.getState(windowId);
    const activeTabId = browserState?.activeTabId;
    if (!activeTabId) return;

    const view = this.deps.globalTabPool.getView(activeTabId);
    if (!view) return;

    const webContents = view.webContents;

    switch (action) {
      case 'navigate:back': this.navigate(windowId, 'back'); break;
      case 'navigate:forward': this.navigate(windowId, 'forward'); break;
      case 'navigate:reload': this.navigate(windowId, 'reload'); break;
      case 'navigate:stop': this.navigate(windowId, 'stop'); break;
      case 'link:open-new-tab':
        if (data?.url && isSecureUrl(data.url, { context: 'link:open-new-tab' })) {
          this.deps.eventBus.emit('tab:new', { url: data.url, windowId });
        }
        break;
      case 'link:copy':
        if (data?.url && isSecureUrlForClipboard(data.url)) {
          clipboard.writeText(data.url);
        }
        break;
      case 'image:save':
        if (data?.url && isSecureUrlForDownload(data.url)) {
          webContents.downloadURL(data.url);
        }
        break;
      case 'edit:copy': webContents.copy(); break;
      case 'edit:paste': webContents.paste(); break;
      // ... other actions
    }
  }

  async cleanup(): Promise<void> {
    this.navigationTracking.clear();
  }
}
