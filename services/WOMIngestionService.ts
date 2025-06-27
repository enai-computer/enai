import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './base/BaseService';
import { ObjectModel } from '../models/ObjectModel';
import { LanceVectorModel } from '../models/LanceVectorModel';
import { IngestionAIService } from './ingestion/IngestionAIService';
import { JeffersObject } from '../shared/types/object.types';
import { WOMTabVector } from '../shared/types/vector.types';
import { WOM_CONSTANTS } from './constants/womConstants';
import { createEmbeddingModel } from '../utils/llm';

interface WOMIngestionDeps {
  db: Database.Database;
  objectModel: ObjectModel;
  lanceVectorModel: LanceVectorModel;
  ingestionAiService: IngestionAIService;
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
      const object = await this.deps.objectModel.createOrUpdate({
        objectType: 'webpage',
        sourceUri: url,
        title,
        status: 'processing',
        lastAccessedAt: new Date()
      });

      // 2. Generate AI metadata (no chunking)
      const metadata = await this.deps.ingestionAiService.generateObjectSummary(
        `Title: ${title}\nURL: ${url}`,
        title,
        object.id
      );

      // 3. Update object with metadata
      await this.deps.objectModel.update(object.id, {
        title: metadata.title,
        summary: metadata.summary,
        tagsJson: JSON.stringify(metadata.tags),
        propositionsJson: JSON.stringify(metadata.propositions.map(p => p.content)),
        status: 'complete'
      });

      // 4. Generate embedding for the content
      const content = `${metadata.title} ${metadata.summary} ${metadata.propositions.map(p => p.content).join(' ')}`;
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
        createdAt: Date.now(),
        title: metadata.title,
        summary: metadata.summary,
        sourceUri: url,
        tags: metadata.tags,
        propositions: metadata.propositions.map(p => p.content)
      };

      await this.deps.lanceVectorModel.addDocuments([vectorRecord]);

      // Return the updated object
      const updatedObject = await this.deps.objectModel.getById(object.id);
      return updatedObject!;
    });
  }

  async scheduleRefresh(objectId: string, url: string): Promise<void> {
    // Debounce refresh requests
    if (this.refreshDebounce.has(objectId)) {
      clearTimeout(this.refreshDebounce.get(objectId));
    }

    const timeout = setTimeout(
      () => this.checkAndRefresh(objectId, url),
      WOM_CONSTANTS.INGESTION_DEBOUNCE_MS
    );

    this.refreshDebounce.set(objectId, timeout);
  }

  private async checkAndRefresh(objectId: string, url: string): Promise<void> {
    return this.execute('checkAndRefresh', async () => {
      const object = await this.deps.objectModel.getById(objectId);
      if (!object) return;

      // Check if refresh needed
      const lastIngested = object.updatedAt || object.createdAt;
      const timeSinceIngestion = Date.now() - new Date(lastIngested).getTime();

      if (timeSinceIngestion > WOM_CONSTANTS.REFRESH_CHECK_INTERVAL_MS) {
        // Re-ingest the webpage
        await this.ingestWebpage(url, object.title || 'Untitled');
      } else {
        // Just update the timestamp
        this.deps.objectModel.updateLastAccessed(objectId);
        
        // Update the vector metadata
        await this.updateVectorTimestamp(objectId);
      }

      this.refreshDebounce.delete(objectId);
    });
  }

  private async updateVectorTimestamp(objectId: string): Promise<void> {
    // Since LanceVectorModel doesn't have updateMetadata yet, we'll need to implement it
    // For now, this is a placeholder
    this.logDebug(`Would update vector timestamp for object ${objectId}`);
    // TODO: Implement updateMetadata in LanceVectorModel
  }

  async cleanup(): Promise<void> {
    this.refreshDebounce.forEach(timeout => clearTimeout(timeout));
    this.refreshDebounce.clear();
  }
}