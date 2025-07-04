import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CompositeObjectEnrichmentService } from '../CompositeObjectEnrichmentService';
import { ObjectModel } from '../../models/ObjectModel';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { runMigrations } from '../../models/runMigrations';
import { JeffersObject } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

// Mock the LLM utility
vi.mock('../../utils/llm', () => ({
  getModel: vi.fn(() => ({
    invoke: vi.fn()
  })),
  createEmbeddingModel: vi.fn(() => ({
    embedQuery: vi.fn(() => Promise.resolve(new Array(1536).fill(0)))
  }))
}));

describe('CompositeObjectEnrichmentService', () => {
  let db: Database.Database;
  let service: CompositeObjectEnrichmentService;
  let objectModel: ObjectModel;
  let vectorModel: LanceVectorModel;
  let mockLLM: any;

  beforeEach(async () => {
    // Setup in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    
    // Initialize models
    objectModel = new ObjectModel(db);
    vectorModel = new LanceVectorModel();
    
    // Get mocked LLM
    const { getModel } = await import('../../utils/llm');
    mockLLM = getModel('gpt-4o-nano');
    
    // Initialize service
    service = new CompositeObjectEnrichmentService({
      db,
      objectModel,
      lanceVectorModel: vectorModel,
      llm: mockLLM
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.cleanup();
    db.close();
    vi.clearAllMocks();
  });

  describe('enrichComposite with TSTP aggregation', () => {
    it('should aggregate TSTP from child webpages to generate composite TSTP', async () => {
      // Arrange: Create a tab group with 3 child webpages
      const tabGroupId = uuidv4();
      const childIds = [uuidv4(), uuidv4(), uuidv4()];
      
      // Create tab group object
      const tabGroup: JeffersObject = {
        id: tabGroupId,
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-123',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { childIds },
        tagsJson: null,
        propositionsJson: null
      };
      objectModel.create(tabGroup);
      
      // Create child webpage objects with full TSTP
      const childWebpages = [
        {
          id: childIds[0],
          objectType: 'webpage' as const,
          sourceUri: 'https://example.com/ai-research',
          title: 'Latest Advances in AI Research',
          summary: 'This article discusses recent breakthroughs in artificial intelligence, focusing on large language models and their applications in healthcare and education.',
          cleanedText: 'AI research content...',
          status: 'parsed' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
          tagsJson: JSON.stringify(['AI', 'machine learning', 'healthcare', 'education', 'LLM']),
          propositionsJson: JSON.stringify([
            { type: 'main', content: 'LLMs have achieved human-level performance in medical diagnosis' },
            { type: 'supporting', content: 'GPT-4 scored 90% on medical licensing exams' },
            { type: 'fact', content: 'AI adoption in healthcare increased by 45% in 2024' }
          ])
        },
        {
          id: childIds[1],
          objectType: 'webpage' as const,
          sourceUri: 'https://example.com/ai-ethics',
          title: 'Ethical Considerations in AI Development',
          summary: 'An exploration of the ethical challenges facing AI development, including bias, privacy concerns, and the need for responsible AI governance.',
          cleanedText: 'AI ethics content...',
          status: 'parsed' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
          tagsJson: JSON.stringify(['AI', 'ethics', 'privacy', 'governance', 'bias']),
          propositionsJson: JSON.stringify([
            { type: 'main', content: 'AI systems can perpetuate societal biases if not carefully designed' },
            { type: 'supporting', content: 'Studies show facial recognition has higher error rates for minorities' },
            { type: 'action', content: 'Companies should implement AI ethics boards' }
          ])
        },
        {
          id: childIds[2],
          objectType: 'webpage' as const,
          sourceUri: 'https://example.com/ai-regulation',
          title: 'Global AI Regulation Landscape',
          summary: 'Overview of AI regulations worldwide, comparing approaches in the EU, US, and Asia, with focus on data protection and algorithmic accountability.',
          cleanedText: 'AI regulation content...',
          status: 'parsed' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
          tagsJson: JSON.stringify(['AI', 'regulation', 'privacy', 'EU', 'GDPR', 'accountability']),
          propositionsJson: JSON.stringify([
            { type: 'main', content: 'The EU AI Act sets global precedent for AI regulation' },
            { type: 'fact', content: 'GDPR fines for AI violations can reach 4% of global revenue' },
            { type: 'supporting', content: 'US taking sector-specific approach to AI regulation' }
          ])
        }
      ];
      
      childWebpages.forEach(webpage => objectModel.create(webpage));
      
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
      await service.enrichComposite(tabGroupId);
      
      // Assert: Verify LLM was called with correct structured prompt
      expect(mockLLM.invoke).toHaveBeenCalledWith(
        expect.stringContaining('You are analyzing a collection of related webpages')
      );
      
      // Verify the prompt included TSTP data from children
      const actualPrompt = mockLLM.invoke.mock.calls[0][0];
      expect(actualPrompt).toContain('Latest Advances in AI Research');
      expect(actualPrompt).toContain('"tags":["AI","machine learning","healthcare","education","LLM"]');
      expect(actualPrompt).toContain('LLMs have achieved human-level performance in medical diagnosis');
      
      // Assert: Verify tab group was updated with TSTP
      const updatedTabGroup = objectModel.getById(tabGroupId);
      expect(updatedTabGroup).toBeDefined();
      expect(updatedTabGroup!.title).toBe('AI Progress Ethics and Regulation');
      expect(updatedTabGroup!.summary).toContain('comprehensive exploration of artificial intelligence');
      expect(updatedTabGroup!.tagsJson).toBe('["AI","ethics","regulation","healthcare","privacy","governance","innovation"]');
      expect(updatedTabGroup!.propositionsJson).toBeDefined();
      
      const propositions = JSON.parse(updatedTabGroup!.propositionsJson!);
      expect(propositions).toHaveLength(3);
      expect(propositions[0].type).toBe('main');
      expect(propositions[0].content).toContain('balancing innovation with ethical considerations');
      
      // Assert: Verify vector embedding was created
      const vectors = await vectorModel.search('AI ethics regulation', {
        layer: 'wom',
        recordType: 'object',
        mediaType: 'tab_group',
        limit: 10
      });
      
      const tabGroupVector = vectors.find(v => v.objectId === tabGroupId);
      expect(tabGroupVector).toBeDefined();
      expect(tabGroupVector!.processingDepth).toBe('summary');
    });

    it('should handle child objects with missing TSTP fields gracefully', async () => {
      // Arrange: Create tab group with children having partial TSTP
      const tabGroupId = uuidv4();
      const childIds = [uuidv4(), uuidv4()];
      
      const tabGroup: JeffersObject = {
        id: tabGroupId,
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-456',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { childIds },
        tagsJson: null,
        propositionsJson: null
      };
      objectModel.create(tabGroup);
      
      // Child with full TSTP
      objectModel.create({
        id: childIds[0],
        objectType: 'webpage',
        sourceUri: 'https://example.com/page1',
        title: 'Page with Full Metadata',
        summary: 'This page has all metadata fields populated.',
        cleanedText: 'Content...',
        status: 'parsed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
        tagsJson: JSON.stringify(['complete', 'metadata']),
        propositionsJson: JSON.stringify([
          { type: 'main', content: 'This page has complete information' }
        ])
      });
      
      // Child with missing tags and propositions
      objectModel.create({
        id: childIds[1],
        objectType: 'webpage',
        sourceUri: 'https://example.com/page2',
        title: 'Page with Partial Metadata',
        summary: null, // No summary
        cleanedText: 'Content...',
        status: 'parsed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
        tagsJson: null, // No tags
        propositionsJson: null // No propositions
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
      await service.enrichComposite(tabGroupId);
      
      // Assert: Verify prompt handled missing data gracefully
      const actualPrompt = mockLLM.invoke.mock.calls[0][0];
      expect(actualPrompt).toContain('Page with Full Metadata');
      expect(actualPrompt).toContain('Page with Partial Metadata');
      expect(actualPrompt).toContain('"tags":["complete","metadata"]');
      expect(actualPrompt).toContain('"tags":[]'); // Empty array for missing tags
      
      // Verify enrichment succeeded
      const updatedTabGroup = objectModel.getById(tabGroupId);
      expect(updatedTabGroup!.title).toBe('Mixed Content Collection');
    });

    it('should skip enrichment if fewer than minimum children', async () => {
      // Arrange: Create tab group with only 2 children (below threshold of 3)
      const tabGroupId = uuidv4();
      const childIds = [uuidv4(), uuidv4()];
      
      const tabGroup: JeffersObject = {
        id: tabGroupId,
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-789',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { childIds },
        tagsJson: null,
        propositionsJson: null
      };
      objectModel.create(tabGroup);
      
      // Act
      await service.enrichComposite(tabGroupId);
      
      // Assert: LLM should not have been called
      expect(mockLLM.invoke).not.toHaveBeenCalled();
      
      // Tab group should remain unchanged
      const unchangedTabGroup = objectModel.getById(tabGroupId);
      expect(unchangedTabGroup!.title).toBe('Browser Window');
      expect(unchangedTabGroup!.summary).toBeNull();
    });

    it('should handle LLM parsing errors gracefully', async () => {
      // Arrange
      const tabGroupId = uuidv4();
      const childIds = [uuidv4(), uuidv4(), uuidv4()];
      
      const tabGroup: JeffersObject = {
        id: tabGroupId,
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-error',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { childIds },
        tagsJson: null,
        propositionsJson: null
      };
      objectModel.create(tabGroup);
      
      // Create minimal child objects
      childIds.forEach(id => {
        objectModel.create({
          id,
          objectType: 'webpage',
          sourceUri: `https://example.com/${id}`,
          title: `Page ${id}`,
          summary: 'Test page',
          cleanedText: 'Content...',
          status: 'parsed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
          tagsJson: JSON.stringify(['test']),
          propositionsJson: JSON.stringify([{ type: 'main', content: 'Test proposition' }])
        });
      });
      
      // Mock LLM with malformed response
      mockLLM.invoke.mockResolvedValue({
        content: "This is not valid JSON at all!"
      });
      
      // Act & Assert: Should not throw
      await expect(service.enrichComposite(tabGroupId)).resolves.not.toThrow();
      
      // Tab group should have attempted enrichment but handled error
      const tabGroupAfter = objectModel.getById(tabGroupId);
      expect(tabGroupAfter).toBeDefined();
      // Original title should be preserved on error
      expect(tabGroupAfter!.title).toBe('Browser Window');
    });

    it('should properly structure the LLM prompt with TSTP data', async () => {
      // Arrange
      const tabGroupId = uuidv4();
      const childIds = [uuidv4(), uuidv4(), uuidv4()];
      
      const tabGroup: JeffersObject = {
        id: tabGroupId,
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-prompt-test',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { childIds },
        tagsJson: null,
        propositionsJson: null
      };
      objectModel.create(tabGroup);
      
      // Create children with specific TSTP data
      const testTags = ['test-tag-1', 'test-tag-2'];
      const testProposition = { type: 'main', content: 'Test proposition content' };
      
      childIds.forEach((id, index) => {
        objectModel.create({
          id,
          objectType: 'webpage',
          sourceUri: `https://example.com/page${index}`,
          title: `Test Page ${index}`,
          summary: `Summary for page ${index}`,
          cleanedText: 'Content...',
          status: 'parsed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
          tagsJson: JSON.stringify(testTags),
          propositionsJson: JSON.stringify([testProposition])
        });
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
      await service.enrichComposite(tabGroupId);
      
      // Assert: Verify the prompt structure
      const actualPrompt = mockLLM.invoke.mock.calls[0][0];
      
      // Should contain the new TSTP-focused prompt
      expect(actualPrompt).toContain('You are analyzing a collection of related webpages');
      expect(actualPrompt).toContain('Generate composite metadata that captures the essence');
      
      // Should contain structured TSTP data
      expect(actualPrompt).toContain('"uuid"');
      expect(actualPrompt).toContain('"title"');
      expect(actualPrompt).toContain('"summary"');
      expect(actualPrompt).toContain('"tags"');
      expect(actualPrompt).toContain('"propositions"');
      
      // Should include actual data
      childIds.forEach((id, index) => {
        expect(actualPrompt).toContain(id);
        expect(actualPrompt).toContain(`Test Page ${index}`);
        expect(actualPrompt).toContain(`Summary for page ${index}`);
      });
      expect(actualPrompt).toContain(JSON.stringify(testTags));
      expect(actualPrompt).toContain('Test proposition content');
    });
  });

  describe('scheduleEnrichment', () => {
    it('should debounce multiple enrichment requests', async () => {
      const tabGroupId = uuidv4();
      const childIds = [uuidv4(), uuidv4(), uuidv4()];
      
      // Create tab group
      objectModel.create({
        id: tabGroupId,
        objectType: 'tab_group',
        sourceUri: 'tab-group://window-debounce',
        title: 'Browser Window',
        summary: null,
        cleanedText: 'Browser Window',
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: { childIds },
        tagsJson: null,
        propositionsJson: null
      });
      
      // Create children
      childIds.forEach(id => {
        objectModel.create({
          id,
          objectType: 'webpage',
          sourceUri: `https://example.com/${id}`,
          title: 'Test Page',
          summary: 'Test',
          cleanedText: 'Content...',
          status: 'parsed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
          tagsJson: JSON.stringify(['test']),
          propositionsJson: JSON.stringify([{ type: 'main', content: 'Test' }])
        });
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
      service.scheduleEnrichment(tabGroupId);
      service.scheduleEnrichment(tabGroupId);
      service.scheduleEnrichment(tabGroupId);
      
      // Wait for debounce timeout (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5100));
      
      // Assert: LLM should only be called once
      expect(mockLLM.invoke).toHaveBeenCalledTimes(1);
    });
  });
});