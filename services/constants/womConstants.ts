import { logger } from '../../utils/logger';

// Define the base constants
const baseConstants = {
  // Time decay
  DECAY_RATE: 0.1, // Exponential decay per week
  DECAY_MIN_SCORE: 0.1, // Score floor (10%)
  WOM_RECENCY_BOOST_FACTOR: 0.2, // LOM+WOM merge factor

  // Debouncing
  INGESTION_DEBOUNCE_MS: 1000,
  ENRICHMENT_DEBOUNCE_MS: 5000,
  REFRESH_CHECK_INTERVAL_MS: 86400000, // 24 hours - balance between freshness and API costs

  // Composite enrichment
  MIN_CHILDREN_FOR_AUTO_ENRICH: 3,
  MAX_CHILDREN_FOR_SYNC_ENRICH: 10,

  // Retention
  WOM_RETENTION_DAYS: 30,
  STALE_TAB_WARNING_DAYS: 7,

  // Helpers
  WEEK_MS: 1000 * 60 * 60 * 24 * 7,
} as const;

// Create a mutable configuration object
export const WOM_CONSTANTS = { ...baseConstants };

// Safely apply environment variable overrides with validation
Object.keys(baseConstants).forEach(key => {
  const envKey = `WOM_${key}`;
  const envValue = process.env[envKey];
  
  if (envValue) {
    const parsedValue = parseFloat(envValue);
    
    // Only apply the override if it's a valid number
    if (!isNaN(parsedValue)) {
      (WOM_CONSTANTS as any)[key] = parsedValue;
      logger.info(`[WOM_CONSTANTS] Applied override for ${key}: ${parsedValue}`);
    } else {
      logger.warn(`[WOM_CONSTANTS] Invalid value for ${envKey}: ${envValue} (expected number)`);
    }
  }
});