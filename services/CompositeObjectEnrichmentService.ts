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

interface ChildTSTP {
  uuid: string;
  title: string;
  summary: string;
  tags: string[];
  propositions: Array<{ type: string; content: string }>;
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

      // Extract full TSTP from children
      const childrenTSTP = this.extractChildTSTP(validChildren);

      // Generate synthesis with TSTP data
      const prompt = this.buildTSTPPrompt(childrenTSTP);
      const response = await this.deps.llm.invoke(prompt);
      const tstp = this.parseTSTPResponse(response.content);

      // Update object with full TSTP
      await this.deps.objectModel.update(objectId, {
        title: tstp.title,
        summary: tstp.summary,
        tagsJson: JSON.stringify(tstp.tags),
        propositionsJson: JSON.stringify(tstp.propositions),
        status: 'complete'
      });

      // Generate embedding
      const content = `${tstp.title} ${tstp.summary}`;
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
        title: tstp.title,
        summary: tstp.summary
      };

      await this.deps.lanceVectorModel.addDocuments([vectorRecord]);

      this.enrichmentQueue.delete(objectId);
    });
  }

  private extractChildTSTP(children: any[]): ChildTSTP[] {
    return children.map(child => ({
      uuid: child.id,
      title: child.title || 'Untitled',
      summary: child.summary || '',
      tags: this.safeParseJSON(child.tagsJson, []),
      propositions: this.safeParseJSON(child.propositionsJson, [])
    }));
  }

  private safeParseJSON<T>(json: string | null, defaultValue: T): T {
    if (!json) return defaultValue;
    try {
      return JSON.parse(json);
    } catch {
      return defaultValue;
    }
  }

  private buildTSTPPrompt(childrenTSTP: ChildTSTP[]): string {
    return `You are analyzing a collection of related webpages to generate composite metadata that captures the essence of the entire group.

Children metadata:
${JSON.stringify(childrenTSTP, null, 2)}

Generate composite metadata in the following JSON format:
{
  "title": "A thematic title capturing the essence (max 6 words)",
  "summary": "A comprehensive one-paragraph summary that synthesizes the common themes and key insights from all pages",
  "tags": ["select the most relevant tags from children", "add 1-2 meta-tags that capture the group theme"],
  "propositions": [
    {"type": "main", "content": "A key insight that spans multiple pages"},
    {"type": "supporting", "content": "Supporting evidence or patterns observed across pages"},
    {"type": "action", "content": "Recommended actions based on the collective content (if applicable)"}
  ]
}

Ensure:
- Tags array contains 5-10 most relevant tags (deduplicated)
- Propositions capture cross-cutting insights, not just individual page facts
- Summary incorporates key propositions from child pages`;
  }

  private parseTSTPResponse(content: any): { title: string; summary: string; tags: string[]; propositions: Array<{ type: string; content: string }> } {
    const defaultResponse = {
      title: 'Tab Group',
      summary: 'A collection of related web pages',
      tags: [],
      propositions: []
    };

    try {
      // Handle string response
      if (typeof content === 'string') {
        // Try JSON parsing (with or without markdown code blocks)
        try {
          const cleanedContent = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
          const parsed = JSON.parse(cleanedContent);
          
          if (parsed.title && parsed.summary) {
            return {
              title: parsed.title,
              summary: parsed.summary,
              tags: Array.isArray(parsed.tags) ? parsed.tags : [],
              propositions: Array.isArray(parsed.propositions) ? parsed.propositions : []
            };
          }
        } catch {
          // JSON parsing failed, fallback to simpler parsing
        }
        
        // For non-JSON responses, extract what we can
        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        
        // Try to find title and summary in various formats
        const titleLine = lines.find(line => line.match(/^(?:1\.|title:)\s*(.+)/i));
        const titleMatch = titleLine?.match(/^(?:1\.|title:)\s*(.+)/i);
        const title = titleMatch ? titleMatch[1].trim() : defaultResponse.title;
        
        const summaryStartIndex = lines.findIndex(line => 
          line.match(/^(?:2\.|summary:)\s*(.+)/i)
        );
        
        let summary = defaultResponse.summary;
        if (summaryStartIndex !== -1) {
          const summaryLines = lines.slice(summaryStartIndex);
          summary = summaryLines
            .map(line => line.replace(/^(?:2\.|summary:)\s*/i, ''))
            .join(' ')
            .trim();
        }
        
        return { title, summary, tags: [], propositions: [] };
      }
      
      // Handle AIMessage object format
      if (content && typeof content === 'object' && 'content' in content) {
        return this.parseTSTPResponse(content.content);
      }
      
      return defaultResponse;
    } catch (error) {
      this.logError('Failed to parse TSTP response', error);
      return defaultResponse;
    }
  }

  async cleanup(): Promise<void> {
    // Clear all pending enrichments
    this.enrichmentQueue.forEach(timeout => clearTimeout(timeout));
    this.enrichmentQueue.clear();
  }
}