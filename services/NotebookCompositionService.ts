import { app } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { NotebookService } from './NotebookService';
import { ObjectModel } from '../models/ObjectModel';
import { ClassicBrowserService } from './ClassicBrowserService';
import { WindowMeta, ClassicBrowserPayload, TabState } from '../shared/types';
import { logger } from '../utils/logger';

export class NotebookCompositionService {
  private notebookService: NotebookService;
  private objectModel: ObjectModel;
  private classicBrowserService: ClassicBrowserService | null;

  constructor(notebookService: NotebookService, objectModel: ObjectModel, classicBrowserService?: ClassicBrowserService) {
    this.notebookService = notebookService;
    this.objectModel = objectModel;
    this.classicBrowserService = classicBrowserService || null;
    logger.info('[NotebookCompositionService] Initialized.');
  }

  async compose(params: { title: string; description?: string | null; sourceObjectIds?: string[] }): Promise<{ notebookId: string }> {
    const { title, description, sourceObjectIds = [] } = params;
    
    logger.debug('[NotebookCompositionService] compose called', { title, description, sourceObjectIds });
    
    try {
      // Step 1: Create the notebook
      const notebook = await this.notebookService.createNotebook(title, description);
      const notebookId = notebook.id;
      
      logger.debug('[NotebookCompositionService] Created notebook', { notebookId });
      
      // If no source objects provided, return early (empty notebook)
      if (!sourceObjectIds || sourceObjectIds.length === 0) {
        logger.info('[NotebookCompositionService] Created empty notebook (no sources)', { notebookId });
        return { notebookId };
      }
      
      // Step 2: Fetch full objects to get all metadata including internalFilePath
      const tabs: TabState[] = [];
      const urlsForFaviconPrefetch: { tabId: string; url: string }[] = [];
      
      for (let i = 0; i < sourceObjectIds.length; i++) {
        const objectId = sourceObjectIds[i];
        const object = await this.objectModel.getById(objectId);
        
        if (!object) {
          logger.warn(`[NotebookCompositionService] Object ${objectId} not found, skipping`);
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
        x: 100,
        y: 100,
        width: 1428,
        height: 867,
        zIndex: 10,
        isFocused: false,
        isMinimized: true,
        payload: {
          tabs: tabs,
          activeTabId: tabs.length > 0 ? tabs[0].id : ''
        } as ClassicBrowserPayload
      };
      
      const windows: WindowMeta[] = [window];
      
      logger.debug('[NotebookCompositionService] Constructed window state', { 
        windowCount: windows.length,
        tabCount: tabs.length 
      });
      
      // Step 3: Prefetch favicons for all tabs if ClassicBrowserService is available
      if (this.classicBrowserService && urlsForFaviconPrefetch.length > 0) {
        logger.info('[NotebookCompositionService] Starting favicon prefetch for composed tabs');
        
        // Convert to the format expected by prefetchFaviconsForWindows
        // We'll use the tab IDs as "window IDs" for the prefetch
        const windowsForPrefetch = urlsForFaviconPrefetch.map(({ tabId, url }) => ({
          windowId: tabId,
          url: url
        }));

        logger.info(`[NotebookCompositionService] Prefetching favicons for ${windowsForPrefetch.length} tabs`);
        windowsForPrefetch.forEach(w => {
          logger.debug(`[NotebookCompositionService] Will prefetch favicon for tab ${w.windowId}: ${w.url}`);
        });

        try {
          const faviconMap = await this.classicBrowserService.prefetchFaviconsForWindows(windowsForPrefetch);
          
          logger.info(`[NotebookCompositionService] Favicon prefetch completed. Got ${faviconMap.size} favicons`);
          faviconMap.forEach((faviconUrl, tabId) => {
            logger.debug(`[NotebookCompositionService] Tab ${tabId} favicon: ${faviconUrl}`);
          });
          
          if (faviconMap.size > 0) {
            logger.info(`[NotebookCompositionService] Merging ${faviconMap.size} prefetched favicons into tab state.`);
            tabs.forEach(tab => {
              if (faviconMap.has(tab.id)) {
                const faviconUrl = faviconMap.get(tab.id) || null;
                tab.faviconUrl = faviconUrl;
                logger.debug(`[NotebookCompositionService] Set favicon for tab ${tab.id}: ${faviconUrl}`);
              }
            });
          } else {
            logger.warn('[NotebookCompositionService] No favicons were successfully prefetched');
          }
        } catch (error) {
          logger.error('[NotebookCompositionService] Error during favicon prefetch, continuing without favicons:', error);
        }
      } else {
        logger.warn('[NotebookCompositionService] Skipping favicon prefetch:', {
          hasClassicBrowserService: !!this.classicBrowserService,
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
      
      logger.info('[NotebookCompositionService] Successfully composed notebook', { 
        notebookId,
        windowCount: windows.length,
        tabCount: tabs.length,
        layoutFilePath 
      });
      
      // Step 5: Return the notebook ID
      return { notebookId };
      
    } catch (error) {
      logger.error('[NotebookCompositionService] compose error:', error);
      throw error;
    }
  }
}