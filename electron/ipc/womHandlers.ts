import { IpcMain } from 'electron';
import { logger } from '../../utils/logger';
import {
  WOM_INGEST_WEBPAGE,
  WOM_UPDATE_ACCESS,
  WOM_CREATE_TAB_GROUP,
  WOM_UPDATE_TAB_GROUP,
  WOM_ENRICH_COMPOSITE,
  WOM_INGESTION_STARTED,
  WOM_INGESTION_COMPLETE
} from '../../shared/ipcChannels';
import { MediaType } from '../../shared/types/vector.types';
import { WOMIngestionService } from '../../services/WOMIngestionService';
import { CompositeObjectEnrichmentService } from '../../services/CompositeObjectEnrichmentService';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';
import { ObjectModel } from '../../models/ObjectModel';

interface WOMHandlerDeps {
  womIngestionService: WOMIngestionService;
  compositeEnrichmentService: CompositeObjectEnrichmentService;
  classicBrowserService: ClassicBrowserService;
  objectModel: ObjectModel;
}

export function registerWOMHandlers(
  ipcMain: IpcMain,
  deps: WOMHandlerDeps
) {
  // Handle async webpage ingestion
  ipcMain.handle(WOM_INGEST_WEBPAGE, async (event, { url, title }) => {
    try {
      logger.debug('[WOM] Ingesting webpage:', { url, title });
      
      const webpage = await deps.womIngestionService.ingestWebpage(url, title);
      
      // Notify browser service
      deps.classicBrowserService.emit('webpage:ingestion-complete', {
        url,
        objectId: webpage.id
      });
      
      return { success: true, objectId: webpage.id };
    } catch (error) {
      logger.error('[WOM] Ingestion failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
  
  // Handle access time updates
  ipcMain.handle(WOM_UPDATE_ACCESS, async (event, { objectId }) => {
    try {
      logger.debug('[WOM] Updating access time for object:', objectId);
      
      deps.objectModel.updateLastAccessed(objectId);
      
      return { success: true };
    } catch (error) {
      logger.error('[WOM] Failed to update access time:', error);
      return { success: false, error: (error as Error).message };
    }
  });
  
  // Handle tab group creation
  ipcMain.handle(WOM_CREATE_TAB_GROUP, async (event, { title, childObjectIds }) => {
    try {
      logger.debug('[WOM] Creating tab group:', { title, childCount: childObjectIds?.length });
      
      const tabGroup = await deps.objectModel.createOrUpdate({
        objectType: 'tab_group' as MediaType,
        sourceUri: `tab-group://${Date.now()}`,
        title: title || 'Tab Group',
        status: 'new',
        rawContentRef: null,
        childObjectIds
      });
      
      // Schedule enrichment if we have enough children
      if (childObjectIds && childObjectIds.length >= 3) {
        await deps.compositeEnrichmentService.scheduleEnrichment(tabGroup.id);
      }
      
      return { success: true, objectId: tabGroup.id };
    } catch (error) {
      logger.error('[WOM] Failed to create tab group:', error);
      return { success: false, error: (error as Error).message };
    }
  });
  
  // Handle tab group updates
  ipcMain.handle(WOM_UPDATE_TAB_GROUP, async (event, { objectId, childObjectIds }) => {
    try {
      logger.debug('[WOM] Updating tab group:', { objectId, childCount: childObjectIds?.length });
      
      deps.objectModel.updateChildIds(objectId, childObjectIds);
      
      // Schedule enrichment if we have enough children
      if (childObjectIds && childObjectIds.length >= 3) {
        await deps.compositeEnrichmentService.scheduleEnrichment(objectId);
      }
      
      return { success: true };
    } catch (error) {
      logger.error('[WOM] Failed to update tab group:', error);
      return { success: false, error: (error as Error).message };
    }
  });
  
  // Handle composite enrichment
  ipcMain.handle(WOM_ENRICH_COMPOSITE, async (event, { objectId }) => {
    try {
      logger.debug('[WOM] Scheduling enrichment for composite object:', objectId);
      
      await deps.compositeEnrichmentService.scheduleEnrichment(objectId);
      
      return { scheduled: true };
    } catch (error) {
      logger.error('[WOM] Failed to schedule enrichment:', error);
      return { scheduled: false, error: (error as Error).message };
    }
  });
  
  // Note: Browser service event listeners are now set up in serviceBootstrap.ts
  // to have access to the main window for sending events to renderer
  
  logger.info('[WOM] IPC handlers registered');
}