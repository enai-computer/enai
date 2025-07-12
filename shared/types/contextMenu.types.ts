import { ReactComponentElement } from 'react';

/**
 * Represents different types of content that can be right-clicked
 */
export type ContextMenuTarget =
  | { type: 'link'; url: string; text?: string; element: HTMLElement }
  | { type: 'text-selection'; text: string; container?: HTMLElement; element: HTMLElement }
  | { type: 'browser-tab'; tabId: string; title: string; url: string; inMemory: boolean; element: HTMLElement }
  | { type: 'image'; src: string; alt?: string; element: HTMLElement }
  | { type: 'mixed'; primary: ContextMenuTarget; secondary: ContextMenuTarget[]; element: HTMLElement }
  | { type: 'default'; element: HTMLElement };

/**
 * Defines a context menu action item
 */
export interface MenuAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  action: () => void | Promise<void>;
  submenu?: MenuAction[];
  separator?: boolean;
  disabled?: boolean;
  shortcut?: string; // e.g., "⌘C", "Ctrl+C"
  variant?: 'default' | 'danger';
}

/**
 * Context menu detection event data
 */
export interface ContextMenuEvent {
  target: ContextMenuTarget;
  position: {
    x: number;
    y: number;
  };
  preventDefault: () => void;
}

/**
 * Hook return type for context menu detection
 */
export interface UseContextMenuDetection {
  contextMenuEvent: ContextMenuEvent | null;
  clearContextMenu: () => void;
}

/**
 * Props for context menu components
 */
export interface ContextMenuProps {
  target: ContextMenuTarget;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Configuration for context menu behavior
 */
export interface ContextMenuConfig {
  enableTextSelection: boolean;
  enableLinkActions: boolean;
  enableImageActions: boolean;
  enableBrowserTabActions: boolean;
  debounceMs: number;
  maxSubmenuDepth: number;
}