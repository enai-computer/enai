import { DisplaySlice } from './search.types';

/** Represents a suggested action that the user might want to take next. */
export type SuggestedAction = 
  | { type: 'open_notebook'; displayText: string; payload: { notebookId: string; notebookTitle: string } }
  | { type: 'compose_notebook'; displayText: string; payload: { proposedTitle: string; sourceObjectIds?: string[] } }
  | { type: 'search_web'; displayText: string; payload: { searchQuery: string; searchEngine?: 'perplexity' | 'google' } };

/** Intent handling types */
export interface SetIntentPayload {
  intentText: string;
  context: 'welcome' | 'notebook'; // Add context
  notebookId?: string;             // Add optional notebookId
}

export interface OpenInClassicBrowserPayload {
  type: 'open_in_classic_browser';
  url: string;
  notebookId: string; // To confirm it's for the right notebook
  message?: string;    // Optional message for UI
  // Potentially add preferred window title or other metadata later
}

export type IntentResultPayload =
  | { type: 'open_notebook'; notebookId: string; title?: string; message?: string } // Added message for UI acknowledgment
  | { type: 'open_url'; url: string; message?: string } // Added message for UI acknowledgment
  | { type: 'chat_reply'; message: string; slices?: DisplaySlice[] } // DisplaySlice for primary context
  | { type: 'plan_generated'; planData: any } // 'any' for now, can be refined
  | { type: 'error'; message: string }
  | OpenInClassicBrowserPayload;