# Remove LLMService Abstraction & Improve Codebase

## Summary

This PR removes the centralized LLMService abstraction in favor of direct model instantiation, significantly simplifying the codebase while maintaining all functionality. Additionally, it includes several improvements made along the way including enhanced test coverage, database migration consolidation, and UI component fixes.

## Primary Changes

### 1. LLMService Removal (Main Focus)
- **Removed**: 695 lines of abstraction code
  - `services/LLMService.ts` (299 lines)
  - `services/llm_providers/openai.ts` (260 lines) 
  - `shared/llm-types.d.ts` (67 lines)
  - Test file and utilities

- **Added**: Simple 30-line helper (`utils/llm.ts`)
  ```typescript
  export function createChatModel(modelName: string, options: any = {})
  export function createEmbeddingModel(modelName: string = "text-embedding-3-small", options: any = {})
  ```

- **Result**: Each service now explicitly declares which models it uses:
  - AgentService: `gpt-4.1` for general tasks, `gpt-4o` for reasoning
  - ProfileAgent: `gpt-4o` for profile synthesis
  - IngestionAIService: `gpt-4.1-nano` for chunking/summarization
  - ActionSuggestionService: `o1-mini` for UI suggestions
  - LangchainAgent: `gpt-4o-mini` for rephrasing, `gpt-4o` for answers
  - ChromaVectorModel: `text-embedding-3-small` for embeddings

## Additional Improvements

### 2. Test Suite Enhancements
- Added comprehensive test coverage for:
  - ChatService
  - ProfileService
  - ActivityLogService
- Improved test quality and reliability

### 3. Database Migration Consolidation
- Consolidated 22+ individual migration files into a single initial schema
- Simplifies database setup for new installations
- Maintains backward compatibility

### 4. UI Component Improvements
- Fixed note saving issues
- Removed orphaned note list components
- Made ClassicBrowser component fully self-contained

## Benefits

1. **Improved Code Clarity**
   - Explicit model usage - no need to trace through abstractions
   - Clear understanding of which AI model handles each task

2. **Reduced Complexity**
   - Removed unnecessary abstraction layer
   - Simplified dependency injection
   - Easier to understand and modify

3. **Better Developer Experience**
   - Clearer error messages when models fail
   - Easier debugging of model-related issues
   - Simpler mental model

4. **Performance**
   - Removed overhead of provider selection logic
   - Direct instantiation is more efficient

## Migration Guide

For developers working with the codebase:

**Before:**
```typescript
const llmService = new LLMService();
const response = await llmService.complete(prompt, { context: "chunking" });
```

**After:**
```typescript
import { createChatModel } from '@/utils/llm';
const model = createChatModel('gpt-4.1-nano');
const response = await model.invoke(prompt);
```

## Testing

All tests pass, including:
- ✅ Services affected by LLMService removal
- ✅ Profile synthesis and agent functionality
- ✅ Ingestion pipeline with new model instantiation

## Breaking Changes

None - this is an internal refactoring with no external API changes.

## Checklist

- [x] Code compiles without warnings
- [x] All tests pass
- [x] No remaining references to LLMService
- [x] Documentation updated (CLAUDE.md)
- [x] Performance tested (improved due to less overhead)