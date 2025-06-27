The Jeffers personal library consists of an intent stream (INS), working memory (WOM), long term memory (LOM), and ontological model (OM). So far, we’ve built things that go into LOM.

Next, we’ll be building for WOM, which is a less rigorously processed (object only, no chunks) version of LOM, which also is more transient - we will want to assign a date that things were last accessed in the WOM, and degrade their search relevance on a weekly basis.

Tab groups are just classicbrowser windows with multiple tabs.

### LOM Ingestion Pipeline

The process of ingesting content into Long-Term Memory (LOM) is managed by a series of services that work together to fetch, parse, analyze, and store data.

1.  **`IngestionQueueService`**: This service acts as the entry point and manager for all ingestion tasks. It maintains a queue of jobs and dispatches them to the appropriate workers based on the content type (e.g., URL, PDF). It handles job prioritization, retries, and concurrency.

2.  **Ingestion Workers (`UrlIngestionWorker`, `PdfIngestionWorker`)**: These are specialized workers responsible for handling specific data types.
    *   They fetch the raw content (e.g., download a webpage's HTML).
    *   They parse the content to extract the main text and metadata (e.g., using Readability for articles).
    *   They perform initial text cleaning.

3.  **`IngestionAiService`**: This service is responsible for the initial AI-powered analysis of the entire document. It generates a high-level summary, key topics (tags), and atomic propositions for the object before it is chunked.

4.  **`ObjectModel`**: After initial processing, the content and its metadata are saved to the `objects` table with a status of `'parsed'`.

5.  **`ChunkingService`**: This is the core orchestrator for the final stage of LOM processing.
    *   It periodically queries for objects with the `'parsed'` status.
    *   It uses `IngestionAiService` again, this time to break the document's text into smaller, semantically coherent chunks.
    *   It manages a transaction to:
        1.  Store the chunks in the `chunks` table.
        2.  Generate vector embeddings for each chunk via the `vectorStore`.
        3.  Link the chunks to their corresponding vectors in the `embeddings` table.
    *   Finally, it updates the object's status to `'embedded'`, making it fully available for retrieval.