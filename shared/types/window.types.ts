/**
 * Defines the type of content a window can hold.
 * Starts with basic types; will be expanded as specific window contents are implemented.
 */
export type WindowContentType =
  | 'placeholder'
  | 'empty'
  | 'chat'
  | 'browser'
  | 'classic-browser'
  | 'notebook_raw_editor' // Example for a raw notebook data editor
  | 'note_editor'; // For editing individual notes

/**
 * Base payload structure. Specific window types will extend this or use a more concrete type.
 */
export interface BaseWindowPayload {
  // Common payload properties, if any, can go here in the future.
  [key: string]: any; // Allows for arbitrary properties for now
}

/** Placeholder payload for empty or placeholder windows. */
export interface PlaceholderPayload extends BaseWindowPayload {}

/** Payload for a chat window, identifying the chat session. */
export interface ChatWindowPayload extends BaseWindowPayload {
  sessionId: string;
}

/** Payload for a browser window. */
export interface BrowserWindowPayload extends BaseWindowPayload {
  // Browser windows are now handled by ClassicBrowserPayload with tabs
}

/** Payload for a raw notebook editor window, identifying the notebook. */
export interface NotebookRawEditorPayload extends BaseWindowPayload {
  notebookId: string;
}

/** Payload for a note editor window. */
export interface NoteEditorPayload extends BaseWindowPayload {
  noteId?: string; // Optional: ID of existing note to edit
  notebookId: string; // Required: ID of the notebook this note belongs to
}

/** Represents the state of a single browser tab. */
export interface TabState {
  /** Unique identifier for the tab. */
  id: string;
  /** The currently loaded URL in the tab. */
  url: string;
  /** Title of the currently loaded page. */
  title: string;
  /** URL of the favicon for the current page. */
  faviconUrl: string | null;
  /** Whether the tab is currently loading a page. */
  isLoading: boolean;
  /** Whether the tab can navigate backward. */
  canGoBack: boolean;
  /** Whether the tab can navigate forward. */
  canGoForward: boolean;
  /** Error message if a navigation failed. */
  error: string | null;
  /** Whether the current URL is bookmarked (exists in objects table). */
  isBookmarked?: boolean;
  /** When the current URL was bookmarked (ISO string). */
  bookmarkedAt?: string | null;
  // Future: history: string[];
}

/** Represents the freeze state of a browser window. */
export type BrowserFreezeState =
  | { type: 'ACTIVE' }
  | { type: 'CAPTURING' }
  | { type: 'AWAITING_RENDER'; snapshotUrl: string }
  | { type: 'FROZEN'; snapshotUrl: string };

/** Payload for the classic browser window. */
export interface ClassicBrowserPayload extends BaseWindowPayload {
  /** Array of tabs in this browser window. */
  tabs: TabState[];
  /** ID of the currently active tab. */
  activeTabId: string;
  /** The freeze state of the browser window. */
  freezeState: BrowserFreezeState;
  /** ID of the tab group object (for WOM composite objects). */
  tabGroupId?: string;
}

/** Granular state update for the classic browser. */
export interface ClassicBrowserStateUpdate {
  /** ID of the window being updated. */
  windowId: string;
  /** Targeted update to apply. */
  update: {
    /** Update the active tab ID. */
    activeTabId?: string;
    /** Partial update for a specific tab. */
    tab?: Partial<TabState> & { id: string };
    /** Full tabs array (for tab creation/deletion). */
    tabs?: TabState[];
  };
}

/**
 * A discriminated union for window payloads, allowing type-safe access based on WindowMeta.type.
 */
export type WindowPayload =
  | PlaceholderPayload
  | ChatWindowPayload
  | BrowserWindowPayload
  | ClassicBrowserPayload
  | NotebookRawEditorPayload
  | NoteEditorPayload;

/**
 * Represents the metadata and state of a single window within the desktop environment.
 */
export interface WindowMeta {
  id: string; // Unique identifier for the window (e.g., UUID)
  type: WindowContentType; // The type of content/app this window displays
  title: string; // The title displayed in the window's title bar
  x: number; // X-coordinate of the window's top-left corner
  y: number; // Y-coordinate of the window's top-left corner
  width: number; // Width of the window
  height: number; // Height of the window
  zIndex: number; // Stacking order of the window
  isFocused: boolean; // Whether the window currently has focus
  isMinimized?: boolean; // Optional: Whether the window is minimized
  isMaximized?: boolean; // Optional: Whether the window is maximized
  payload: WindowPayload; // Data specific to the window's content type
}