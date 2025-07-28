import type { RenderProcessGoneDetails, HandlerDetails, ContextMenuParams, Event } from 'electron';
import { BrowserContextMenuData } from '../../shared/types/contextMenu.types';

import { ClassicBrowserPayload } from '../../shared/types';

/**
 * Browser Event Types
 * 
 * Defines all events that can be emitted through the BrowserEventBus
 */
export interface BrowserEventMap {
  // State events
  'state-changed': { windowId: string; newState: ClassicBrowserPayload };

  // View lifecycle events
  'view:did-start-loading': { windowId: string };
  'view:did-stop-loading': { windowId: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean };
  'view:did-navigate': { windowId: string; url: string; isMainFrame: boolean; title: string; canGoBack: boolean; canGoForward: boolean };
  'view:did-navigate-in-page': { windowId: string; url: string; isMainFrame: boolean; title: string; canGoBack: boolean; canGoForward: boolean };
  'view:page-title-updated': { windowId: string; title: string };
  'view:page-favicon-updated': { windowId: string; faviconUrl: string[] };
  'view:did-fail-load': { 
    windowId: string; 
    errorCode: number; 
    errorDescription: string; 
    validatedURL: string; 
    isMainFrame: boolean;
    currentUrl: string;
    canGoBack: boolean;
    canGoForward: boolean;
  };
  'view:render-process-gone': { windowId: string; details: RenderProcessGoneDetails };
  'view:window-open-request': { windowId: string; details: HandlerDetails };
  'view:will-navigate': { windowId: string; event: Event; url: string };
  'view:did-redirect-navigation': { windowId: string; url: string };
  'view:iframe-window-open-request': { windowId: string; details: HandlerDetails };

  // Context menu events
  'view:context-menu-requested': { 
    windowId: string; 
    params: ContextMenuParams; 
    viewBounds: { x: number; y: number; width: number; height: number };
  };
  
  // Keyboard shortcut events
  'view:keyboard-shortcut': {
    windowId: string;
    action: 'copy' | 'paste' | 'cut' | 'select-all' | 'undo' | 'redo';
    originalEvent: Electron.Input;
  };
  'overlay:show-context-menu': { data: BrowserContextMenuData };
  'overlay:hide-context-menu': { windowId: string };

  // Prefetch events
  'prefetch:tab-favicon-found': { windowId: string; tabId: string; faviconUrl: string };
  'prefetch:favicon-found': { windowId: string; faviconUrl: string };

  // WOM (Working Memory) events
  'wom:refresh-needed': { objectId: string; url: string };
  'webpage:needs-refresh': { objectId: string; url: string; windowId: string; tabId: string };
  'webpage:needs-ingestion': { url: string; title: string; windowId: string; tabId: string };
  'webpage:ingestion-complete': { tabId: string; objectId: string };

  // Navigation events
  'tab:new': { url: string; windowId?: string };
  'search:jeffers': { query: string };

  // Tab group events
  'tabgroup:title-updated': { windowId: string; title: string };

  // Window lifecycle events for WebContentsView management
  'window:focus-changed': { windowId: string; isFocused: boolean; zIndex: number };
  'window:minimized': { windowId: string };
  'window:restored': { windowId: string; zIndex: number };
  'window:z-order-update': { orderedWindows: Array<{ windowId: string; zIndex: number; isFocused: boolean; isMinimized: boolean }> };
}

/**
 * Type-safe event names
 */
export type BrowserEventName = keyof BrowserEventMap;

/**
 * Extract event data type for a given event name
 */
export type BrowserEventData<T extends BrowserEventName> = BrowserEventMap[T];