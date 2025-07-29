# feat: implement Working Memory (WOM) system for tabs and tab groups

## Summary
This PR implements a comprehensive Working Memory (WOM) system that enables transient memory for active webpages and tab groups. The system provides lightweight webpage tracking with AI-powered metadata generation, composite object support for tab groups, and intelligent search deduplication across cognitive layers.

## Key Features
- **Transient webpage memory**: Lightweight ingestion of active browser tabs without full chunking
- **Composite objects**: Tab groups as first-class objects with AI-synthesized metadata
- **Time decay**: Configurable exponential decay for WOM vectors based on access recency
- **Smart deduplication**: Prevents duplicate search results across WOM and LOM layers
- **Event-driven architecture**: Asynchronous enrichment with debouncing for performance

## Architecture Changes

### 1. Database Schema Updates
- Added `last_accessed_at` timestamp to objects table for temporal tracking
- Added `child_object_ids` JSON field for composite object relationships
- New indexes for performance: `idx_objects_last_accessed`, `idx_objects_type_accessed`

### 2. New Services
- **WOMIngestionService**: Handles lightweight webpage ingestion with AI metadata generation
- **CompositeObjectEnrichmentService**: Enriches tab groups with thematic titles and summaries

### 3. Enhanced Services
- **ClassicBrowserService**: Integrated with WOM for automatic webpage tracking
- **ActivityLogService**: Updates object access timestamps on page views
- **HybridSearchService**: Implements intelligent deduplication and recency boosting
- **LanceVectorModel**: Extended with layer-based search and metadata updates

### 4. Type System Extensions
- New vector types: `VectorLayer`, `VectorRecordType`, `VectorMediaType`
- Enhanced search types with deduplication options
- WOM-specific ingestion types

## Implementation Details

### Vector Storage Strategy
```typescript
// WOM layer: Active webpages and tab groups
{ layer: 'wom', recordType: 'object', mediaType: 'webpage' }
{ layer: 'wom', recordType: 'object', mediaType: 'tab_group' }

// LOM layer: Persistent knowledge
{ layer: 'lom', recordType: 'object', mediaType: 'webpage' }
{ layer: 'lom', recordType: 'chunk', mediaType: 'webpage' }
```

### Search Deduplication
- Groups results by `objectId` to prevent duplicates
- Merges LOM content quality with WOM recency signals
- Applies exponential decay based on `last_accessed_at`

### Configuration
All WOM behavior is configurable via constants:
```typescript
WOM_CONSTANTS = {
  DECAY_RATE: 0.1,                    // Exponential decay per week
  DECAY_MIN_SCORE: 0.1,                // Score floor (10%)
  WOM_RECENCY_BOOST_FACTOR: 0.2,       // LOM+WOM merge factor
  INGESTION_DEBOUNCE_MS: 1000,         // Debounce for webpage updates
  ENRICHMENT_DEBOUNCE_MS: 5000,        // Debounce for AI enrichment
  REFRESH_CHECK_INTERVAL_MS: 86400000, // 24 hours
  WOM_RETENTION_DAYS: 30,              // Cleanup threshold
}
```

## API Changes

### New IPC Channels
- `wom:ingest-webpage` - Ingest webpage into WOM
- `wom:update-access` - Update access timestamp
- `wom:create-tab-group` - Create composite object
- `wom:update-tab-group` - Update tab group children
- `wom:enrich-composite` - Request AI enrichment

### New Preload API
```typescript
window.api.wom = {
  ingestWebpage(url, title): Promise<{ success, objectId?, error? }>
  updateAccess(objectId): Promise<{ success, error? }>
  createTabGroup(title, childObjectIds): Promise<{ success, objectId?, error? }>
  updateTabGroup(objectId, childObjectIds): Promise<{ success, error? }>
  enrichComposite(objectId): Promise<{ scheduled, error? }>
  onIngestionStarted(callback): () => void
  onIngestionComplete(callback): () => void
}
```

## Files Changed
- **New files**: 
  - `services/WOMIngestionService.ts`
  - `services/CompositeObjectEnrichmentService.ts`
  - `services/constants/womConstants.ts`
  - `electron/ipc/womHandlers.ts`

- **Modified files**:
  - `models/LanceVectorModel.ts` - Added layer-based search and metadata updates
  - `services/ActivityLogService.ts` - Added object timestamp updates
  - `services/ClassicBrowserService.ts` - Integrated WOM tracking
  - `services/HybridSearchService.ts` - Implemented deduplication
  - `services/ingestion/*` - Enhanced for WOM support
  - `electron/bootstrap/serviceBootstrap.ts` - Registered new services
  - `electron/bootstrap/registerIpcHandlers.ts` - Added WOM handlers
  - `electron/preload.ts` - Exposed WOM API
  - `shared/types/*` - Extended type definitions
  - `shared/ipcChannels.ts` - Added WOM channels

## Testing Considerations
- Verify webpage ingestion creates WOM vectors without chunks
- Test tab group enrichment with 3+ tabs
- Confirm search deduplication prevents duplicate results
- Validate time decay calculations
- Check debouncing prevents excessive API calls

## Migration Notes
- No breaking changes to existing functionality
- Database migration is backward compatible
- WOM features are opt-in via browser integration

## Future Enhancements
- Configurable retention policies for WOM cleanup
- Batch ingestion optimization
- Enhanced composite object relationships
- WOM-to-LOM promotion workflows