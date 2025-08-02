
import { BrowserWindow } from 'electron';
import { ON_CLASSIC_BROWSER_STATE } from '../../shared/ipcChannels';
import { ClassicBrowserPayload, TabState } from '../../shared/types';
import { BaseService } from '../base/BaseService';
import { BrowserEventBus } from './BrowserEventBus';

export interface ClassicBrowserStateServiceDeps {
  mainWindow: BrowserWindow;
  eventBus: BrowserEventBus;
}

/**
 * Service responsible for managing browser window states.
 * This service is the single source of truth for all browser state.
 */
export class ClassicBrowserStateService extends BaseService<ClassicBrowserStateServiceDeps> {
  public states = new Map<string, ClassicBrowserPayload>();

  constructor(deps: ClassicBrowserStateServiceDeps) {
    super('ClassicBrowserStateService', deps);
  }

  public getState(windowId: string): ClassicBrowserPayload | undefined {
    return this.states.get(windowId);
  }

  public setState(windowId: string, state: ClassicBrowserPayload, forceNavigationCheck = false): void {
    const previousState = this.states.get(windowId);
    this.states.set(windowId, state);
    this._emitStateChange(windowId, previousState, forceNavigationCheck);
  }

  public addTab(windowId: string, tab: TabState): void {
    const state = this.getState(windowId);
    if (state) {
      const newTabs = [...state.tabs, tab];
      this.setState(windowId, { ...state, tabs: newTabs }, true); // Force navigation check for new tabs
    }
  }

  public removeTab(windowId: string, tabId: string): void {
    const state = this.getState(windowId);
    if (state) {
      const newTabs = state.tabs.filter(t => t.id !== tabId);
      this.setState(windowId, { ...state, tabs: newTabs }, true); // Force navigation check when tabs removed
    }
  }

  public updateTab(windowId: string, tabId: string, updates: Partial<TabState>): void {
    const state = this.getState(windowId);
    if (state) {
      const newTabs = state.tabs.map(t => t.id === tabId ? { ...t, ...updates } : t);
      // Check if URL or loading state changed (navigation-relevant)
      const tabChanged = state.tabs.find(t => t.id === tabId);
      const hasNavigationChange = tabChanged && (
        (updates.url && updates.url !== tabChanged.url) ||
        (updates.isLoading !== undefined && updates.isLoading !== tabChanged.isLoading)
      );
      this.setState(windowId, { ...state, tabs: newTabs }, hasNavigationChange);
    }
  }

  public setActiveTab(windowId: string, tabId: string): void {
    const state = this.getState(windowId);
    if (state && state.activeTabId !== tabId) {
      this.setState(windowId, { ...state, activeTabId: tabId }, true); // Force navigation check for tab switches
    }
  }

  public setBounds(windowId: string, bounds: Electron.Rectangle): void {
    const state = this.getState(windowId);
    if (state) {
      // Bounds changes are not navigation-relevant
      this.setState(windowId, { ...state, bounds }, false);
    }
  }

  private _emitStateChange(windowId: string, previousState?: ClassicBrowserPayload, forceNavigationCheck = false): void {
    const newState = this.getState(windowId);
    if (!newState) return;

    // Determine if this is a navigation-relevant change
    const isNavigationRelevant = forceNavigationCheck || this.isNavigationRelevantChange(previousState, newState);

    // Emit to other backend services (with navigation context)
    this.deps.eventBus.emit('state-changed', { 
      windowId, 
      newState, 
      previousState,
      isNavigationRelevant 
    });

    // Send to renderer process
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send(ON_CLASSIC_BROWSER_STATE, { windowId, update: newState });
    }
  }

  /**
   * Determines if a state change requires navigation handling
   */
  private isNavigationRelevantChange(previousState?: ClassicBrowserPayload, newState?: ClassicBrowserPayload): boolean {
    if (!previousState || !newState) return true; // First state is always relevant

    // Active tab changed
    if (previousState.activeTabId !== newState.activeTabId) return true;

    // Number of tabs changed
    if (previousState.tabs.length !== newState.tabs.length) return true;

    // Check if any tab's URL or loading state changed
    for (const newTab of newState.tabs) {
      const prevTab = previousState.tabs.find(t => t.id === newTab.id);
      if (!prevTab) return true; // New tab
      
      if (prevTab.url !== newTab.url || prevTab.isLoading !== newTab.isLoading) {
        return true; // URL or loading state changed
      }
    }

    // Only bounds/visual changes - not navigation relevant
    return false;
  }

  async cleanup(): Promise<void> {
    this.states.clear();
  }

  public removeState(windowId: string): void {
    this.states.delete(windowId);
  }

  public getAllStates(): Map<string, ClassicBrowserPayload> {
    return new Map(this.states);
  }

  /**
   * Get the event bus instance for other services to use
   */
  public getEventBus(): BrowserEventBus {
    return this.deps.eventBus;
  }
}
