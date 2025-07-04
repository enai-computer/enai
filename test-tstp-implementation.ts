// Quick test script to verify TSTP implementation
import { CompositeObjectEnrichmentService } from './services/CompositeObjectEnrichmentService';

// Mock dependencies
const mockObjectModel = {
  getById: (id: string) => {
    if (id === 'tab-group-1') {
      return {
        id: 'tab-group-1',
        objectType: 'tab_group',
        childObjectIds: ['child-1', 'child-2', 'child-3'],
        title: 'Browser Window',
        summary: null,
        tagsJson: null,
        propositionsJson: null
      };
    }
    // Mock child objects
    return {
      id,
      title: `Test Page ${id}`,
      summary: `Summary for ${id}`,
      tagsJson: JSON.stringify(['AI', 'test', 'research']),
      propositionsJson: JSON.stringify([
        { type: 'main', content: `Main proposition for ${id}` },
        { type: 'supporting', content: `Supporting fact for ${id}` }
      ])
    };
  },
  update: async (id: string, data: any) => {
    console.log('Update called with:', { id, data });
    console.log('Tags:', data.tagsJson);
    console.log('Propositions:', data.propositionsJson);
  }
};

const mockLLM = {
  invoke: async (prompt: string) => {
    console.log('\n=== LLM PROMPT ===');
    console.log(prompt);
    console.log('=================\n');
    
    // Check if the prompt contains TSTP structure
    if (prompt.includes('Children metadata:') && prompt.includes('"uuid"')) {
      console.log('✅ Prompt contains structured TSTP data');
    }
    
    return {
      content: JSON.stringify({
        title: "AI Research Collection",
        summary: "A comprehensive collection exploring AI research, ethics, and applications.",
        tags: ["AI", "research", "test", "collection"],
        propositions: [
          { type: "main", content: "This collection demonstrates AI capabilities" },
          { type: "supporting", content: "Multiple perspectives on AI are represented" }
        ]
      })
    };
  }
};

const mockVectorModel = {
  addDocuments: async (docs: any[]) => {
    console.log('Vector documents added:', docs.length);
  }
};

// Test the implementation
async function testTSTPImplementation() {
  const service = new CompositeObjectEnrichmentService({
    db: {} as any,
    objectModel: mockObjectModel as any,
    lanceVectorModel: mockVectorModel as any,
    llm: mockLLM as any
  });

  // Initialize service
  await service.initialize();

  // Test enrichment
  console.log('Testing TSTP enrichment...\n');
  await (service as any).enrichComposite('tab-group-1');
  
  console.log('\n✅ TSTP implementation test completed!');
}

// Run the test
testTSTPImplementation().catch(console.error);