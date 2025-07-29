# ADR-[NUMBER]: [Short Title]

**Date:** [YYYY-MM-DD]
**Status:** [Proposed | Accepted | Deprecated | Superseded]
**Deciders:** [List key decision makers]

## Context
[1-2 sentences describing the situation or problem]

## Decision
[The decision made, stated clearly in 1-2 sentences]

## Consequences

### Positive
- [List positive outcomes]
- [Keep it concise]

### Negative
- [List trade-offs or downsides]
- [Be honest about limitations]

## Implementation Notes
[Optional: Key implementation details or constraints]

---

# Example: ADR-001: Use ChromaDB for Vector Storage

**Date:** 2024-01-15
**Status:** Accepted
**Deciders:** Core team

## Context
Jeffers needs vector storage for semantic search across ingested content. We need a solution that works well with our Electron architecture and supports local deployment.

## Decision
We will use ChromaDB as our vector database, running as a separate local service accessed via HTTP API.

## Consequences

### Positive
- Simple HTTP API that works well with Electron's multi-process architecture
- Good Python ecosystem support for our AI pipelines
- Can run completely offline
- Built-in collection management

### Negative
- Requires separate process/service management
- Additional dependency to install and maintain
- HTTP overhead vs embedded solutions

## Implementation Notes
- ChromaDB runs on `http://localhost:8000` by default
- Collections are created per notebook for isolation
- Fallback to SQLite FTS5 when ChromaDB is unavailable