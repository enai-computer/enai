import { EventEmitter } from 'events';
import { BaseService } from '../base/BaseService';
import { BrowserEventName, BrowserEventData, BrowserEventMap } from './browserEvents.types';

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
   * Emit an event with type-safe data
   */
  emit<T extends BrowserEventName>(event: T, data: BrowserEventData<T>): boolean {
    this.logDebug(`Emitting event: ${event}`, { data });
    return this.emitter.emit(event, data);
  }

  /**
   * Subscribe to an event with type-safe handler
   */
  on<T extends BrowserEventName>(event: T, handler: (data: BrowserEventData<T>) => void): void {
    this.logDebug(`Adding listener for event: ${event}`);
    this.emitter.on(event, handler);
  }

  /**
   * Subscribe to an event once with type-safe handler
   */
  once<T extends BrowserEventName>(event: T, handler: (data: BrowserEventData<T>) => void): void {
    this.logDebug(`Adding one-time listener for event: ${event}`);
    this.emitter.once(event, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off<T extends BrowserEventName>(event: T, handler: (data: BrowserEventData<T>) => void): void {
    this.logDebug(`Removing listener for event: ${event}`);
    this.emitter.off(event, handler);
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<T extends BrowserEventName>(event?: T): void {
    this.logDebug(`Removing all listeners${event ? ` for event: ${event}` : ''}`);
    this.emitter.removeAllListeners(event);
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount<T extends BrowserEventName>(event: T): number {
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