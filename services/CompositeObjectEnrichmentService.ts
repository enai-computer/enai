import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseService } from './base/BaseService';
import { ObjectModel } from '../models/ObjectModel';
import { LanceVectorModel } from '../models/LanceVectorModel';
import { WOM_CONSTANTS } from './constants/womConstants';
import { WOMGroupVector } from '../shared/types/vector.types';
import { createEmbeddingModel } from '../utils/llm';

interface CompositeEnrichmentDeps {
  db: Database.Database;
  objectModel: ObjectModel;
  lanceVectorModel: LanceVectorModel;
  llm: BaseChatModel;
}

export class CompositeObjectEnrichmentService extends BaseService<CompositeEnrichmentDeps> {
  private enrichmentQueue = new Map<string, NodeJS.Timeout>();
  private embeddings = createEmbeddingModel();

  constructor(deps: CompositeEnrichmentDeps) {
    super('CompositeObjectEnrichmentService', deps);
  }

  async scheduleEnrichment(objectId: string): Promise<void> {
    // Debounce enrichment requests
    if (this.enrichmentQueue.has(objectId)) {
      clearTimeout(this.enrichmentQueue.get(objectId));
    }

    const timeout = setTimeout(
      () => this.enrichComposite(objectId),
      WOM_CONSTANTS.ENRICHMENT_DEBOUNCE_MS
    );

    this.enrichmentQueue.set(objectId, timeout);
  }

  private async enrichComposite(objectId: string): Promise<void> {
    return this.execute('enrichComposite', async () => {
      const object = await this.deps.objectModel.getById(objectId);
      if (!object || !object.childObjectIds?.length) return;

      // Fetch child metadata
      const children = await Promise.all(
        object.childObjectIds.map(id => this.deps.objectModel.getById(id))
      );

      const validChildren = children.filter(c => c !== null);
      if (validChildren.length < WOM_CONSTANTS.MIN_CHILDREN_FOR_AUTO_ENRICH) {
        this.logDebug(`Object ${objectId} has only ${validChildren.length} children, skipping enrichment`);
        return;
      }

      // Generate synthesis
      const prompt = `Given these related webpages, generate:
1. A concise thematic title (max 6 words)
2. A one-paragraph summary of the common themes

Webpages:
${validChildren.map(c => `- ${c.title}: ${c.summary || 'No summary available'}`).join('\n')}

Respond in JSON format with fields: "title" and "summary"`;

      const response = await this.deps.llm.invoke(prompt);
      const { title, summary } = this.parseAIResponse(response.content);

      // Update object
      await this.deps.objectModel.update(objectId, {
        title,
        summary,
        status: 'complete'
      });

      // Generate embedding
      const content = `${title} ${summary}`;
      const embedding = await this.embeddings.embedQuery(content);

      // Create/update WOM vector
      const vectorRecord: WOMGroupVector = {
        id: uuidv4(),
        recordType: 'object',
        mediaType: 'tab_group',
        layer: 'wom',
        processingDepth: 'summary',
        tabGroupId: objectId,
        vector: new Float32Array(embedding),
        content,
        createdAt: Date.now(),
        title,
        summary
      };

      await this.deps.lanceVectorModel.addDocuments([vectorRecord]);

      this.enrichmentQueue.delete(objectId);
    });
  }

  private parseAIResponse(content: any): { title: string; summary: string } {
    try {
      // Handle string response
      if (typeof content === 'string') {
        // First try JSON parsing (with or without markdown code blocks)
        try {
          const cleanedContent = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
          const parsed = JSON.parse(cleanedContent);
          
          if (parsed.title && parsed.summary) {
            return {
              title: parsed.title,
              summary: parsed.summary
            };
          }
        } catch {
          // JSON parsing failed, try other formats
        }
        
        // Look for numbered list format: "1. Title\n2. Summary"
        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        
        // Extract title (line starting with "1." or containing title-like content)
        const titleLine = lines.find(line => line.match(/^1\.\s*(.+)/) || line.match(/^title:\s*(.+)/i));
        const titleMatch = titleLine?.match(/^(?:1\.\s*|title:\s*)(.+)/i);
        const title = titleMatch ? titleMatch[1].trim() : null;
        
        // Extract summary (line starting with "2." or after title)
        const summaryStartIndex = lines.findIndex(line => 
          line.match(/^2\.\s*(.+)/) || 
          line.match(/^summary:\s*(.+)/i) ||
          (title && lines.indexOf(titleLine!) > -1 && line !== titleLine)
        );
        
        let summary = null;
        if (summaryStartIndex !== -1) {
          // Get all lines from summary start to end, removing number prefix if present
          const summaryLines = lines.slice(summaryStartIndex);
          summary = summaryLines
            .map(line => line.replace(/^(?:2\.\s*|summary:\s*)/i, ''))
            .join(' ')
            .trim();
        }
        
        if (title && summary) {
          return { title, summary };
        }
        
        // If we have partial results, use what we have
        if (title || summary) {
          return {
            title: title || 'Tab Group',
            summary: summary || 'A collection of related web pages'
          };
        }
      }
      
      // Handle AIMessage object format
      if (content && typeof content === 'object' && 'content' in content) {
        return this.parseAIResponse(content.content);
      }
      
      // Fallback
      return {
        title: 'Tab Group',
        summary: 'A collection of related web pages'
      };
    } catch (error) {
      this.logError('Failed to parse AI response', error);
      return {
        title: 'Tab Group',
        summary: 'A collection of related web pages'
      };
    }
  }

  async cleanup(): Promise<void> {
    // Clear all pending enrichments
    this.enrichmentQueue.forEach(timeout => clearTimeout(timeout));
    this.enrichmentQueue.clear();
  }
}