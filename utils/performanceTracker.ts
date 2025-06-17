import { logger } from './logger';

interface TimingEvent {
  timestamp: number;
  layer: string;
  event: string;
  metadata?: Record<string, any>;
}

interface StreamTimings {
  correlationId: string;
  events: TimingEvent[];
  startTime: number;
}

class PerformanceTracker {
  private activeStreams: Map<string, StreamTimings> = new Map();

  /**
   * Start tracking a new streaming session
   */
  startStream(correlationId: string, layer: string): void {
    const now = performance.now();
    this.activeStreams.set(correlationId, {
      correlationId,
      events: [{
        timestamp: now,
        layer,
        event: 'stream_start'
      }],
      startTime: now
    });
    
    logger.debug(`[PerformanceTracker] Started tracking stream ${correlationId} at ${layer}`);
  }

  /**
   * Record a timing event for a stream
   */
  recordEvent(correlationId: string, layer: string, event: string, metadata?: Record<string, any>): void {
    const stream = this.activeStreams.get(correlationId);
    if (!stream) {
      logger.warn(`[PerformanceTracker] No active stream found for ${correlationId}`);
      return;
    }

    const now = performance.now();
    stream.events.push({
      timestamp: now,
      layer,
      event,
      metadata
    });

    const elapsed = now - stream.startTime;
    logger.debug(`[PerformanceTracker] ${correlationId} - ${layer}:${event} at +${elapsed.toFixed(2)}ms`, metadata);
  }

  /**
   * Complete tracking for a stream and return timing analysis
   */
  completeStream(correlationId: string, layer: string): void {
    const stream = this.activeStreams.get(correlationId);
    if (!stream) {
      logger.warn(`[PerformanceTracker] No active stream found for ${correlationId}`);
      return;
    }

    const now = performance.now();
    stream.events.push({
      timestamp: now,
      layer,
      event: 'stream_complete'
    });

    // Analyze and log the complete timing data
    this.analyzeStream(stream);
    
    // Clean up
    this.activeStreams.delete(correlationId);
  }

  /**
   * Analyze and log timing data for a completed stream
   */
  private analyzeStream(stream: StreamTimings): void {
    const totalTime = stream.events[stream.events.length - 1].timestamp - stream.startTime;
    
    // Find key events
    const firstChunkEvent = stream.events.find(e => e.event === 'first_chunk_received');
    const timeToFirstChunk = firstChunkEvent ? firstChunkEvent.timestamp - stream.startTime : null;
    
    // Calculate inter-layer timings
    const layerTimings: Record<string, number> = {};
    let lastTimestamp = stream.startTime;
    
    for (const event of stream.events) {
      const elapsed = event.timestamp - lastTimestamp;
      const key = `${event.layer}:${event.event}`;
      layerTimings[key] = elapsed;
      lastTimestamp = event.timestamp;
    }

    logger.info(`[PerformanceTracker] Stream ${stream.correlationId} completed:`, {
      totalTime: `${totalTime.toFixed(2)}ms`,
      timeToFirstChunk: timeToFirstChunk ? `${timeToFirstChunk.toFixed(2)}ms` : 'N/A',
      eventCount: stream.events.length,
      layerTimings
    });

    // Log detailed timeline
    logger.debug(`[PerformanceTracker] Detailed timeline for ${stream.correlationId}:`);
    for (const event of stream.events) {
      const elapsed = event.timestamp - stream.startTime;
      logger.debug(`  +${elapsed.toFixed(2)}ms - ${event.layer}:${event.event}`, event.metadata);
    }
  }

  /**
   * Get current timing data for a stream (useful for debugging)
   */
  getStreamTimings(correlationId: string): StreamTimings | undefined {
    return this.activeStreams.get(correlationId);
  }

  /**
   * Clean up stale streams (call periodically)
   */
  cleanupStaleStreams(maxAgeMs: number = 300000): void { // Default 5 minutes
    const now = performance.now();
    for (const [id, stream] of this.activeStreams) {
      if (now - stream.startTime > maxAgeMs) {
        logger.warn(`[PerformanceTracker] Cleaning up stale stream ${id}`);
        this.activeStreams.delete(id);
      }
    }
  }

  /**
   * Track a non-streaming operation with timing
   */
  trackOperation(operationName: string, durationMs: number): void {
    logger.debug(`[PerformanceTracker] Operation ${operationName} completed in ${durationMs.toFixed(2)}ms`);
  }

  /**
   * Increment a counter for tracking operation metrics
   */
  incrementCounter(counterName: string, increment: number = 1): void {
    logger.debug(`[PerformanceTracker] Counter ${counterName} incremented by ${increment}`);
  }
}

// Export singleton instance
export const performanceTracker = new PerformanceTracker();

// Also export the class for testing
export { PerformanceTracker };