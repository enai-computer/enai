import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SagaOrchestrator, SagaStep } from '../base/SagaOrchestrator';

describe('SagaOrchestrator', () => {
  let orchestrator: SagaOrchestrator;

  beforeEach(() => {
    orchestrator = new SagaOrchestrator();
  });

  describe('successful saga execution', () => {
    it('should execute all steps in order', async () => {
      const executionOrder: string[] = [];
      
      const steps: SagaStep[] = [
        {
          name: 'step1',
          action: async () => {
            executionOrder.push('step1');
            return 'result1';
          },
        },
        {
          name: 'step2',
          action: async () => {
            executionOrder.push('step2');
            return 'result2';
          },
        },
        {
          name: 'step3',
          action: async () => {
            executionOrder.push('step3');
            return 'result3';
          },
        },
      ];

      const result = await orchestrator.executeSaga(steps, {
        sagaName: 'test-saga',
      });

      expect(result.success).toBe(true);
      expect(result.completedSteps).toHaveLength(3);
      expect(executionOrder).toEqual(['step1', 'step2', 'step3']);
    });
  });

  describe('saga with failure and compensation', () => {
    it('should compensate completed steps when a step fails', async () => {
      const executionOrder: string[] = [];
      const compensationOrder: string[] = [];
      
      const steps: SagaStep[] = [
        {
          name: 'step1',
          action: async () => {
            executionOrder.push('step1');
            return 'result1';
          },
          compensate: async () => {
            compensationOrder.push('compensate-step1');
          },
        },
        {
          name: 'step2',
          action: async () => {
            executionOrder.push('step2');
            return 'result2';
          },
          compensate: async () => {
            compensationOrder.push('compensate-step2');
          },
        },
        {
          name: 'step3',
          action: async () => {
            executionOrder.push('step3');
            throw new Error('Step 3 failed');
          },
          compensate: async () => {
            compensationOrder.push('compensate-step3');
          },
        },
      ];

      const result = await orchestrator.executeSaga(steps, {
        sagaName: 'test-saga-with-failure',
      });

      expect(result.success).toBe(false);
      expect(result.completedSteps).toHaveLength(2);
      expect(result.failedStep?.stepName).toBe('step3');
      expect(result.error?.message).toContain('Step 3 failed');
      
      // Compensation should happen in reverse order
      expect(compensationOrder).toEqual(['compensate-step2', 'compensate-step1']);
      // Failed step should not be compensated
      expect(compensationOrder).not.toContain('compensate-step3');
    });

    it('should continue compensation even if one fails', async () => {
      const compensationOrder: string[] = [];
      
      const steps: SagaStep[] = [
        {
          name: 'step1',
          action: async () => 'result1',
          compensate: async () => {
            compensationOrder.push('compensate-step1');
          },
        },
        {
          name: 'step2',
          action: async () => 'result2',
          compensate: async () => {
            compensationOrder.push('compensate-step2');
            throw new Error('Compensation 2 failed');
          },
        },
        {
          name: 'step3',
          action: async () => {
            throw new Error('Step 3 failed');
          },
        },
      ];

      const result = await orchestrator.executeSaga(steps, {
        sagaName: 'test-saga-compensation-failure',
      });

      expect(result.success).toBe(false);
      // Both compensations should be attempted
      expect(compensationOrder).toEqual(['compensate-step2', 'compensate-step1']);
      expect(result.compensatedSteps).toContain('step1');
      // Step2 compensation failed, so it shouldn't be in compensatedSteps
      expect(result.compensatedSteps).not.toContain('step2');
    });
  });

  describe('retry logic', () => {
    it('should retry failed steps up to maxRetries', async () => {
      let attempts = 0;
      
      const steps: SagaStep[] = [
        {
          name: 'flaky-step',
          action: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error(`Attempt ${attempts} failed`);
            }
            return 'success';
          },
          retryable: true,
          maxRetries: 3,
        },
      ];

      const result = await orchestrator.executeSaga(steps, {
        sagaName: 'test-saga-retry',
      });

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
      expect(result.completedSteps[0].retries).toBe(2); // 0-based, so 2 retries
    });

    it('should fail after exhausting retries', async () => {
      let attempts = 0;
      
      const steps: SagaStep[] = [
        {
          name: 'always-fails',
          action: async () => {
            attempts++;
            throw new Error(`Attempt ${attempts} failed`);
          },
          retryable: true,
          maxRetries: 2,
        },
      ];

      const result = await orchestrator.executeSaga(steps, {
        sagaName: 'test-saga-retry-exhausted',
      });

      expect(result.success).toBe(false);
      expect(attempts).toBe(3); // Initial + 2 retries
      expect(result.failedStep?.retries).toBe(2);
    });
  });

  describe('chunking saga', () => {
    it('should create correct saga steps for chunking', () => {
      const mockDeps = {
        chunkSqlModel: {
          addChunksBulk: vi.fn(),
          listByObjectId: vi.fn(),
          deleteByIds: vi.fn(),
        },
        vectorStore: {
          addDocuments: vi.fn(),
          deleteDocumentsByIds: vi.fn(),
        },
        embeddingSqlModel: {
          addEmbeddingRecord: vi.fn(),
          deleteByChunkIds: vi.fn(),
        },
      };

      const chunks = [
        { objectId: 'obj1', content: 'chunk1' },
        { objectId: 'obj1', content: 'chunk2' },
      ];

      const steps = SagaOrchestrator.createChunkingSaga('obj1', chunks, mockDeps);

      expect(steps).toHaveLength(4);
      expect(steps[0].name).toBe('insert-chunks-to-sql');
      expect(steps[1].name).toBe('fetch-inserted-chunks');
      expect(steps[2].name).toBe('create-embeddings');
      expect(steps[3].name).toBe('link-embeddings');

      // All steps except fetch should have compensation
      expect(steps[0].compensate).toBeDefined();
      expect(steps[1].compensate).toBeUndefined();
      expect(steps[2].compensate).toBeDefined();
      expect(steps[3].compensate).toBeDefined();

      // Retryable steps
      expect(steps[0].retryable).toBe(true);
      expect(steps[2].retryable).toBe(true);
    });
  });
});