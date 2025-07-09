# Cognitive Objects Migration Guide

## Overview

This guide documents the migration to implement the full Cognitive Objects model as outlined in [issue #81](https://github.com/curranmichael/jeffers/issues/81). This migration represents a fundamental shift in how Jeffers manages information - from static content storage to dynamic, intelligent objects that learn and evolve through use.

### What Are Cognitive Objects?

Cognitive Objects are first-class entities in the Jeffers system that:
- **Have Memory**: Track their own history and interactions through an `objectBio` field
- **Form Relationships**: Maintain dynamic connections with other objects via `objectRelationships`
- **Learn and Evolve**: Accumulate biographical information from user interactions
- **Support Operations**: Can be viewed, composed, transformed, and related to other objects

### Why This Migration?

The current implementation provides a foundation with:
- Basic object storage and typing
- Tab groups as composite objects
- Temporal tracking via `last_accessed_at`
- Vector embeddings for search

However, it lacks the dynamic, intelligent aspects envisioned:
- Objects don't track their own history
- Relationships are limited to parent-child (tab groups)
- No biographical accumulation from interactions
- No automatic organization or evolution

This migration adds:
1. **Object Biography (`objectBio`)**: A JSON field tracking an object's lifecycle, interactions, and evolution
2. **Object Relationships (`objectRelationships`)**: A JSON field defining rich connections between objects beyond simple parent-child

## Database Schema Changes

### New Columns for Objects Table

```sql
-- Migration 0004_cognitive_objects.sql

-- Add cognitive fields to objects table
ALTER TABLE objects ADD COLUMN object_bio TEXT;
ALTER TABLE objects ADD COLUMN object_relationships TEXT;

-- Create junction table for notebook-object associations
CREATE TABLE notebook_objects (
  notebook_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notebook_id, object_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
);
CREATE INDEX idx_notebook_objects_object ON notebook_objects(object_id);

-- Set default values for existing records
UPDATE objects SET object_bio = '{"created_at": "' || created_at || '", "events": []}' WHERE object_bio IS NULL;
UPDATE objects SET object_relationships = '{"related": []}' WHERE object_relationships IS NULL;
```

**Note**: The junction table handles notebook associations, avoiding both circular dependencies and JSON parsing performance issues.

### Object Biography

The `objectBio` field stores a JSON object tracking the object's lifecycle, interactions, and evolution. This could include creation context, interaction events, usage statistics, and AI-derived insights.

**Key Distinction**: Biography tracks temporal events (WHAT happened WHEN), while relationships define connections (WHO relates to WHO). For example:
- Adding an object to a notebook is stored in `objectRelationships` (it's a connection that exists)
- Viewing an object for 30 seconds is stored in `objectBio` (it's an event that occurred)

This separation optimizes queries - relationship queries (e.g., "find all objects in notebook X") are frequent and need to be fast, while biography queries (e.g., "show usage timeline") are less frequent and can tolerate more processing.

**Building on Existing Infrastructure**: The implementation leverages existing types and patterns:
- Extends the existing `JeffersObject` interface in `/shared/types/object.types.ts` with two new optional fields
- Creates new Zod schemas in `/shared/schemas/objectSchemas.ts` following established patterns
- Reuses `ObjectPropositions` type and schema from `/shared/schemas/aiSchemas.ts`
- Be careful not to introduce redundant type definitions or patterns

**Validation**: We'll use Zod schemas (following the same pattern as `aiSchemas.ts`) to validate the structure of `objectBio` JSON before storage, ensuring type safety and data integrity.

### Object Relationships  

The `objectRelationships` field stores a JSON object defining connections between objects. This enables rich relationship graphs beyond simple parent-child hierarchies.

**Validation**: Like `objectBio`, we'll use Zod schemas to validate `objectRelationships` JSON, providing runtime type checking and clear error messages for malformed data.
The objectRelationships field should handle different kinds of relationships:
  - Cross-references between objects
  - Semantic similarities
  - Citations and sources
  - Loose associations

While child_object_ids continues to handle:
  - Tab group membership (tab group → webpage relationships)
  - Other composite objects where all parts form a whole


## Implementation Plan

### Current State Analysis

**What's Already Working:**
- Objects table has `childObjectIds` for parent-child relationships
- Tab groups exist as objects (mediaType: 'tab_group')
- WOM tracks browser tabs and creates webpage objects
- Composite enrichment synthesizes tab group metadata

**Key Gaps:**
1. Tab groups aren't associated with notebooks
2. Browser state tracks tabs by ephemeral IDs, not object UUIDs
3. No biography/relationship tracking within objects

### Proposed Approach

#### 1. Minimal Schema Changes
```sql
-- Add to objects table (no foreign keys to avoid circular dependencies)
ALTER TABLE objects ADD COLUMN object_bio TEXT; -- JSON biography
ALTER TABLE objects ADD COLUMN object_relationships TEXT; -- JSON relationships including notebook associations
```

**Note**: We do NOT add a `notebook_id` column to avoid circular foreign key dependencies (notebooks already reference objects).

#### 2. Reuse Existing Patterns
- Keep `childObjectIds` for tab group → webpage relationships (this is the right pattern for parent-child)
- Store notebook associations in `object_relationships` JSON (to avoid foreign key issues)
- Browser windows continue using ephemeral tab IDs internally, but map to object UUIDs

#### 3. Hybrid Approach: Junction Table + Cognitive Fields
After careful consideration, we will implement a hybrid approach that uses the right tool for each job:

**Junction Table for Notebook Associations**:
```sql
CREATE TABLE notebook_objects (
  notebook_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notebook_id, object_id),
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
);
CREATE INDEX idx_notebook_objects_object ON notebook_objects(object_id);
```

This provides lightning-fast queries for the common operation of finding all objects in a notebook, avoiding the performance penalty of JSON parsing for frequently-accessed relationships.

**JSON Fields for Cognitive Features**:
- `object_bio`: Temporal events and object history (rarely queried in bulk)
- `object_relationships`: Semantic relationships, cross-references, and other flexible connections (not notebook membership)

This hybrid approach ensures core functionality performs optimally while preserving the flexibility needed for cognitive features.

#### 4. Implementation Strategy
1. Add the two JSON columns (bio and relationships)
2. Create the `notebook_objects` junction table
3. Update `ClassicBrowserWOMService` to use junction table for notebook associations
4. Continue using `childObjectIds` for tab group members (no migration needed)
5. Use standard SQL joins for notebook queries, JSON operators only for cognitive features

### Implementation Path

**1. Keep It Simple:**
- Don't change how browser windows work internally
- Tab groups remain the bridge between transient browser state and persistent objects
- Moving tabs = updating `childObjectIds` on tab groups

**2. Leverage What Exists:**
- `ClassicBrowserWOMService` already creates webpage objects and links them
- Just need to add notebook association when creating tab groups
- Composite enrichment already handles metadata synthesis

**3. Agent Integration Points:**
- Agent reads tab group metadata + relationships
- Suggests reorganization based on semantic similarity
- Updates `childObjectIds` and `notebook_id` to execute moves

### Key ideas

- Windows are ephemeral containers
- Moving tab groups = create new + delete old
- The object UUID is the persistent identity
- Using JSON columns for flexible biography/relationship data rather than normalized tables aligns with the "objects manage themselves" philosophy from issue #81

This approach adds cognitive features while keeping the existing architecture intact.

### Leveraging Existing Infrastructure for Attention Metrics

We already have infrastructure to track attention and timing data without complex changes:

**ActivityLogService** already provides:
- `trackPageView()` method that accepts `durationMs` parameter
- Batched writing for performance (flushes every 5 seconds)
- Activity type `'browser_navigation'` for tab events

**Simple implementation approach:**
1. Track tab activation times in `ClassicBrowserTabService` using a Map
2. Calculate duration when switching tabs: `Date.now() - previousActiveTime`
3. Call existing `trackPageView()` with the duration instead of creating new tracking

This gives us:
- Time spent per tab/object
- Which objects are active in which notebooks (via tab group associations)
- Foundation for attention metrics without new schemas

The object biography can later aggregate this data from ActivityLog records, keeping the implementation simple and reliable. 

## API Changes

No new IPC channels are needed for the MVP. Object biography will be updated directly by services when relevant actions occur:
- Browser navigation → `objectModel.addBiographyEvent()` called in `ClassicBrowserWOMService`
- Object creation → Biography initialized in `objectModel.create()`
- Notebook addition → `objectModel.addBiographyEvent()` called in `NotebookService`
- Tab duration tracking → Calculated and stored when switching tabs

This approach keeps biography logic close to the actions that generate events, avoiding complex cross-service event subscriptions.

Biography data is retrieved through existing `window.api.objects.get()` calls, as it's simply a new field on the object.


## Migration Strategy

### Step 1: Non-Breaking Addition
1. Add new columns with default values
2. Update models to read/write new fields
3. Keep existing functionality unchanged

### Step 2: Parallel Implementation
1. Add `addBiographyEvent()` method to ObjectModel
2. Update existing services to call this method at key points
3. Start populating biography for new objects
4. Add UI components as optional features

### Step 3: Data Migration
1. Script to migrate existing relationships
2. Backfill basic biography data from existing timestamps
3. Generate initial AI insights for important objects

### Step 4: Feature Flag Rollout
1. Enable new features behind flags
2. Test with power users
3. Gradually roll out to all users

### Step 5: Deprecation
1. Remove old `child_object_ids` usage
2. Update all code to use new structure
3. Clean up legacy code

## Testing Strategy

to be defined

## Performance Considerations

Searches will be based on the RAG model as well as SQLite queries. It's important to carefully evaluate and balance when to use which kind of query, and which information from the object metadata adds meaningful signal to the vector database, and which object metadata is better kept within the sqlite database, and not added to the vectordb embeddings.

1. **Biography Growth**: Implement event archival for objects with extensive histories
2. **Relationship Queries**: Add indexes for common relationship lookups
3. **AI Processing**: Queue and batch AI insights generation
4. **UI Updates**: Debounce biography updates, cache relationship graphs

## Security Considerations

1. **Biography Privacy**: Ensure user activity details aren't exposed inappropriately
2. **Relationship Validation**: Prevent circular relationships that could cause infinite loops
3. **AI Access**: Limit which objects AI can automatically reorganize

## Rollback Plan

If issues arise:
1. Feature flags can disable new functionality
2. New columns can be ignored (non-breaking)
3. Data can be migrated back to old format if needed
4. Database backup before migration execution

## Future Enhancements

Building on this foundation:
1. **Object Methods**: Implement view(), compose(), transform(), relate()
2. **Cognitive Layers**: Automatic WOM→LOM transitions
3. **Learning**: Objects that adapt based on usage patterns
4. **Ontological Model**: Conceptual relationship inference
5. **Cross-Object Intelligence**: Objects that "know" about related objects

---

This migration lays the groundwork for Jeffers to evolve from a static information store to a dynamic, intelligent substrate for adaptive computing. Objects will no longer be passive containers but active participants in the user's cognitive workflow.

## Appendix: Implementation Plan Reference

**Note**: This is a reference proposal that provides a concrete implementation path. It can be modified or improved, but any modifications MUST be explicitly explained to the user with clear reasoning for the changes.

### Files That Need to Be Modified

#### Stage 1: Database Schema & Model Layer
1. **`/models/migrations/0004_cognitive_objects.sql`** (new file)
   - Add `object_bio` and `object_relationships` columns to objects table
   - Create `notebook_objects` junction table
   - Set default values for existing records

2. **`/models/ObjectModel.ts`**
   - Add `objectBio` and `objectRelationships` fields to `ObjectRecord` interface
   - Update `mapRecordToObject()` to handle new fields
   - Update `objectColumnMap` with new field mappings
   - Add `addBiographyEvent()` method for appending events
   - Update `create()` and `createSync()` to initialize biography
   - Update `update()` to handle new fields

3. **`/shared/types/object.types.ts`**
   - Add `objectBio` and `objectRelationships` fields to `JeffersObject` type
   - Define new types: `ObjectBiography`, `ObjectRelationships`, `BiographyEvent`

**Note**: For the junction table, add methods to existing models rather than creating a new model:
- NotebookModel: `addObjectToNotebook()`, `removeObjectFromNotebook()`, `getObjectIdsForNotebook()`
- ObjectModel: `addToNotebook()`, `removeFromNotebook()`, `getNotebookIdsForObject()`

#### Stage 2: Validation & Service Layer
4. **`/shared/schemas/objectSchemas.ts`** (new file)
   - Create Zod schemas for `objectBio` and `objectRelationships` validation
   - Similar pattern to existing `aiSchemas.ts`

5. **`/services/browser/ClassicBrowserWOMService.ts`**
   - Update `checkAndCreateTabGroup()` to add notebook association in `objectRelationships`
   - Add biography events when creating/updating tab groups
   - Track tab duration when switching tabs

6. **`/services/NotebookService.ts`**
   - Update `createNotebook()` to initialize cognitive fields
   - Add methods to associate objects with notebooks via `objectRelationships`

7. **`/services/browser/ClassicBrowserTabService.ts`**
   - Add tab activation time tracking Map
   - Calculate and log duration when switching tabs
   - Integrate with ActivityLogService for attention metrics

#### Stage 3: Ingestion & Enrichment Services
8. **`/services/ingestion/BaseIngestionWorker.ts`**
   - Initialize biography when creating objects
   - Add ingestion event to biography

9. **`/services/WOMIngestionService.ts`**
   - Add WOM layer event to biography
   - Track refresh events in biography

10. **`/services/CompositeObjectEnrichmentService.ts`**
    - Add enrichment events to biography
    - Update relationships when synthesizing metadata

#### Stage 4: API & IPC Layer
11. **`/electron/ipc/objectHandlers.ts`**
    - Ensure new fields are returned in object queries
    - Add handler for updating object relationships

12. **`/shared/types/api.types.ts`**
    - Update API types to include new cognitive fields

### Implementation Stages

#### Stage 1: Foundation (Week 1)
- Create migration file
- Update ObjectModel with new fields
- Add type definitions and schemas
- Implement basic read/write for new fields
- Add validation

#### Stage 2: Core Integration (Week 2)
- Update browser services for tab group notebook associations
- Implement tab duration tracking
- Add biography event logging to key services
- Update NotebookService for object associations

#### Stage 3: Enrichment (Week 3)
- Integrate cognitive features into ingestion pipeline
- Add biography events for all object lifecycle events
- Update composite enrichment to use relationships
- Implement relationship inference

#### Stage 4: API & Testing (Week 4)
- Update IPC handlers
- Add comprehensive tests
- Create migration scripts for existing data
- Performance testing and optimization

#### Stage 5: UI Integration (Future)
- Add UI components to display biography
- Implement relationship visualization
- Add controls for manual relationship management

### Key Implementation Considerations

1. **Backward Compatibility**: All changes are additive - existing functionality remains unchanged
2. **Performance**: JSON fields allow flexible querying with SQLite's JSON operators
3. **Data Migration**: Default values ensure existing objects work without migration
4. **Incremental Rollout**: Feature flags can control visibility of new features
5. **Testing**: Each stage should include comprehensive tests before proceeding

### Services That Will Need Updates

Based on analysis, these services create or modify objects and will need cognitive feature integration:

**Primary Object Creators**:
- UrlIngestionWorker & PdfIngestionWorker (via BaseIngestionWorker)
- ClassicBrowserWOMService (tab groups)
- WOMIngestionService (webpage objects)
- NotebookService (notebook objects)

**Object Modifiers**:
- CompositeObjectEnrichmentService (enrichment)
- ChunkingService (status updates)
- DataRecoveryService (recovery operations)

**Supporting Services**:
- ActivityLogService (for attention metrics integration)
- BookmarkHandlers (import operations)