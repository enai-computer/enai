import { Electron } from 'electron';
import { BrowserContextMenuData } from '../../shared/types/contextMenu.types';

/**
 * Browser Event Types
 * 
 * Defines all events that can be emitted through the BrowserEventBus
 */
export interface BrowserEventMap {
  // View lifecycle events
  'view:did-start-loading': { windowId: string };
  'view:did-stop-loading': { windowId: string; url: string; title: string };
  'view:did-navigate': { windowId: string; url: string; isMainFrame: boolean };
  'view:did-navigate-in-page': { windowId: string; url: string; isMainFrame: boolean };
  'view:page-title-updated': { windowId: string; title: string };
  'view:page-favicon-updated': { windowId: string; faviconUrl: string[] };
  'view:did-fail-load': { 
    windowId: string; 
    errorCode: number; 
    errorDescription: string; 
    validatedURL: string; 
    isMainFrame: boolean; 
  };
  'view:render-process-gone': { windowId: string; details: Electron.RenderProcessGoneDetails };
  'view:window-open-request': { windowId: string; details: Electron.HandlerDetails };
  'view:will-navigate': { windowId: string; event: Electron.Event; url: string };
  'view:did-redirect-navigation': { windowId: string; url: string };
  'view:iframe-window-open-request': { windowId: string; details: Electron.HandlerDetails };

  // Context menu events
  'view:context-menu-requested': { 
    windowId: string; 
    params: Electron.ContextMenuParams; 
    viewBounds: { x: number; y: number; width: number; height: number };
  };
  'overlay:show-context-menu': { data: BrowserContextMenuData };
  'overlay:hide-context-menu': { windowId: string };

  // Prefetch events
  'prefetch:tab-favicon-found': { url: string; faviconUrl: string };
  'prefetch:favicon-found': { windowId: string; faviconUrl: string };

  // WOM (Working Memory) events
  'wom:refresh-needed': { objectId: string; url: string };
  'webpage:needs-refresh': { objectId: string; url: string; windowId: string; tabId: string };
  'webpage:needs-ingestion': { url: string; title: string; windowId: string; tabId: string };
}

/**
 * Type-safe event names
 */
export type BrowserEventName = keyof BrowserEventMap;

/**
 * Extract event data type for a given event name
 */
export type BrowserEventData<T extends BrowserEventName> = BrowserEventMap[T];