import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { JeffersObject, ObjectStatus, MediaType } from '../../../shared/types';
import { BiographyEvent, Relationship } from '../../../shared/schemas/objectSchemas';
import { ObjectModelCore } from '../../ObjectModelCore';
import { ObjectCognitiveModel } from '../../ObjectCognitiveModel';

/**
 * Test data factory functions for consistent test data creation
 */

export function createTestObject(
  overrides: Partial<Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>> = {}
): Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    objectType: 'webpage' as MediaType,
    sourceUri: `https://example.com/test-${uuidv4()}`,
    title: 'Test Object',
    status: 'new' as ObjectStatus,
    rawContentRef: null,
    parsedContentJson: null,
    cleanedText: null,
    errorInfo: null,
    parsedAt: undefined,
    fileHash: null,
    originalFileName: null,
    fileSizeBytes: null,
    fileMimeType: null,
    internalFilePath: null,
    aiGeneratedMetadata: null,
    summary: null,
    propositionsJson: null,
    tagsJson: null,
    summaryGeneratedAt: null,
    lastAccessedAt: undefined,
    childObjectIds: undefined,
    objectBio: undefined,
    objectRelationships: undefined,
    ...overrides
  };
}

export function createTestBioEvent(
  overrides: Partial<BiographyEvent> = {}
): BiographyEvent {
  return {
    when: new Date().toISOString(),
    what: 'test-event',
    withWhom: [],
    resulted: undefined,
    significance: undefined,
    ...overrides
  };
}

export function createTestRelationship(
  targetId: string,
  overrides: Partial<Relationship> = {}
): Relationship {
  return {
    to: targetId,
    nature: 'test-relationship',
    strength: 0.5,
    formed: new Date().toISOString(),
    topicAffinity: undefined,
    lastInteraction: undefined,
    ...overrides
  };
}

export function createTestNotebookRelationship(
  notebookId: string,
  affinity: number = 1.0
): Relationship {
  return {
    to: notebookId,
    nature: 'notebook-membership',
    strength: 1.0,
    formed: new Date().toISOString(),
    topicAffinity: affinity
  };
}

export function createTestNotebookEvent(
  notebookId: string,
  action: 'added-to-notebook' | 'removed-from-notebook'
): BiographyEvent {
  return {
    when: new Date().toISOString(),
    what: action,
    withWhom: [notebookId],
    resulted: action === 'added-to-notebook' 
      ? `Added to notebook ${notebookId}`
      : `Removed from notebook ${notebookId}`
  };
}

/**
 * Creates a test object using the Core model directly
 */
export async function createTestObjectWithCore(
  core: ObjectModelCore,
  overrides: Partial<Omit<JeffersObject, 'id' | 'createdAt' | 'updatedAt'>> = {}
): Promise<JeffersObject> {
  const cognitive = new ObjectCognitiveModel(core);
  const data = createTestObject(overrides);
  
  // Initialize cognitive fields if not provided
  if (!data.objectBio) {
    data.objectBio = cognitive.initializeBio();
  }
  if (!data.objectRelationships) {
    data.objectRelationships = cognitive.initializeRelationships();
  }
  
  return core.create(data);
}

/**
 * Creates a test notebook entry for junction table testing
 */
export function createTestNotebook(
  db: Database.Database,
  notebookId: string = `notebook-${uuidv4()}`,
  title: string = 'Test Notebook'
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO notebooks (id, title, object_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(notebookId, title, null, now, now);
}