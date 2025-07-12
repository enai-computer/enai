import { app } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { NotebookService } from './NotebookService';
import { ObjectModelCore } from '../models/ObjectModelCore';
import { ClassicBrowserService } from './browser/ClassicBrowserService';
import { WindowMeta, ClassicBrowserPayload, TabState } from '../shared/types';
import { logger } from '../utils/logger';
import { BaseService } from './base/BaseService';

interface NotebookCompositionServiceDeps {
  notebookService: NotebookService;
  objectModelCore: ObjectModelCore;
  classicBrowserService?: ClassicBrowserService;
}

export class NotebookCompositionService extends BaseService<NotebookCompositionServiceDeps> {
  constructor(deps: NotebookCompositionServiceDeps) {
    super('NotebookCompositionService', deps);
  }

  async compose(params: { title: string; description?: string | null; sourceObjectIds?: string[] }): Promise<{ notebookId: string }> {
    return this.execute('compose', async () => {
      const { title, description, sourceObjectIds = [] } = params;
      
      this.logDebug('compose called', { title, description, sourceObjectIds });
      
      try {
        // Step 1: Create the notebook
        const notebook = await this.deps.notebookService.createNotebook(title, description);
        const notebookId = notebook.id;
        
        this.logDebug('Created notebook', { notebookId });
      
        // If no source objects provided, return early (empty notebook)
        if (!sourceObjectIds || sourceObjectIds.length === 0) {
          this.logInfo('Created empty notebook (no sources)', { notebookId });
          return { notebookId };
        }
      
      // Step 2: Fetch full objects to get all metadata including internalFilePath
      const tabs: TabState[] = [];
      const urlsForFaviconPrefetch: { tabId: string; url: string }[] = [];
      
      for (let i = 0; i < sourceObjectIds.length; i++) {
        const objectId = sourceObjectIds[i];
          const object = await this.deps.objectModelCore.getById(objectId);
          
          if (!object) {
            this.logWarn(`Object ${objectId} not found, skipping`);
            continue;
          }
        
        // Determine the URL to use
        let url = object.sourceUri || '';
        
        // For PDFs, construct file:// URL from internalFilePath
        if (object.internalFilePath && object.sourceUri?.toLowerCase().endsWith('.pdf')) {
          url = `file://${object.internalFilePath}`;
        }
        
        const tabId = uuidv4();
        const tab: TabState = {
          id: tabId,
          url: url,
          title: object.title || 'Untitled',
          faviconUrl: null,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          error: null
        };
        
        tabs.push(tab);
        
        // Track non-file URLs for favicon prefetch
        if (url && !url.startsWith('file://')) {
          urlsForFaviconPrefetch.push({ tabId, url });
        }
      }
      
      // Create a single window with all tabs
      const windowId = uuidv4();
      const window: WindowMeta = {
        id: windowId,
        type: 'classic-browser',
        title: 'Composed Space',
        x: 380,
        y: 10,
        width: 1075,
        height: 915,
        zIndex: 10,
        isFocused: true,
        isMinimized: false,
        payload: {
          tabs: tabs,
          activeTabId: tabs.length > 0 ? tabs[0].id : ''
        } as ClassicBrowserPayload
      };
      
      const windows: WindowMeta[] = [window];
      
        this.logDebug('Constructed window state', { 
          windowCount: windows.length,
          tabCount: tabs.length 
        });
      
        // Step 3: Prefetch favicons for all tabs if ClassicBrowserService is available
        if (this.deps.classicBrowserService && urlsForFaviconPrefetch.length > 0) {
          this.logInfo('Starting favicon prefetch for composed tabs');
        
        // Convert to the format expected by prefetchFaviconsForWindows
        // We'll use the tab IDs as "window IDs" for the prefetch
        const windowsForPrefetch = urlsForFaviconPrefetch.map(({ tabId, url }) => ({
          windowId: tabId,
          url: url
        }));

          this.logInfo(`Prefetching favicons for ${windowsForPrefetch.length} tabs`);
          windowsForPrefetch.forEach(w => {
            this.logDebug(`Will prefetch favicon for tab ${w.windowId}: ${w.url}`);
          });

        try {
            const faviconMap = await this.deps.classicBrowserService!.prefetchFaviconsForWindows(windowsForPrefetch);
            
            this.logInfo(`Favicon prefetch completed. Got ${faviconMap.size} favicons`);
            faviconMap.forEach((faviconUrl, tabId) => {
              this.logDebug(`Tab ${tabId} favicon: ${faviconUrl}`);
            });
          
          if (faviconMap.size > 0) {
              this.logInfo(`Merging ${faviconMap.size} prefetched favicons into tab state.`);
              tabs.forEach(tab => {
                if (faviconMap.has(tab.id)) {
                  const faviconUrl = faviconMap.get(tab.id) || null;
                  tab.faviconUrl = faviconUrl;
                  this.logDebug(`Set favicon for tab ${tab.id}: ${faviconUrl}`);
                }
              });
            } else {
              this.logWarn('No favicons were successfully prefetched');
            }
          } catch (error) {
            this.logError('Error during favicon prefetch, continuing without favicons:', error);
          }
        } else {
          this.logWarn('Skipping favicon prefetch:', {
            hasClassicBrowserService: !!this.deps.classicBrowserService,
            tabCount: tabs.length,
            urlsForPrefetch: urlsForFaviconPrefetch.length
          });
        }
      
      // Step 4: Persist state file
      const userDataPath = app.getPath('userData');
      const layoutsDir = path.join(userDataPath, 'notebook_layouts');
      
      // Ensure the directory exists
      await fs.ensureDir(layoutsDir);
      
      // Construct the file path
      const layoutFilePath = path.join(layoutsDir, `notebook-layout-${notebookId}.json`);
      
      // Create the state object that Zustand expects
      const stateObject = {
        state: {
          windows
        },
        version: 2
      };
      
      // Write the file
      await fs.writeJson(layoutFilePath, stateObject);
      
        this.logInfo('Successfully composed notebook', { 
          notebookId,
          windowCount: windows.length,
          tabCount: tabs.length,
          layoutFilePath 
        });
        
        // Step 5: Return the notebook ID
        return { notebookId };
        
      } catch (error) {
        throw error;
      }
    });
  }
}