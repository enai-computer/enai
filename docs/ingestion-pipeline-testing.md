# Ingestion Pipeline Testing Guide

## Overview

This document describes the concurrent URL ingestion test suite that verifies the complete pipeline from URL fetch through to embedded chunks.

## Test URLs

The test processes 5 URLs simultaneously:
1. https://en.wikipedia.org/wiki/Donald_Judd (Wikipedia article)
2. https://en.wikipedia.org/wiki/Robert_Irwin_(artist) (Wikipedia article)
3. https://en.wikipedia.org/wiki/Robinson_Jeffers (Wikipedia article)
4. https://roselyddon.substack.com/p/how-martyrs-became-men (Substack article)
5. https://www.anthropic.com (Company website)

## Running the Tests

### Prerequisites

1. **OpenAI API Key**: Required for AI summarization and embeddings
   ```bash
   export OPENAI_API_KEY=your-api-key-here
   ```

2. **ChromaDB**: Not required for the test (uses mock vector store)

### Run Command

```bash
npm run test:ingestion
```

## What the Test Verifies

### 1. Concurrent Processing
- All 5 URLs are processed simultaneously (concurrency=5)
- Verifies no race conditions or deadlocks
- Measures processing times

### 2. Complete Data Flow
Each URL goes through:
- **Phase 1**: Object creation and job queueing
- **Phase 2**: URL fetch → HTML parse → text cleaning → AI summarization
- **Phase 3**: Status transition to 'vectorizing'
- **Phase 4**: Chunking service picks up 'parsed' objects
- **Phase 5**: Chunks created with individual summaries/tags/propositions

### 3. Data Transformations
- HTML → Readability parsed content
- Raw text → Cleaned text for embeddings
- Full text → Object-level summary, tags, and propositions
- Full text → Multiple chunks with metadata

### 4. Status Transitions
Tracks and verifies valid transitions:
- Object: `new` → `parsed` → `embedding` → `embedded`
- Job: `queued` → `processing_source` → `parsing_content` → `persisting_data` → `vectorizing`

### 5. Database Relationships
- Each job linked to one object
- Each object has multiple chunks
- All chunks properly associated with parent object

## Manual Verification

The test outputs detailed logs for manual data integrity checks:

### Object-Level Data
- Title extraction accuracy
- Summary quality (200-400 words)
- Tag relevance (5-7 tags)
- Proposition categorization (main/supporting/action)

### Chunk-Level Data
- Content segmentation (150-400 tokens per chunk)
- Individual chunk summaries
- Chunk-specific tags and propositions

## Test Output Example

```
=== Starting Concurrent URL Ingestion Test ===

--- Phase 1: Creating objects and jobs ---
[Test] Job created for https://en.wikipedia.org/wiki/Donald_Judd
[Test] Job created for https://en.wikipedia.org/wiki/Robert_Irwin_(artist)
...

--- Phase 2: Starting concurrent processing ---
[Test] Job started: https://en.wikipedia.org/wiki/Donald_Judd
[Test] Job started: https://en.wikipedia.org/wiki/Robert_Irwin_(artist)
...

--- Phase 3: Verifying URL processing results ---
📄 https://en.wikipedia.org/wiki/Donald_Judd
  Job Status: vectorizing
  Object Status: parsed
  Title: Donald Judd - Wikipedia
  Summary: Donald Judd was an influential American artist known for...
  Text Length: 45823
  Tags: minimalism, sculpture, art, design, architecture

--- Phase 5: Final verification ---
✅ https://en.wikipedia.org/wiki/Donald_Judd
  Final Status: embedded
  Chunks Created: 12
  First chunk summary: This section introduces Donald Judd as a pivotal figure...
  Processing Time: 8.42s

=== Test Summary ===
Total URLs: 5
Successfully Embedded: 4
Parsed Only: 0
Failed: 1
Total Chunks: 47
Average Processing Time: 7.23s
```

## Troubleshooting

### Common Issues

1. **"OPENAI_API_KEY not set"**
   - Set the environment variable before running tests

2. **Timeout errors**
   - Default timeout is 2 minutes
   - May need adjustment for slow networks
   - Check OpenAI API rate limits

3. **Failed URLs**
   - Some websites may block automated access
   - Substack URLs may require authentication
   - Check error logs for specific failures

### Debugging

Enable debug logging:
```bash
DEBUG=* npm run test:ingestion
```

## Future Improvements (v2)

- Performance metrics (memory, CPU usage)
- Error recovery scenarios
- Queue priority testing
- Resource cleanup verification
- Mock mode for CI/CD without API keys