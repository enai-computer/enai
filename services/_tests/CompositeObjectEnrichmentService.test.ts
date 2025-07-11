import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CompositeObjectEnrichmentService } from '../CompositeObjectEnrichmentService';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { runMigrations } from '../../models/runMigrations';
import { JeffersObject } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

// Mock the LLM utility
vi.mock('../../utils/llm', () => ({
  createEmbeddingModel: vi.fn(() => ({
    embedQuery: vi.fn(() => Promise.resolve(new Array(1536).fill(0)))
  }))
}));

describe('CompositeObjectEnrichmentService', () => {
  let db: Database.Database;
  let service: CompositeObjectEnrichmentService;
  let objectModelCore: ObjectModelCore;
  let vectorModel: LanceVectorModel;
  let mockLLM: any;

  beforeEach(async () => {
    // Setup in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Initialize models
    objectModelCore = new ObjectModelCore(db);
    vectorModel = new LanceVectorModel({ userDataPath: '/tmp/test-jeffers' });
    await vectorModel.initialize();
    
    // Create mocked LLM
    mockLLM = {
      invoke: vi.fn()
    };
    
    // Initialize service
    service = new CompositeObjectEnrichmentService({
      db,
      objectModelCore,
      lanceVectorModel: vectorModel,
      llm: mockLLM as any
    });
    await service.initialize();
  });

  afterEach(async () => {
    if (service) {
      await service.cleanup();
    }
    // vectorModel doesn't have a cleanup method
    db.close();
    vi.clearAllMocks();
  });

  describe('enrichComposite with TSTP aggregation', () => {
    it('should aggregate TSTP from child webpages to generate composite TSTP', async () => {
      // Arrange: Create child webpages first
      const childWebpageData = [
        {
          objectType: 'webpage' as const,
          sourceUri: 'https://example.com/ai-research',
          title: 'Latest Advances in AI Research',
          summary: 'This article discusses recent breakthroughs in artificial intelligence, focusing on large language models and their applications in healthcare and education.',
          cleanedText: 'AI research content...',
          status: 'parsed' as const,
          tagsJson: JSON.stringify(['AI', 'machine learning', 'healthcare', 'education', 'LLM']),
          propositionsJson: JSON.stringify([
            { type: 'main', content: 'LLMs have achieved human-level performance in medical diagnosis' },
            { type: 'supporting', content: 'GPT-4 scored 90% on medical licensing exams' },
            { type: 'fact', content: 'AI adoption in healthcare increased by 45% in 2024' }
          ])
        },
        {
          objectType: 'webpage' as const,
          sourceUri: 'https://example.com/ai-ethics',
          title: 'Ethical Considerations in AI Development',
          summary: 'An exploration of the ethical challenges facing AI development, including bias, privacy concerns, and the need for responsible AI governance.',
          cleanedText: 'AI ethics content...',
          status: 'parsed' as const,
          tagsJson: JSON.stringify(['AI', 'ethics', 'privacy', 'governance', 'bias']),
          propositionsJson: JSON.stringify([
            { type: 'main', content: 'AI systems can perpetuate societal biases if not carefully designed' },
            { type: 'supporting', content: 'Studies show facial recognition has higher error rates for minorities' },
            { type: 'action', content: 'Companies should implement AI ethics boards' }
          ])
        },
        {
          objectType: 'webpage' as const,
          sourceUri: 'https://example.com/ai-regulation',
          title: 'Global AI Regulation Landscape',
          summary: 'Overview of AI regulations worldwide, comparing approaches in the EU, US, and Asia, with focus on data protection and algorithmic accountability.',
          cleanedText: 'AI regulation content...',
          status: 'parsed' as const,
          tagsJson: JSON.stringify(['AI', 'regulation', 'privacy', 'EU', 'GDPR', 'accountability']),
          propositionsJson: JSON.stringify([
            { type: 'main', content: 'The EU AI Act sets global precedent for AI regulation' },
            { type: 'fact', content: 'GDPR fines for AI violations can reach 4% of global revenue' },
            { type: 'supporting', content: 'US taking sector-specific approach to AI regulation' }
          ])
        }
      ];
      
      // Create child webpages and collect their IDs
      const createdChildren = await Promise.all(
        childWebpageData.map(data => objectModelCore.create(data))
      );
      const childIds = createdChildren.map(child => child.id);
      
      // Create tab group with child IDs
      const tabGroup = await objectModelCore.create({
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-123',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        childObjectIds: childIds,
        tagsJson: null,
        propositionsJson: null
      });
      
      // Mock LLM response with aggregated TSTP
      const mockResponse = {
        content: JSON.stringify({
          title: "AI Progress Ethics and Regulation",
          summary: "A comprehensive exploration of artificial intelligence's rapid advancement, ethical implications, and evolving regulatory landscape. These resources examine breakthrough achievements in healthcare and education applications, while addressing critical concerns about bias, privacy, and governance. The collection highlights the tension between innovation and responsibility, showcasing both AI's transformative potential and the urgent need for ethical frameworks and regulatory oversight.",
          tags: ["AI", "ethics", "regulation", "healthcare", "privacy", "governance", "innovation"],
          propositions: [
            { type: "main", content: "AI advancement requires balancing innovation with ethical considerations and regulatory frameworks" },
            { type: "supporting", content: "While AI achieves human-level performance in specialized domains, it raises significant bias and privacy concerns" },
            { type: "action", content: "Organizations must implement comprehensive AI governance combining ethics boards with regulatory compliance" }
          ]
        })
      };
      mockLLM.invoke.mockResolvedValue(mockResponse);
      
      // Act: Enrich the composite
      await (service as any).enrichComposite(tabGroup.id);
      
      // Assert: Verify LLM was called with correct structured prompt
      expect(mockLLM.invoke).toHaveBeenCalledWith(
        expect.stringContaining('You are analyzing a collection of related webpages')
      );
      
      // Verify the prompt included TSTP data from children
      const actualPrompt = mockLLM.invoke.mock.calls[0][0];
      expect(actualPrompt).toContain('Latest Advances in AI Research');
      expect(actualPrompt).toContain('"AI"');
      expect(actualPrompt).toContain('"machine learning"');
      expect(actualPrompt).toContain('"healthcare"');
      expect(actualPrompt).toContain('"education"');
      expect(actualPrompt).toContain('"LLM"');
      expect(actualPrompt).toContain('LLMs have achieved human-level performance in medical diagnosis');
      
      // Assert: Verify tab group was updated with TSTP
      const updatedTabGroup = await objectModelCore.getById(tabGroup.id);
      expect(updatedTabGroup).toBeDefined();
      expect(updatedTabGroup!.title).toBe('AI Progress Ethics and Regulation');
      expect(updatedTabGroup!.summary).toContain('comprehensive exploration of artificial intelligence');
      expect(updatedTabGroup!.tagsJson).toBe('["AI","ethics","regulation","healthcare","privacy","governance","innovation"]');
      expect(updatedTabGroup!.propositionsJson).toBeDefined();
      
      const propositions = JSON.parse(updatedTabGroup!.propositionsJson!);
      expect(propositions).toHaveLength(3);
      expect(propositions[0].type).toBe('main');
      expect(propositions[0].content).toContain('balancing innovation with ethical considerations');
      
      // Note: Vector embedding creation would be tested in integration tests
      // as it requires the actual vector model to be running
    });

    it('should handle child objects with missing TSTP fields gracefully', async () => {
      // Arrange: Create children first, then tab group
      // Child with full TSTP
      const child1 = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/page1',
        title: 'Page with Full Metadata',
        summary: 'This page has all metadata fields populated.',
        cleanedText: 'Content...',
        status: 'parsed',
        tagsJson: JSON.stringify(['complete', 'metadata']),
        propositionsJson: JSON.stringify([
          { type: 'main', content: 'This page has complete information' }
        ])
      });
      
      // Child with missing tags and propositions
      const child2 = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/page2',
        title: 'Page with Partial Metadata',
        summary: null, // No summary
        cleanedText: 'Content...',
        status: 'parsed',
        tagsJson: null, // No tags
        propositionsJson: null // No propositions
      });
      
      const tabGroup = await objectModelCore.create({
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-456',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        childObjectIds: [child1.id, child2.id],
        tagsJson: null,
        propositionsJson: null
      });
      
      // Mock LLM response
      mockLLM.invoke.mockResolvedValue({
        content: JSON.stringify({
          title: "Mixed Content Collection",
          summary: "A collection with varying levels of metadata completeness.",
          tags: ["complete", "metadata", "partial"],
          propositions: [
            { type: "main", content: "Collection demonstrates varying metadata quality" }
          ]
        })
      });
      
      // Act
      await (service as any).enrichComposite(tabGroup.id);
      
      // Assert: Verify LLM was called (we have 2 children which is below MIN_CHILDREN_FOR_AUTO_ENRICH)
      // Need to create 3 children for enrichment to trigger
      const child3 = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/page3',
        title: 'Third Page',
        summary: 'Minimal content',
        cleanedText: 'Content...',
        status: 'parsed'
      });
      
      // Update tab group with 3 children
      await objectModelCore.update(tabGroup.id, {
        childObjectIds: [child1.id, child2.id, child3.id]
      });
      
      // Now enrich with 3 children
      await (service as any).enrichComposite(tabGroup.id);
      
      // Assert: Verify prompt handled missing data gracefully
      const actualPrompt = mockLLM.invoke.mock.calls[0][0];
      expect(actualPrompt).toContain('Page with Full Metadata');
      expect(actualPrompt).toContain('Page with Partial Metadata');
      expect(actualPrompt).toContain('Third Page');
      // Check for tags in formatted JSON
      expect(actualPrompt).toContain('"complete"');
      expect(actualPrompt).toContain('"metadata"');
      expect(actualPrompt).toContain('"tags": []'); // Empty array for missing tags (with space)
      
      // Verify enrichment succeeded
      const updatedTabGroup = await objectModelCore.getById(tabGroup.id);
      expect(updatedTabGroup!.title).toBe('Mixed Content Collection');
    });

    it('should skip enrichment if fewer than minimum children', async () => {
      // Arrange: Create tab group with only 2 children (below threshold of 3)
      const child1 = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/child1',
        title: 'Child 1',
        cleanedText: 'Content...',
        status: 'parsed'
      });
      
      const child2 = await objectModelCore.create({
        objectType: 'webpage',
        sourceUri: 'https://example.com/child2',
        title: 'Child 2',
        cleanedText: 'Content...',
        status: 'parsed'
      });
      
      const tabGroup = await objectModelCore.create({
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-789',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        childObjectIds: [child1.id, child2.id],
        tagsJson: null,
        propositionsJson: null
      });
      
      // Act
      await (service as any).enrichComposite(tabGroup.id);
      
      // Assert: LLM should not have been called
      expect(mockLLM.invoke).not.toHaveBeenCalled();
      
      // Tab group should remain unchanged
      const unchangedTabGroup = await objectModelCore.getById(tabGroup.id);
      expect(unchangedTabGroup!.title).toBe('Browser Window');
      expect(unchangedTabGroup!.summary).toBeNull();
    });

    it('should handle LLM parsing errors gracefully', async () => {
      // Arrange
      // Create minimal child objects
      const children = await Promise.all([
        objectModelCore.create({
          objectType: 'webpage',
          sourceUri: `https://example.com/page1`,
          title: `Page 1`,
          summary: 'Test page',
          cleanedText: 'Content...',
          status: 'parsed',
          tagsJson: JSON.stringify(['test']),
          propositionsJson: JSON.stringify([{ type: 'main', content: 'Test proposition' }])
        }),
        objectModelCore.create({
          objectType: 'webpage',
          sourceUri: `https://example.com/page2`,
          title: `Page 2`,
          summary: 'Test page',
          cleanedText: 'Content...',
          status: 'parsed',
          tagsJson: JSON.stringify(['test']),
          propositionsJson: JSON.stringify([{ type: 'main', content: 'Test proposition' }])
        }),
        objectModelCore.create({
          objectType: 'webpage',
          sourceUri: `https://example.com/page3`,
          title: `Page 3`,
          summary: 'Test page',
          cleanedText: 'Content...',
          status: 'parsed',
          tagsJson: JSON.stringify(['test']),
          propositionsJson: JSON.stringify([{ type: 'main', content: 'Test proposition' }])
        })
      ]);
      
      const tabGroup = await objectModelCore.create({
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-error',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        childObjectIds: children.map(c => c.id),
        tagsJson: null,
        propositionsJson: null
      });
      
      // Mock LLM with malformed response
      mockLLM.invoke.mockResolvedValue({
        content: "This is not valid JSON at all!"
      });
      
      // Act & Assert: Should not throw
      await expect((service as any).enrichComposite(tabGroup.id)).resolves.not.toThrow();
      
      // Tab group should have attempted enrichment but handled error
      const tabGroupAfter = await objectModelCore.getById(tabGroup.id);
      expect(tabGroupAfter).toBeDefined();
      // Check if title was updated (it might have a fallback title)
      expect(tabGroupAfter!.title).toBeDefined();
      // The service might still update with a fallback title like 'Tab Group'
    });

    it('should properly structure the LLM prompt with TSTP data', async () => {
      // Arrange
      // Create children with specific TSTP data
      const testTags = ['test-tag-1', 'test-tag-2'];
      const testProposition = { type: 'main', content: 'Test proposition content' };
      
      const children = [];
      for (let i = 0; i < 3; i++) {
        const child = await objectModelCore.create({
          objectType: 'webpage',
          sourceUri: `https://example.com/page${i}`,
          title: `Test Page ${i}`,
          summary: `Summary for page ${i}`,
          cleanedText: 'Content...',
          status: 'parsed',
          tagsJson: JSON.stringify(testTags),
          propositionsJson: JSON.stringify([testProposition])
        });
        children.push(child);
      }
      
      const tabGroup = await objectModelCore.create({
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-prompt-test',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        childObjectIds: children.map(c => c.id),
        tagsJson: null,
        propositionsJson: null
      });
      
      mockLLM.invoke.mockResolvedValue({
        content: JSON.stringify({
          title: "Test Collection",
          summary: "Test summary",
          tags: testTags,
          propositions: [testProposition]
        })
      });
      
      // Act
      await (service as any).enrichComposite(tabGroup.id);
      
      // Assert: Verify the prompt structure
      const actualPrompt = mockLLM.invoke.mock.calls[0][0];
      
      // Should contain the new TSTP-focused prompt
      expect(actualPrompt).toContain('You are analyzing a collection of related webpages');
      // The prompt includes this text as part of a larger sentence
      expect(actualPrompt).toContain('generate composite metadata that captures the essence');
      
      // Should contain structured TSTP data
      expect(actualPrompt).toContain('"uuid"');
      expect(actualPrompt).toContain('"title"');
      expect(actualPrompt).toContain('"summary"');
      expect(actualPrompt).toContain('"tags"');
      expect(actualPrompt).toContain('"propositions"');
      
      // Should include actual data
      children.forEach((child, index) => {
        expect(actualPrompt).toContain(child.id);
        expect(actualPrompt).toContain(`Test Page ${index}`);
        expect(actualPrompt).toContain(`Summary for page ${index}`);
      });
      // Check for tags in formatted JSON
      expect(actualPrompt).toContain('"test-tag-1"');
      expect(actualPrompt).toContain('"test-tag-2"');
      expect(actualPrompt).toContain('Test proposition content');
    });
  });

  describe('scheduleEnrichment', () => {
    it('should debounce multiple enrichment requests', async () => {
      // Create children
      const children = [];
      for (let i = 0; i < 3; i++) {
        const child = await objectModelCore.create({
          objectType: 'webpage',
          sourceUri: `https://example.com/page-${i}`,
          title: 'Test Page',
          summary: 'Test',
          cleanedText: 'Content...',
          status: 'parsed',
          tagsJson: JSON.stringify(['test']),
          propositionsJson: JSON.stringify([{ type: 'main', content: 'Test' }])
        });
        children.push(child);
      }
      
      // Create tab group
      const tabGroup = await objectModelCore.create({
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-debounce',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        childObjectIds: children.map(c => c.id),
        tagsJson: null,
        propositionsJson: null
      });
      
      mockLLM.invoke.mockResolvedValue({
        content: JSON.stringify({
          title: "Debounced Title",
          summary: "Debounced summary",
          tags: ["test"],
          propositions: [{ type: "main", content: "Debounced" }]
        })
      });
      
      // Act: Schedule multiple times rapidly
      service.scheduleEnrichment(tabGroup.id);
      service.scheduleEnrichment(tabGroup.id);
      service.scheduleEnrichment(tabGroup.id);
      
      // Wait for debounce timeout (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5100));
      
      // Assert: LLM should only be called once
      expect(mockLLM.invoke).toHaveBeenCalledTimes(1);
    });
  });
});