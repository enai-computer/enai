import { EventEmitter } from 'events';
import { BaseService } from '../base/BaseService';

/**
 * BrowserEventBus - Centralized event bus for browser services
 * 
 * This service encapsulates the EventEmitter to provide a type-safe,
 * testable event bus for communication between browser services.
 */
export class BrowserEventBus extends BaseService<{}> {
  private emitter = new EventEmitter();

  constructor() {
    super('BrowserEventBus', {});
  }

  /**
   * Emit an event with optional arguments
   */
  emit(event: string, ...args: any[]): boolean {
    this.logDebug(`Emitting event: ${event}`, { args });
    return this.emitter.emit(event, ...args);
  }

  /**
   * Subscribe to an event
   */
  on(event: string, handler: (...args: any[]) => void): void {
    this.logDebug(`Adding listener for event: ${event}`);
    this.emitter.on(event, handler);
  }

  /**
   * Subscribe to an event once
   */
  once(event: string, handler: (...args: any[]) => void): void {
    this.logDebug(`Adding one-time listener for event: ${event}`);
    this.emitter.once(event, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, handler: (...args: any[]) => void): void {
    this.logDebug(`Removing listener for event: ${event}`);
    this.emitter.off(event, handler);
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: string): void {
    this.logDebug(`Removing all listeners${event ? ` for event: ${event}` : ''}`);
    this.emitter.removeAllListeners(event);
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.logInfo('Cleaning up event bus');
    this.emitter.removeAllListeners();
    await super.cleanup();
  }
}