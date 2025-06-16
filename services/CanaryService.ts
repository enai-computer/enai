import { BaseService } from './base/BaseService';

/**
 * Simple test service to validate the base infrastructure.
 * This service has no dependencies and just logs lifecycle events.
 * It can be safely removed once the infrastructure is validated.
 */
export class CanaryService extends BaseService<{}> {
  private initializeTime?: number;
  
  constructor() {
    super('CanaryService', {});
  }

  async initialize(): Promise<void> {
    this.logInfo('Initializing CanaryService...');
    
    // Simulate some initialization work
    await new Promise(resolve => setTimeout(resolve, 100));
    
    this.initializeTime = Date.now();
    this.logInfo('CanaryService initialized successfully!');
  }

  async cleanup(): Promise<void> {
    this.logInfo('Cleaning up CanaryService...');
    
    if (this.initializeTime) {
      const uptime = Date.now() - this.initializeTime;
      this.logInfo(`CanaryService was alive for ${uptime}ms`);
    }
    
    // Simulate some cleanup work
    await new Promise(resolve => setTimeout(resolve, 50));
    
    this.logInfo('CanaryService cleanup complete!');
  }

  async healthCheck(): Promise<boolean> {
    this.logDebug('CanaryService health check');
    
    // Simple health check - just verify we were initialized
    const isHealthy = this.initializeTime !== undefined;
    
    if (!isHealthy) {
      this.logWarn('CanaryService is not healthy - not initialized');
    }
    
    return isHealthy;
  }

  /**
   * Test method to verify the execute wrapper works correctly
   */
  async testExecute(): Promise<string> {
    return this.execute('testOperation', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'Canary test successful!';
    }, { testParam: 'value' });
  }

  /**
   * Test method that throws an error to verify error handling
   */
  async testError(): Promise<void> {
    return this.execute('testError', async () => {
      throw new Error('Intentional test error from CanaryService');
    });
  }
}