// Test script to manually delete orphaned chunks from ChromaDB
// Run this from the Electron app's DevTools console

async function cleanupOrphanedChunks() {
  // The orphaned chunk IDs we saw in the logs
  const orphanedChunkIds = [
    '645', '620', '678', '673', '621', '632', '647', '613', '623', '628'
  ];

  console.log(`Attempting to delete ${orphanedChunkIds.length} orphaned chunks from ChromaDB...`);

  try {
    // Check if window.api.deleteChunksFromChroma exists
    if (!window.api || !window.api.deleteChunksFromChroma) {
      console.error('ChromaDB deletion API not available. We need to add this to the IPC handlers.');
      console.log('Alternative: You can restart ChromaDB or clear its data directory to remove orphaned entries.');
      return;
    }

    // Call the deletion API
    const result = await window.api.deleteChunksFromChroma(orphanedChunkIds);
    
    console.log('Deletion complete!');
    console.log(`Successfully deleted: ${result.successful.length} chunks`);
    console.log(`Failed to delete: ${result.failed.length} chunks`);
    
    if (result.successful.length > 0) {
      console.log('Successfully deleted IDs:', result.successful);
    }
    
    if (result.failed.length > 0) {
      console.error('Failed to delete IDs:', result.failed);
    }
    
    if (result.error) {
      console.error('ChromaDB error:', result.error);
    }
    
    return result;
  } catch (error) {
    console.error('Error during ChromaDB cleanup:', error);
    throw error;
  }
}

// Run the cleanup
console.log('To delete the orphaned chunks, run: cleanupOrphanedChunks()');
console.log('This function is now available in the console.');