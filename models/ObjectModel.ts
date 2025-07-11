/**
 * @deprecated ObjectModel has been refactored into three specialized models:
 * - ObjectModelCore: Handles all database CRUD operations
 * - ObjectCognitiveModel: Manages biography and relationships
 * - ObjectAssociationModel: Manages notebook-object associations
 * 
 * Please update your code to use the appropriate specialized model directly.
 * 
 * Migration complete as of: 2025-07-11
 */

import { logger } from '../utils/logger';

// Re-export types from the new location
export { SourceMetadata } from './ObjectModelCore';

// Throw error if anyone tries to instantiate the old ObjectModel
export class ObjectModel {
  constructor() {
    const errorMessage = [
      'ObjectModel has been deprecated and split into three models:',
      '- Use ObjectModelCore for database operations',
      '- Use ObjectCognitiveModel for biography/relationships',
      '- Use ObjectAssociationModel for notebook associations',
      '',
      'Please update your code to use the appropriate model.'
    ].join('\n');
    
    logger.error('[ObjectModel] ' + errorMessage);
    throw new Error(errorMessage);
  }
}