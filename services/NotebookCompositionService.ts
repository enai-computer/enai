import { app } from 'electron';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { NotebookService } from './NotebookService';
import { ObjectModel } from '../models/ObjectModel';
import { ClassicBrowserService } from './ClassicBrowserService';
import { WindowMeta, ClassicBrowserPayload } from '../shared/types';
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

  async compose(params: { title: string; sourceObjectIds: string[] }): Promise<{ notebookId: string }> {
    const { title, sourceObjectIds } = params;
    
    logger.debug('[NotebookCompositionService] compose called', { title, sourceObjectIds });
    
    try {
      // Step 1: Create the notebook
      const notebook = await this.notebookService.createNotebook(title);
      const notebookId = notebook.id;
      
      logger.debug('[NotebookCompositionService] Created notebook', { notebookId });
      
      // Step 2: Fetch full objects to get all metadata including internalFilePath
      const windows: WindowMeta[] = [];
      
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
        
        const window: WindowMeta = {
          id: uuidv4(),
          type: 'classic-browser',
          title: object.title || 'Untitled',
          // Position windows in a cascade pattern
          x: 18 + (windows.length * 20),
          y: 18 + (windows.length * 20),
          width: 1428,
          height: 867,
          zIndex: 10 + windows.length,
          isFocused: false,
          isMinimized: true,
          payload: {
            initialUrl: url,
            currentUrl: url,
            requestedUrl: url,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            error: null,
            title: object.title || 'Untitled',
            faviconUrl: null
          } as ClassicBrowserPayload
        };
        
        windows.push(window);
      }
      
      logger.debug('[NotebookCompositionService] Constructed window state', { 
        windowCount: windows.length 
      });
      
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
        layoutFilePath 
      });
      
      // Step 5: Prefetch favicons for all windows if ClassicBrowserService is available
      if (this.classicBrowserService && windows.length > 0) {
        logger.info('[NotebookCompositionService] Starting favicon prefetch for composed windows');
        
        // Extract window data for prefetching
        const windowsForPrefetch = windows
          .filter(w => {
            const payload = w.payload as ClassicBrowserPayload;
            // Only prefetch for non-file URLs
            return payload.initialUrl && !payload.initialUrl.startsWith('file://');
          })
          .map(w => ({
            windowId: w.id,
            url: (w.payload as ClassicBrowserPayload).initialUrl
          }));
        
        // Prefetch favicons in the background (don't await)
        this.classicBrowserService.prefetchFaviconsForWindows(windowsForPrefetch)
          .then(() => {
            logger.info('[NotebookCompositionService] Favicon prefetch completed');
          })
          .catch(error => {
            logger.error('[NotebookCompositionService] Error during favicon prefetch:', error);
          });
      }
      
      // Step 6: Return the notebook ID
      return { notebookId };
      
    } catch (error) {
      logger.error('[NotebookCompositionService] compose error:', error);
      throw error;
    }
  }
}