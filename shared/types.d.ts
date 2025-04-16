// This declaration file defines global types, primarily the shape of the
// 'window.api' object exposed by the preload script (electron/preload.ts).
// It ensures type safety when using the API in the renderer process (src/).

// Make sure this interface stays in sync with the implementation in preload.ts
export interface IAppAPI {
  // Add signatures for all functions exposed on window.api
  getAppVersion: () => Promise<string>;
  // Example:
  // saveNotebook: (data: NotebookData) => Promise<{ success: boolean; data?: any }>;
}

declare global {
  interface Window {
    // Expose the api object defined in preload.ts
    api: IAppAPI;
  }
} 