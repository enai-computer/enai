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

ALTER TABLE objects ADD COLUMN object_bio TEXT;
ALTER TABLE objects ADD COLUMN object_relationships TEXT;

-- Set default values for existing records
UPDATE objects SET object_bio = '{"created_at": "' || created_at || '", "events": []}' WHERE object_bio IS NULL;
UPDATE objects SET object_relationships = '{"notebooks": [], "parents": [], "children": [], "related": []}' WHERE object_relationships IS NULL;
```

**Note**: No foreign key constraints are added to avoid circular dependencies with the notebooks table.

### Object Biography

The `objectBio` field stores a JSON object tracking the object's lifecycle, interactions, and evolution. This could include creation context, interaction events, usage statistics, and AI-derived insights.

### Object Relationships  

The `objectRelationships` field stores a JSON object defining connections between objects. This enables rich relationship graphs beyond simple parent-child hierarchies.
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

#### 3. Notebook Association via object_relationships
Store notebook associations in the JSON `object_relationships` field:
```typescript
// Example object_relationships for a tab group
{
  "notebooks": [{
    "notebook_id": "nb-123",
    "association_type": "tab_group",
    "added_at": "2025-01-08T10:00:00Z",
    "window_id": "win-456"
  }],
  "related": []
  // Note: children are stored in childObjectIds column, not here
}
```

#### 4. Implementation Strategy
1. Add the two JSON columns (bio and relationships)
2. Update `ClassicBrowserWOMService` to populate notebook associations in `object_relationships`
3. Continue using `childObjectIds` for tab group members (no migration needed)
4. Query notebook associations using SQLite's JSON operators

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