import { BaseService } from '../base/BaseService';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { ObjectAssociationModel } from '../../models/ObjectAssociationModel';
import { NotebookService } from '../NotebookService';
import { ClassicBrowserService } from './ClassicBrowserService';
import { ClassicBrowserWOMService } from './ClassicBrowserWOMService';
import { ClassicBrowserStateService } from './ClassicBrowserStateService';
import { JeffersObject, MediaType } from '../../shared/types';
import { NotebookTabGroupInfo } from '../../shared/types/contextMenu.types';
import { v4 as uuidv4 } from 'uuid';

export interface TabTransferServiceDeps {
  objectModelCore: ObjectModelCore;
  objectAssociation: ObjectAssociationModel;
  notebookService: NotebookService;
  classicBrowserService: ClassicBrowserService;
  womService: ClassicBrowserWOMService;
  stateService: ClassicBrowserStateService;
}

export class ClassicBrowserTabTransferService extends BaseService<TabTransferServiceDeps> {
  constructor(deps: TabTransferServiceDeps) {
    super('ClassicBrowserTabTransferService', deps);
  }

  /**
   * Moves a tab from its current location to a target tab group in another notebook
   */
  async transferTabToNotebook(params: {
    sourceTabId: string;
    sourceWindowId: string;
    targetNotebookId: string;
    targetTabGroupId?: string; // If undefined, create new tab group
  }): Promise<void> {
    return this.execute('transferTabToNotebook', async () => {
      const { sourceTabId, sourceWindowId, targetNotebookId, targetTabGroupId } = params;
      
      this.logInfo(`Transferring tab ${sourceTabId} from window ${sourceWindowId} to notebook ${targetNotebookId}`);

      // 1. Get current tab state and find associated webpage object
      const tabState = this.getTabState(sourceTabId, sourceWindowId);
      if (!tabState) {
        throw new Error(`Tab ${sourceTabId} not found in window ${sourceWindowId}`);
      }

      // 2. Find or create the webpage object for this tab
      const webpageObject = await this.getOrCreateWebpageObjectForTab(tabState);
      
      // 3. Find or create target tab group
      const targetTabGroup = targetTabGroupId 
        ? await this.deps.objectModelCore.getById(targetTabGroupId)
        : await this.createNewTabGroupInNotebook(targetNotebookId);

      if (!targetTabGroup) {
        throw new Error(`Could not find or create target tab group`);
      }

      // 4. Add webpage object to target tab group
      await this.addWebpageToTabGroup(webpageObject.id, targetTabGroup.id);

      // 5. Associate webpage with target notebook (remove from source notebook if needed)
      await this.moveObjectToNotebook(webpageObject.id, targetNotebookId);

      // 6. Remove tab from source window
      this.deps.classicBrowserService.closeTab(sourceWindowId, sourceTabId);

      // 7. If target notebook has an active browser window, add tab there
      const targetWindowId = await this.findActiveWindowForNotebook(targetNotebookId);
      if (targetWindowId) {
        await this.addTabToExistingWindow(targetWindowId, webpageObject);
      }

      this.logInfo(`Successfully transferred tab ${sourceTabId} to notebook ${targetNotebookId}`);
    });
  }

  /**
   * Gets all available notebooks with their tab groups for the context menu
   */
  async getAvailableNotebooksWithTabGroups(): Promise<NotebookTabGroupInfo[]> {
    return this.execute('getAvailableNotebooksWithTabGroups', async () => {
      this.logInfo('Fetching all notebooks...');
      const notebooks = await this.deps.notebookService.getAllNotebooks();
      this.logInfo(`Found ${notebooks.length} notebooks:`, notebooks.map(n => ({ id: n.id, title: n.title })));
      
      const result: NotebookTabGroupInfo[] = [];

      for (const notebook of notebooks) {
        this.logDebug(`Processing notebook ${notebook.id} (${notebook.title})`);
        const objectIds = await this.deps.notebookService.getObjectIdsForNotebook(notebook.id);
        this.logDebug(`Notebook ${notebook.id} has ${objectIds.length} objects:`, objectIds);
        
        // Filter for tab group objects  
        const tabGroups = [];
        for (const objectId of objectIds) {
          const object = await this.deps.objectModelCore.getById(objectId);
          this.logDebug(`Object ${objectId}:`, { 
            exists: !!object, 
            objectType: object?.objectType,
            title: object?.title,
            childCount: object?.childObjectIds?.length 
          });
          
          if (object?.objectType === 'tab_group') {
            tabGroups.push({
              tabGroupId: object.id,
              title: object.title || 'Untitled Tab Group',
              tabCount: object.childObjectIds?.length || 0
            });
          }
        }

        this.logInfo(`Notebook ${notebook.title} has ${tabGroups.length} tab groups:`, tabGroups);

        result.push({
          notebookId: notebook.id,
          notebookTitle: notebook.title,
          tabGroups
        });
      }

      this.logInfo(`Final result: ${result.length} notebooks with tab groups:`, 
        result.map(n => ({ title: n.notebookTitle, tabGroups: n.tabGroups.length })));
      return result;
    });
  }

  /**
   * Get tab state from the browser state service
   */
  private getTabState(tabId: string, windowId: string) {
    const browserState = this.deps.stateService.states.get(windowId);
    return browserState?.tabs.find(tab => tab.id === tabId);
  }

  /**
   * Get or create a webpage object for the given tab
   */
  private async getOrCreateWebpageObjectForTab(tabState: { id: string; url: string; title: string; faviconUrl?: string | null }): Promise<JeffersObject> {
    // First try to find existing webpage object by URL
    let webpageObject = await this.deps.objectModelCore.findBySourceUri(tabState.url);
    
    if (!webpageObject) {
      // Create new webpage object
      webpageObject = await this.deps.objectModelCore.create({
        objectType: 'webpage' as MediaType,
        sourceUri: tabState.url,
        title: tabState.title || 'Untitled',
        status: 'new',
        rawContentRef: null
      });
      
      this.logDebug(`Created new webpage object ${webpageObject.id} for tab ${tabState.id}`);
    } else {
      // Update last accessed time
      await this.deps.objectModelCore.updateLastAccessed(webpageObject.id);
      this.logDebug(`Found existing webpage object ${webpageObject.id} for tab ${tabState.id}`);
    }
    
    return webpageObject;
  }

  /**
   * Create a new tab group in the specified notebook
   */
  private async createNewTabGroupInNotebook(notebookId: string): Promise<JeffersObject> {
    const notebook = await this.deps.notebookService.getNotebookById(notebookId);
    if (!notebook) {
      throw new Error(`Notebook ${notebookId} not found`);
    }

    // Create the tab group object
    const tabGroup = await this.deps.objectModelCore.create({
      objectType: 'tab_group' as MediaType,
      sourceUri: `tab-group://notebook-${notebookId}-${uuidv4()}`,
      title: `Tab Group - ${notebook.title}`,
      status: 'new',
      rawContentRef: null
    });

    // Associate the tab group with the notebook
    await this.deps.notebookService.assignObjectToNotebook(tabGroup.id, notebookId);

    this.logInfo(`Created new tab group ${tabGroup.id} in notebook ${notebookId}`);
    return tabGroup;
  }

  /**
   * Add a webpage object to a tab group
   */
  private async addWebpageToTabGroup(webpageObjectId: string, tabGroupId: string): Promise<void> {
    const tabGroup = await this.deps.objectModelCore.getById(tabGroupId);
    if (!tabGroup) {
      throw new Error(`Tab group ${tabGroupId} not found`);
    }

    const currentChildIds = tabGroup.childObjectIds || [];
    if (!currentChildIds.includes(webpageObjectId)) {
      const updatedChildIds = [...currentChildIds, webpageObjectId];
      await this.deps.objectModelCore.updateChildIds(tabGroupId, updatedChildIds);
      this.logDebug(`Added webpage ${webpageObjectId} to tab group ${tabGroupId}`);
    }
  }

  /**
   * Move an object from its current notebook association to a new notebook
   */
  private async moveObjectToNotebook(objectId: string, targetNotebookId: string): Promise<void> {
    // Remove from all current notebook associations
    this.deps.objectAssociation.removeAllAssociationsForObject(objectId);
    
    // Add to target notebook
    await this.deps.notebookService.assignObjectToNotebook(objectId, targetNotebookId);
    
    this.logDebug(`Moved object ${objectId} to notebook ${targetNotebookId}`);
  }

  /**
   * Find an active browser window for the given notebook
   * This is a simplified implementation - in practice you might want more sophisticated logic
   */
  private async findActiveWindowForNotebook(notebookId: string): Promise<string | null> {
    // For now, we'll just return null - the tab will be available when they open a browser in that notebook
    // In a more sophisticated implementation, you could:
    // 1. Check if there are existing browser windows for this notebook
    // 2. Look at the notebook's layout to see if there's an active browser
    // 3. Create a new browser window if needed
    
    this.logDebug(`Looking for active window for notebook ${notebookId} (not implemented)`);
    return null;
  }

  /**
   * Add a tab to an existing browser window
   * This would navigate to the webpage object's URL
   */
  private async addTabToExistingWindow(windowId: string, webpageObject: JeffersObject): Promise<void> {
    this.deps.classicBrowserService.createTab(windowId, webpageObject.sourceUri || undefined);
    this.logDebug(`Added tab for ${webpageObject.sourceUri} to window ${windowId}`);
  }
}