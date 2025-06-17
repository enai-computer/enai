import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a single step in a saga with its action and compensating action
 */
export interface SagaStep<T = any> {
  name: string;
  action: () => Promise<T>;
  compensate?: (result: T) => Promise<void>;
  retryable?: boolean;
  maxRetries?: number;
}

/**
 * Result of executing a saga step
 */
interface StepResult<T = any> {
  stepName: string;
  success: boolean;
  result?: T;
  error?: Error;
  retries?: number;
}

/**
 * Result of executing a complete saga
 */
export interface SagaResult {
  sagaId: string;
  success: boolean;
  completedSteps: StepResult[];
  failedStep?: StepResult;
  compensatedSteps?: string[];
  error?: Error;
}

/**
 * Options for saga execution
 */
export interface SagaOptions {
  sagaName: string;
  isolationLevel?: 'read-committed' | 'serializable';
  compensationStrategy?: 'all' | 'failed-only';
  logProgress?: boolean;
}

/**
 * Orchestrates multi-step operations with automatic compensation on failure.
 * Implements the Saga pattern for distributed transactions.
 */
export class SagaOrchestrator {
  private readonly logger = logger;

  /**
   * Execute a saga - a series of steps with compensating actions
   * @param steps The steps to execute in order
   * @param options Configuration options for the saga
   * @returns The result of the saga execution
   */
  async executeSaga(
    steps: SagaStep[],
    options: SagaOptions
  ): Promise<SagaResult> {
    const sagaId = uuidv4();
    const completedSteps: StepResult[] = [];
    let failedStep: StepResult | undefined;

    this.logger.info(`[SagaOrchestrator] Starting saga: ${options.sagaName} (ID: ${sagaId})`);

    try {
      // Execute each step in order
      for (const step of steps) {
        const stepResult = await this.executeStep(step, sagaId, options);
        
        if (stepResult.success) {
          completedSteps.push(stepResult);
          if (options.logProgress) {
            this.logger.debug(`[SagaOrchestrator] Step completed: ${step.name}`);
          }
        } else {
          failedStep = stepResult;
          throw stepResult.error || new Error(`Step ${step.name} failed`);
        }
      }

      // All steps completed successfully
      this.logger.info(`[SagaOrchestrator] Saga completed successfully: ${options.sagaName} (ID: ${sagaId})`);
      
      return {
        sagaId,
        success: true,
        completedSteps,
      };

    } catch (error) {
      // A step failed, initiate compensation
      this.logger.error(`[SagaOrchestrator] Saga failed: ${options.sagaName} (ID: ${sagaId})`, error);
      
      const compensatedSteps = await this.compensate(
        completedSteps,
        steps,
        options
      );

      return {
        sagaId,
        success: false,
        completedSteps,
        failedStep,
        compensatedSteps,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep(
    step: SagaStep,
    sagaId: string,
    options: SagaOptions
  ): Promise<StepResult> {
    const maxRetries = step.retryable ? (step.maxRetries || 3) : 0;
    let lastError: Error | undefined;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.debug(`[SagaOrchestrator] Retrying step ${step.name} (attempt ${attempt + 1}/${maxRetries + 1})`);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }

        const result = await step.action();
        
        return {
          stepName: step.name,
          success: true,
          result,
          retries: attempt,
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries = attempt;
        
        if (attempt === maxRetries) {
          break;
        }
      }
    }

    // Step failed after all retries
    return {
      stepName: step.name,
      success: false,
      error: lastError,
      retries,
    };
  }

  /**
   * Compensate completed steps in reverse order
   */
  private async compensate(
    completedSteps: StepResult[],
    allSteps: SagaStep[],
    options: SagaOptions
  ): Promise<string[]> {
    const compensatedSteps: string[] = [];
    
    // Create a map for quick lookup
    const stepMap = new Map(allSteps.map(s => [s.name, s]));
    
    // Compensate in reverse order
    const stepsToCompensate = [...completedSteps].reverse();
    
    for (const completedStep of stepsToCompensate) {
      const step = stepMap.get(completedStep.stepName);
      
      if (!step?.compensate) {
        this.logger.debug(`[SagaOrchestrator] No compensation defined for step: ${completedStep.stepName}`);
        continue;
      }

      try {
        this.logger.info(`[SagaOrchestrator] Compensating step: ${completedStep.stepName}`);
        await step.compensate(completedStep.result);
        compensatedSteps.push(completedStep.stepName);
        
      } catch (error) {
        this.logger.error(`[SagaOrchestrator] Failed to compensate step ${completedStep.stepName}:`, error);
        // Continue compensating other steps even if one fails
      }
    }

    return compensatedSteps;
  }

  /**
   * Create a saga for chunking operations that involve both database and vector store
   */
  static createChunkingSaga(
    objectId: string,
    chunks: any[],
    deps: {
      chunkSqlModel: any;
      vectorStore: any;
      embeddingSqlModel: any;
    }
  ): SagaStep[] {
    let insertedChunkIds: number[] = [];
    let vectorIds: string[] = [];

    return [
      {
        name: 'insert-chunks-to-sql',
        action: async () => {
          // This step uses the existing bulk insert with transaction
          insertedChunkIds = await deps.chunkSqlModel.addChunksBulk(chunks);
          return insertedChunkIds;
        },
        compensate: async () => {
          // Delete the inserted chunks
          if (insertedChunkIds.length > 0) {
            await deps.chunkSqlModel.deleteByIds(insertedChunkIds);
          }
        },
        retryable: true,
        maxRetries: 2,
      },
      {
        name: 'fetch-inserted-chunks',
        action: async () => {
          const storedChunks = await deps.chunkSqlModel.listByObjectId(objectId);
          if (storedChunks.length === 0) {
            throw new Error('No chunks found after insertion');
          }
          return storedChunks;
        },
        // No compensation needed - read-only operation
      },
      {
        name: 'create-embeddings',
        action: async () => {
          // Prepare documents from stored chunks
          const storedChunks = await deps.chunkSqlModel.listByObjectId(objectId);
          const documents = storedChunks.map(chunk => ({
            pageContent: chunk.content,
            metadata: {
              sqlChunkId: chunk.id,
              objectId: chunk.objectId,
              chunkIdx: chunk.chunkIdx,
              // ... other metadata
            }
          }));
          
          vectorIds = await deps.vectorStore.addDocuments(documents);
          return vectorIds;
        },
        compensate: async (ids: string[]) => {
          // Delete embeddings from vector store
          if (ids && ids.length > 0) {
            try {
              await deps.vectorStore.deleteDocumentsByIds(ids);
            } catch (error) {
              logger.error('[SagaOrchestrator] Failed to delete embeddings:', error);
              // Vector store cleanup is best-effort
            }
          }
        },
        retryable: true,
        maxRetries: 3,
      },
      {
        name: 'link-embeddings',
        action: async () => {
          const storedChunks = await deps.chunkSqlModel.listByObjectId(objectId);
          
          if (vectorIds.length !== storedChunks.length) {
            throw new Error(`Vector ID count mismatch: ${vectorIds.length} vs ${storedChunks.length} chunks`);
          }

          // Create embedding links
          const links = [];
          for (let i = 0; i < storedChunks.length; i++) {
            const link = {
              chunkId: storedChunks[i].id,
              vectorId: vectorIds[i],
              model: 'text-embedding-3-small',
            };
            deps.embeddingSqlModel.addEmbeddingRecord(link);
            links.push(link);
          }
          
          return links;
        },
        compensate: async () => {
          // Delete embedding links
          if (insertedChunkIds.length > 0) {
            await deps.embeddingSqlModel.deleteByChunkIds(insertedChunkIds);
          }
        },
      },
    ];
  }
}