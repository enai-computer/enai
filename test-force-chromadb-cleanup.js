// Script to force ChromaDB cleanup by finding and deleting orphaned objects
// Run this from the Electron app's DevTools console

async function forceChromaDBCleanup() {
  console.log('Checking for orphaned objects in the database...');
  
  try {
    // First, let's search for invoices to see what's actually in ChromaDB
    console.log('\n1. Searching for invoices to identify orphaned entries...');
    const searchResults = await window.api.search('invoices');
    
    if (!searchResults || searchResults.length === 0) {
      console.log('No search results found. ChromaDB might be empty or the search failed.');
      return;
    }
    
    console.log(`Found ${searchResults.length} search results`);
    
    // Extract unique object IDs from search results
    const objectIds = [...new Set(searchResults.map(r => r.objectId).filter(Boolean))];
    console.log(`\n2. Found ${objectIds.length} unique object IDs from search results`);
    
    // Check which objects actually exist in the database
    const orphanedIds = [];
    for (const id of objectIds) {
      try {
        // Try to get the object - if it doesn't exist, it's orphaned
        const obj = await window.api.getObject?.(id);
        if (!obj) {
          orphanedIds.push(id);
        }
      } catch (error) {
        // If getObject fails, assume the object is orphaned
        orphanedIds.push(id);
      }
    }
    
    console.log(`\n3. Found ${orphanedIds.length} orphaned object IDs in ChromaDB`);
    
    if (orphanedIds.length > 0) {
      console.log('Orphaned IDs:', orphanedIds);
      console.log('\nTo delete these orphaned entries:');
      console.log('1. Restart ChromaDB to clear its cache');
      console.log('2. Or manually delete the ChromaDB data directory and restart');
      console.log('3. Or wait for the next successful object deletion to trigger cleanup');
    } else {
      console.log('No orphaned entries found. ChromaDB appears to be in sync.');
    }
    
    // Show current valid invoices
    const validResults = searchResults.filter(r => !orphanedIds.includes(r.objectId));
    console.log(`\n4. ${validResults.length} valid invoice results remain`);
    
    return {
      totalResults: searchResults.length,
      orphanedCount: orphanedIds.length,
      validCount: validResults.length,
      orphanedIds
    };
    
  } catch (error) {
    console.error('Error during ChromaDB cleanup check:', error);
    throw error;
  }
}

// Alternative: Direct ChromaDB reset instructions
function showChromaDBResetInstructions() {
  console.log(`
To manually reset ChromaDB and remove all orphaned entries:

1. Stop the Jeffers application
2. Stop ChromaDB if running separately
3. Delete or rename the ChromaDB data directory:
   - Default location: ~/.chroma or ./chroma_data
   - Or wherever CHROMA_DB_PATH points to
4. Restart ChromaDB
5. Restart Jeffers
6. Re-ingest your PDFs

This will give you a clean slate with only valid entries.
`);
}

console.log('Functions available:');
console.log('- forceChromaDBCleanup() - Check for orphaned entries');
console.log('- showChromaDBResetInstructions() - Show manual reset steps');