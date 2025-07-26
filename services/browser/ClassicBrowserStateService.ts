
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

  public setState(windowId: string, state: ClassicBrowserPayload): void {
    this.states.set(windowId, state);
    this._emitStateChange(windowId);
  }

  public addTab(windowId: string, tab: TabState): void {
    const state = this.getState(windowId);
    if (state) {
      const newTabs = [...state.tabs, tab];
      this.setState(windowId, { ...state, tabs: newTabs });
    }
  }

  public removeTab(windowId: string, tabId: string): void {
    const state = this.getState(windowId);
    if (state) {
      const newTabs = state.tabs.filter(t => t.id !== tabId);
      this.setState(windowId, { ...state, tabs: newTabs });
    }
  }

  public updateTab(windowId: string, tabId: string, updates: Partial<TabState>): void {
    const state = this.getState(windowId);
    if (state) {
      const newTabs = state.tabs.map(t => t.id === tabId ? { ...t, ...updates } : t);
      this.setState(windowId, { ...state, tabs: newTabs });
    }
  }

  public setActiveTab(windowId: string, tabId: string): void {
    const state = this.getState(windowId);
    if (state) {
      this.setState(windowId, { ...state, activeTabId: tabId });
    }
  }

  private _emitStateChange(windowId: string): void {
    const newState = this.getState(windowId);
    if (!newState) return;

    // Emit to other backend services
    this.deps.eventBus.emit('state-changed', { windowId, newState });

    // Send to renderer process
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send(ON_CLASSIC_BROWSER_STATE, { windowId, update: newState });
    }
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
}
