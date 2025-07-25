import { ComponentType } from 'react';

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
  icon?: ComponentType<{ className?: string }>;
  action: () => void | Promise<void>;
  submenu?: MenuAction[];
  separator?: boolean;
  disabled?: boolean;
  shortcut?: string; // e.g., "⌘C", "Ctrl+C"
  variant?: 'default' | 'danger';
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
 * Information about available notebooks and their tab groups for transfer operations
 */
export interface NotebookTabGroupInfo {
  notebookId: string;
  notebookTitle: string;
  tabGroups: Array<{
    tabGroupId: string;
    title: string;
    tabCount: number;
  }>;
}

/**
 * Browser-specific context menu data for WebContentsView contexts
 */
export interface BrowserContextMenuData {
  x: number;
  y: number;
  windowId: string;
  contextType?: 'browser' | 'tab';
  viewBounds?: { x: number; y: number; width: number; height: number };
  browserContext?: {
    linkURL?: string;
    srcURL?: string;
    pageURL: string;
    frameURL?: string;
    selectionText?: string;
    isEditable: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    canReload: boolean;
    canViewSource: boolean;
    mediaType?: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin';
    hasImageContents: boolean;
    editFlags: {
      canUndo: boolean;
      canRedo: boolean;
      canCut: boolean;
      canCopy: boolean;
      canPaste: boolean;
      canSelectAll: boolean;
    };
  };
  tabContext?: {
    tabId: string;
    title: string;
    url: string;
    isActive: boolean;
    canClose: boolean;
  };
  // Available notebooks for tab transfer operations
  availableNotebooks?: NotebookTabGroupInfo[];
}