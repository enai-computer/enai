import { BaseModel } from './BaseModel';
import { logger } from '../utils/logger';
import { ObjectModelCore } from './ObjectModelCore';
import { 
  ObjectBioSchema, 
  ObjectRelationshipsSchema,
  BiographyEvent,
  Relationship,
  ObjectBio,
  ObjectRelationships,
  parseObjectBio,
  parseObjectRelationships,
  safeParseObjectBio,
  safeParseObjectRelationships,
  createDefaultObjectBio,
  createDefaultObjectRelationships
} from '../shared/schemas/objectSchemas';

/**
 * Handles cognitive features for objects: biography and relationships
 * Pure functions that validate and return JSON strings for storage
 */
export class ObjectCognitiveModel extends BaseModel {
  protected readonly modelName = 'ObjectCognitiveModel';
  private objectModelCore: ObjectModelCore;

  constructor(objectModelCore: ObjectModelCore) {
    super(objectModelCore.getDatabase());
    this.objectModelCore = objectModelCore;
  }

  /**
   * Initializes biography for a new object
   * @param createdAt - Creation timestamp
   * @returns JSON string of initialized biography
   */
  initializeBio(createdAt: Date = new Date()): string {
    const bio = createDefaultObjectBio(createdAt);
    return JSON.stringify(bio);
  }

  /**
   * Initializes relationships for a new object
   * @returns JSON string of initialized relationships
   */
  initializeRelationships(): string {
    const relationships = createDefaultObjectRelationships();
    return JSON.stringify(relationships);
  }

  /**
   * Adds a biography event to an object
   * @param id - The UUID of the object
   * @param event - The biography event to add
   * @returns Updated biography JSON string
   */
  async addBiographyEvent(id: string, event: BiographyEvent): Promise<string> {
    try {
      const obj = await this.objectModelCore.getById(id);
      if (!obj) {
        throw new Error(`Object ${id} not found`);
      }

      // Parse existing biography or create default
      const bio = obj.objectBio ? parseObjectBio(obj.objectBio) : createDefaultObjectBio(new Date(obj.createdAt));
      
      // Add the new event
      bio.events.push(event);
      
      // Validate the updated biography
      const validated = ObjectBioSchema.safeParse(bio);
      if (!validated.success) {
        throw new Error(`Invalid biography after update: ${validated.error.message}`);
      }
      
      logger.debug(`[ObjectCognitiveModel] Added biography event to object ${id}`);
      return JSON.stringify(bio);
    } catch (error) {
      this.handleDbError(error, `add biography event for ${id}`);
    }
  }

  /**
   * Adds or updates a relationship
   * @param id - The UUID of the object
   * @param newRel - The relationship to add/update
   * @returns Updated relationships JSON string
   */
  async addRelationship(id: string, newRel: Relationship): Promise<string> {
    try {
      const obj = await this.objectModelCore.getById(id);
      if (!obj) {
        throw new Error(`Object ${id} not found`);
      }

      // Parse existing relationships or create default
      const relationships = obj.objectRelationships ? 
        parseObjectRelationships(obj.objectRelationships) : 
        createDefaultObjectRelationships();
      
      // Check if relationship already exists to this target
      const existingIndex = relationships.related.findIndex(rel => rel.to === newRel.to);
      if (existingIndex >= 0) {
        // Update existing relationship
        relationships.related[existingIndex] = newRel;
        logger.debug(`[ObjectCognitiveModel] Updated existing relationship from ${id} to ${newRel.to}`);
      } else {
        // Add new relationship
        relationships.related.push(newRel);
        logger.debug(`[ObjectCognitiveModel] Added new relationship from ${id} to ${newRel.to}`);
      }
      
      // Validate the updated relationships
      const validated = ObjectRelationshipsSchema.safeParse(relationships);
      if (!validated.success) {
        throw new Error(`Invalid relationships after update: ${validated.error.message}`);
      }
      
      return JSON.stringify(relationships);
    } catch (error) {
      this.handleDbError(error, `add relationship for ${id}`);
    }
  }

  /**
   * Removes a relationship
   * @param id - The UUID of the object
   * @param targetId - The ID of the target to remove the relationship to
   * @returns Updated relationships JSON string
   */
  async removeRelationship(id: string, targetId: string): Promise<string> {
    try {
      const obj = await this.objectModelCore.getById(id);
      if (!obj) {
        throw new Error(`Object ${id} not found`);
      }

      // Parse existing relationships
      const relationships = obj.objectRelationships ? 
        parseObjectRelationships(obj.objectRelationships) : 
        createDefaultObjectRelationships();
      
      // Remove the relationship
      const originalLength = relationships.related.length;
      relationships.related = relationships.related.filter(rel => rel.to !== targetId);
      
      if (relationships.related.length === originalLength) {
        logger.warn(`[ObjectCognitiveModel] No relationship found from ${id} to ${targetId} to remove`);
      } else {
        logger.debug(`[ObjectCognitiveModel] Removed relationship from ${id} to ${targetId}`);
      }
      
      return JSON.stringify(relationships);
    } catch (error) {
      this.handleDbError(error, `remove relationship for ${id}`);
    }
  }

  /**
   * Parses object biography with safe fallback
   * @param objectBio - JSON string of object biography
   * @param objectId - Object ID for logging context
   * @returns Parsed ObjectBio or null if parsing fails
   */
  parseObjectBioSafely(objectBio: string | undefined, objectId: string): ObjectBio | null {
    if (!objectBio) return null;
    
    const parsed = safeParseObjectBio(objectBio);
    if (!parsed) {
      logger.warn(`[ObjectCognitiveModel] Failed to parse objectBio for object ${objectId}`);
    }
    return parsed;
  }

  /**
   * Parses object relationships with safe fallback
   * @param objectRelationships - JSON string of object relationships
   * @param objectId - Object ID for logging context
   * @returns Parsed ObjectRelationships or null if parsing fails
   */
  parseObjectRelationshipsSafely(objectRelationships: string | undefined, objectId: string): ObjectRelationships | null {
    if (!objectRelationships) return null;
    
    const parsed = safeParseObjectRelationships(objectRelationships);
    if (!parsed) {
      logger.warn(`[ObjectCognitiveModel] Failed to parse objectRelationships for object ${objectId}`);
    }
    return parsed;
  }

  /**
   * Creates a notebook membership event for biography
   * @param notebookId - The UUID of the notebook
   * @param action - 'added' or 'removed'
   * @returns BiographyEvent
   */
  createNotebookEvent(notebookId: string, action: 'added' | 'removed'): BiographyEvent {
    return {
      when: new Date().toISOString(),
      what: action === 'added' ? 'added-to-notebook' : 'removed-from-notebook',
      withWhom: [notebookId],
      resulted: `${action === 'added' ? 'Added to' : 'Removed from'} notebook ${notebookId}`
    };
  }

  /**
   * Creates a notebook membership relationship
   * @param notebookId - The UUID of the notebook
   * @param topicAffinity - Optional topic affinity score (0-1)
   * @returns Relationship
   */
  createNotebookRelationship(notebookId: string, topicAffinity: number = 1.0): Relationship {
    return {
      to: notebookId,
      nature: 'notebook-membership',
      strength: 1.0,
      formed: new Date().toISOString(),
      topicAffinity
    };
  }
}