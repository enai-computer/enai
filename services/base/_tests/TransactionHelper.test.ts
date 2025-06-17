import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TransactionHelper } from '../TransactionHelper';
import { logger } from '../../../utils/logger';
import { performanceTracker } from '../../../utils/performanceTracker';

// Mock dependencies
vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../../utils/performanceTracker', () => ({
  performanceTracker: {
    trackOperation: vi.fn(),
    incrementCounter: vi.fn(),
  },
}));

describe('TransactionHelper', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        value TEXT,
        external_id TEXT
      )
    `);
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  describe('executeWithExternal', () => {
    it('should successfully execute all three phases', async () => {
      const result = await TransactionHelper.executeWithExternal(
        db,
        // SQL phase
        () => {
          const stmt = db.prepare('INSERT INTO test_table (value) VALUES (?)');
          const info = stmt.run('test-value');
          return { id: info.lastInsertRowid as number };
        },
        // External phase
        async (sqlResult) => {
          return { externalId: `external-${sqlResult.id}` };
        },
        // Finalize phase
        (sqlResult, externalResult) => {
          const stmt = db.prepare('UPDATE test_table SET external_id = ? WHERE id = ?');
          stmt.run(externalResult.externalId, sqlResult.id);
          return { id: sqlResult.id, externalId: externalResult.externalId };
        },
        {
          name: 'test-operation',
          serviceName: 'TestService',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1, externalId: 'external-1' });
      expect(result.duration).toBeGreaterThanOrEqual(0);
      
      // Verify database state
      const row = db.prepare('SELECT * FROM test_table WHERE id = 1').get() as any;
      expect(row.value).toBe('test-value');
      expect(row.external_id).toBe('external-1');
      
      // Verify metrics were tracked
      expect(performanceTracker.trackOperation).toHaveBeenCalledWith('test-operation_sql', expect.any(Number));
      expect(performanceTracker.trackOperation).toHaveBeenCalledWith('test-operation_external', expect.any(Number));
      expect(performanceTracker.trackOperation).toHaveBeenCalledWith('test-operation_finalize', expect.any(Number));
      expect(performanceTracker.incrementCounter).toHaveBeenCalledWith('test-operation_success');
    });

    it('should rollback SQL changes when external operation fails', async () => {
      const result = await TransactionHelper.executeWithExternal(
        db,
        () => {
          const stmt = db.prepare('INSERT INTO test_table (value) VALUES (?)');
          const info = stmt.run('should-rollback');
          return { id: info.lastInsertRowid as number };
        },
        async () => {
          throw new Error('External service error');
        },
        () => {
          throw new Error('Should not reach finalize');
        },
        {
          name: 'failing-operation',
          cleanup: async (sqlResult) => {
            // Cleanup should receive the SQL result
            const stmt = db.prepare('DELETE FROM test_table WHERE id = ?');
            stmt.run((sqlResult as any).id);
          },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('External service error');
      expect(result.rollbackPerformed).toBe(true);
      
      // Verify row was cleaned up
      const count = db.prepare('SELECT COUNT(*) as count FROM test_table').get() as any;
      expect(count.count).toBe(0);
    });

    it('should retry external operation on failure', async () => {
      let attemptCount = 0;
      
      const result = await TransactionHelper.executeWithExternal(
        db,
        () => ({ id: 1 }),
        async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Temporary failure');
          }
          return { success: true };
        },
        (sqlResult, externalResult) => ({ ...sqlResult, ...externalResult }),
        {
          name: 'retry-operation',
          retryable: true,
          maxRetries: 3,
        }
      );

      expect(result.success).toBe(true);
      expect(attemptCount).toBe(3);
      expect(result.retryCount).toBe(2); // 0-indexed
    });

    it('should respect circuit breaker when configured', async () => {
      const config = {
        name: 'circuit-breaker-test',
        serviceName: 'TestService',
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 100,
          halfOpenMaxAttempts: 1,
        },
      };

      // Fail twice to open circuit
      for (let i = 0; i < 2; i++) {
        await TransactionHelper.executeWithExternal(
          db,
          () => ({ id: i }),
          async () => {
            throw new Error('Service unavailable');
          },
          () => ({ done: true }),
          config
        );
      }

      // Third attempt should fail immediately
      const result = await TransactionHelper.executeWithExternal(
        db,
        () => ({ id: 3 }),
        async () => ({ success: true }),
        () => ({ done: true }),
        config
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Circuit breaker is OPEN');
      
      // Verify circuit breaker state
      const state = TransactionHelper.getCircuitBreakerState('circuit-breaker-test');
      expect(state).toBe('OPEN');
      
      // Reset for cleanup
      TransactionHelper.resetCircuitBreaker('circuit-breaker-test');
    });

    it('should enforce concurrency limits', async () => {
      let activeCount = 0;
      let maxActiveCount = 0;
      
      const operations = Array.from({ length: 5 }, (_, i) => 
        TransactionHelper.executeWithExternal(
          db,
          () => ({ id: i }),
          async () => {
            activeCount++;
            maxActiveCount = Math.max(maxActiveCount, activeCount);
            await new Promise(resolve => setTimeout(resolve, 50));
            activeCount--;
            return { result: i };
          },
          (sql, ext) => ({ ...sql, ...ext }),
          {
            name: 'concurrent-test',
            maxConcurrent: 2,
          }
        )
      );

      await Promise.all(operations);
      
      // Should never exceed max concurrent
      expect(maxActiveCount).toBeLessThanOrEqual(2);
    });

    it('should handle finalization failures with external cleanup', async () => {
      let externalResourceCreated = false;
      let cleanupCalled = false;

      const result = await TransactionHelper.executeWithExternal(
        db,
        () => ({ id: 1 }),
        async () => {
          externalResourceCreated = true;
          return { resourceId: 'ext-123' };
        },
        () => {
          throw new Error('Finalization failed');
        },
        {
          name: 'finalize-failure',
          cleanup: async (data) => {
            cleanupCalled = true;
            // Verify we get the external result for cleanup
            expect(data).toEqual({ resourceId: 'ext-123' });
          },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Finalization failed');
      expect(externalResourceCreated).toBe(true);
      expect(cleanupCalled).toBe(true);
    });

    it('should track performance metrics accurately', async () => {
      vi.clearAllMocks();
      
      await TransactionHelper.executeWithExternal(
        db,
        () => {
          // Simulate some work
          const stmt = db.prepare('SELECT 1 + 1');
          stmt.get();
          return { phase: 'sql' };
        },
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { phase: 'external' };
        },
        () => {
          return { phase: 'finalize' };
        },
        {
          name: 'metrics-test',
          serviceName: 'MetricsService',
        }
      );

      // Verify all phases were tracked
      expect(performanceTracker.trackOperation).toHaveBeenCalledTimes(3);
      expect(performanceTracker.trackOperation).toHaveBeenCalledWith(
        'metrics-test_sql',
        expect.any(Number)
      );
      expect(performanceTracker.trackOperation).toHaveBeenCalledWith(
        'metrics-test_external',
        expect.any(Number)
      );
      expect(performanceTracker.trackOperation).toHaveBeenCalledWith(
        'metrics-test_finalize',
        expect.any(Number)
      );
      
      // Verify success counter
      expect(performanceTracker.incrementCounter).toHaveBeenCalledWith('metrics-test_success');
      expect(performanceTracker.incrementCounter).toHaveBeenCalledWith('metrics-test_external_success');
    });

    it('should handle SQL transaction failures gracefully', async () => {
      const result = await TransactionHelper.executeWithExternal(
        db,
        () => {
          throw new Error('SQL constraint violation');
        },
        async () => ({ should: 'not-reach' }),
        () => ({ should: 'not-reach' }),
        {
          name: 'sql-failure',
          serviceName: 'TestService',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('SQL constraint violation');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      
      // Verify failure was tracked
      expect(performanceTracker.incrementCounter).toHaveBeenCalledWith('sql-failure_sql_failures');
      
      // Verify external operation was not called
      expect(performanceTracker.trackOperation).not.toHaveBeenCalledWith(
        'sql-failure_external',
        expect.any(Number)
      );
    });
  });

  describe('transaction', () => {
    it('should execute simple SQL transactions', () => {
      const result = TransactionHelper.transaction(db, () => {
        const stmt1 = db.prepare('INSERT INTO test_table (value) VALUES (?)');
        const info1 = stmt1.run('first');
        
        const stmt2 = db.prepare('INSERT INTO test_table (value) VALUES (?)');
        const info2 = stmt2.run('second');
        
        return {
          firstId: info1.lastInsertRowid,
          secondId: info2.lastInsertRowid,
        };
      });

      expect(result.firstId).toBe(1);
      expect(result.secondId).toBe(2);
      
      // Verify both inserts succeeded
      const count = db.prepare('SELECT COUNT(*) as count FROM test_table').get() as any;
      expect(count.count).toBe(2);
    });

    it('should rollback on transaction failure', () => {
      expect(() => {
        TransactionHelper.transaction(db, () => {
          const stmt = db.prepare('INSERT INTO test_table (value) VALUES (?)');
          stmt.run('should-rollback');
          
          // Force an error
          throw new Error('Transaction error');
        });
      }).toThrow('Transaction error');
      
      // Verify rollback occurred
      const count = db.prepare('SELECT COUNT(*) as count FROM test_table').get() as any;
      expect(count.count).toBe(0);
    });
  });
});