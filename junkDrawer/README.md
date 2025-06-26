# Migration Scripts

This directory contains one-time migration scripts that are not part of the main application.

## ChromaDB to LanceDB Migration

### Overview

The application has migrated from using ChromaDB (external vector database) to LanceDB (embedded vector database). This eliminates the need for running a separate ChromaDB server and improves performance by keeping all data local.

### Migration Steps

1. **Stop the application** - Ensure the Electron app is not running

2. **Clear existing embeddings** (if not already done):
   ```bash
   npm run cli:reset-embeddings
   ```
   This will:
   - Delete all records from the SQLite `embeddings` table
   - Remove the ChromaDB collection (if CHROMA_URL is still configured)
   - Reset object statuses from 'embedded' back to 'parsed'

3. **Re-embed all chunks** using LanceDB:
   ```bash
   npm run cli:reembed-chunks
   ```
   This will:
   - Find all chunks without embeddings
   - Generate new embeddings using OpenAI's text-embedding-3-small model
   - Store embeddings in the local LanceDB vector store
   - Update SQLite embedding records with new vector IDs

4. **Start the application** - The app will now use LanceDB for all vector operations

### Important Notes

- The re-embedding process will make API calls to OpenAI for each chunk, so ensure your `OPENAI_API_KEY` is set
- For large datasets, this process may take some time (progress is logged)
- The script processes chunks in batches of 50 to avoid API rate limits
- LanceDB data is stored in `~/Library/Application Support/jeffers/data/lancedb/` (on macOS)

### After Migration

Once migration is complete:
- You can shut down any running ChromaDB servers
- Remove `CHROMA_URL` from your environment variables
- The docker-compose.yml file (if present) is no longer needed

### Troubleshooting

If the re-embedding script fails:
1. Check that `OPENAI_API_KEY` is set correctly
2. Verify the database path (uses `JEFFERS_DB_PATH` or default location)
3. Check logs for specific error messages
4. You can safely re-run the script - it will only process chunks without embeddings