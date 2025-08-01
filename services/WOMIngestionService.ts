import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './base/BaseService';
import { ObjectModelCore } from '../models/ObjectModelCore';
import { LanceVectorModel } from '../models/LanceVectorModel';
import { IngestionAiService } from './ingestion/IngestionAIService';
import { JeffersObject } from '../shared/types/object.types';
import { WOMTabVector, MediaType } from '../shared/types/vector.types';
import { WOM_CONSTANTS } from './constants/womConstants';
import { createEmbeddingModel } from '../utils/llm';

interface WOMIngestionDeps {
  db: Database.Database;
  objectModelCore: ObjectModelCore;
  lanceVectorModel: LanceVectorModel;
  ingestionAiService: IngestionAiService;
}

export class WOMIngestionService extends BaseService<WOMIngestionDeps> {
  private refreshDebounce = new Map<string, NodeJS.Timeout>();
  private embeddings = createEmbeddingModel();

  constructor(deps: WOMIngestionDeps) {
    super('WOMIngestionService', deps);
  }

  async ingestWebpage(url: string, title: string): Promise<JeffersObject> {
    return this.execute('ingestWebpage', async () => {
      // 1. Create/update object
      const object = await this.deps.objectModelCore.createOrUpdate({
        objectType: 'webpage' as MediaType,
        sourceUri: url,
        title,
        status: 'embedding',
        rawContentRef: null,
        lastAccessedAt: new Date().toISOString() as any  // Type assertion due to interface mismatch
      });

      // 2. Generate AI metadata (no chunking)
      const metadata = await this.deps.ingestionAiService.generateObjectSummary(
        `Title: ${title}\nURL: ${url}`,
        title,
        object.id
      );

      // 3. Update object with metadata
      await this.deps.objectModelCore.update(object.id, {
        title: metadata.title,
        summary: metadata.summary,
        tagsJson: JSON.stringify(metadata.tags),
        propositionsJson: JSON.stringify(metadata.propositions?.map((p: {content: string}) => p.content) || []),
        status: 'complete'
      });

      // 4. Generate embedding for the content
      const content = `${metadata.title} ${metadata.summary} ${metadata.propositions?.map((p: {content: string}) => p.content).join(' ') || ''}`;
      const embedding = await this.embeddings.embedQuery(content);

      // 5. Create WOM vector
      const vectorRecord: WOMTabVector = {
        id: uuidv4(),
        recordType: 'object',
        mediaType: 'webpage',
        layer: 'wom',
        processingDepth: 'summary',
        objectId: object.id,
        vector: new Float32Array(embedding),
        content,
        createdAt: new Date().toISOString(),
        title: metadata.title,
        summary: metadata.summary,
        sourceUri: url,
        tags: metadata.tags,
        propositions: metadata.propositions?.map((p: {content: string}) => p.content) || []
      };

      await this.deps.lanceVectorModel.addDocuments([vectorRecord]);

      // Return the updated object
      const updatedObject = await this.deps.objectModelCore.getById(object.id);
      return updatedObject!;
    });
  }

  async scheduleRefresh(objectId: string, url: string): Promise<void> {
    // Debounce refresh requests
    if (this.refreshDebounce.has(objectId)) {
      clearTimeout(this.refreshDebounce.get(objectId));
    }

    const timeout = setTimeout(
      async () => {
        try {
          await this.checkAndRefresh(objectId, url);
        } catch (error) {
          // Handle the error properly instead of letting it become unhandled
          this.logError('Failed to refresh object', error, { objectId, url });
          // Clean up the debounce entry even if refresh failed
          this.refreshDebounce.delete(objectId);
        }
      },
      WOM_CONSTANTS.INGESTION_DEBOUNCE_MS
    );

    this.refreshDebounce.set(objectId, timeout);
  }

  private async checkAndRefresh(objectId: string, url: string): Promise<void> {
    return this.execute('checkAndRefresh', async () => {
      const object = await this.deps.objectModelCore.getById(objectId);
      if (!object) return;

      // Check if refresh needed
      const lastIngested = object.updatedAt || object.createdAt;
      // Use milliseconds for time calculations (both lastIngested and current time are converted to ms)
      const timeSinceIngestion = Date.now() - new Date(lastIngested).getTime();

      if (timeSinceIngestion > WOM_CONSTANTS.REFRESH_CHECK_INTERVAL_MS) {
        // Re-ingest the webpage
        await this.ingestWebpage(url, object.title || 'Untitled');
      } else {
        // Just update the timestamp
        this.deps.objectModelCore.updateLastAccessed(objectId);
        
        // Update the vector metadata
        await this.updateVectorTimestamp(objectId);
      }

      this.refreshDebounce.delete(objectId);
    });
  }

  private async updateVectorTimestamp(objectId: string): Promise<void> {
    await this.deps.lanceVectorModel.updateMetadata(objectId, {
      lastAccessedAt: new Date().toISOString()
    });
    this.logDebug(`Updated vector timestamp for object ${objectId}`);
  }

  async cleanup(): Promise<void> {
    this.refreshDebounce.forEach(timeout => clearTimeout(timeout));
    this.refreshDebounce.clear();
  }
}