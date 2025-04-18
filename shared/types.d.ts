// This declaration file defines global types, primarily the shape of the
// 'window.api' object exposed by the preload script (electron/preload.ts).
// It ensures type safety when using the API in the renderer process (src/).

// Make sure this interface stays in sync with the implementation in preload.ts
export interface IAppAPI {
  // Add signatures for all functions exposed on window.api
  getAppVersion: () => Promise<string>;
  getProfile: () => Promise<{ name?: string }>;
  // Example:
  // saveNotebook: (data: NotebookData) => Promise<{ success: boolean; data?: any }>;

  /**
   * Import a bookmark export file (HTML or JSON).
   * Returns the number of *new* bookmarks ingested.
   */
  importBookmarks: (filePath: string) => Promise<number>;

  /**
   * Write a Uint8Array to a temp file and return the absolute path.
   * @param fileName  original filename (for extension)
   * @param data      binary contents (as Uint8Array)
   */
  saveTempFile: (fileName: string, data: Uint8Array) => Promise<string>;
}

declare global {
  interface Window {
    // Expose the api object defined in preload.ts
    api: IAppAPI;
  }
} 