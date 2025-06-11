// Test script to delete PDFs from the database
// Run this from the Electron app's DevTools console

async function testDeletePdfs() {
  const pdfIds = [
    '0afa74d2-96ce-4ab2-aeed-79bd214899cf',
    '7d627112-bc5e-404c-b403-e74dc0f3c40f',
    '4bea7eec-c96d-4857-9f34-5bb780b30762',
    '46cc2627-8da4-4528-8d42-9d31c5f72d88',
    '888b3d18-9c80-496e-b6ea-827dce25ad68',
    'd2c70173-1a92-47d6-91c6-98000b03d33e',
    '27630fd6-0e31-4234-92eb-5b5f233e31df',
    '2c0f8005-ae6d-446f-99c2-26ae85ff5eb2',
    'ab463719-f8d6-4cc2-83ef-d6bc0d1e04b3',
    'eb24a33a-2817-441b-8601-e5ea95a158a6',
    '8fd1eb03-d10b-49b9-8437-da1c3712b08e',
    '5e24e9e1-9dae-4599-bd9a-17ffc97d6288',
    'e206e747-1573-418a-93ea-0bbabd3dc138',
    'e917e130-824c-4998-9962-4a2ea002caf9',
    '111abe92-9ea2-4fb5-ab8f-98dda7c0f21a',
    '47986f2c-265c-44fe-a642-9a1284dd74c4',
    '60d0a00f-cc31-4999-af4f-f29a72a86c74',
    'd5d8ac55-fa58-4a77-90fe-4c024a961d7a',
    'bacd8f26-f29f-4a9a-b195-175f5d75f496',
    'c076e973-52d7-423e-bc47-d61c9b0391b2',
    'b325952c-c20f-444b-b80c-3fe8fcbb6e56',
    '179d8ada-9232-43b2-935e-34b57259664e',
    '084ef650-84d1-4c79-a6ee-9113f974ec66',
    'c27c3715-cb4c-40a7-84d6-09f766ab345f',
    'e7b3d42b-8cc7-4218-b236-b25a34c6d0b3'
  ];

  console.log(`Attempting to delete ${pdfIds.length} PDFs...`);

  try {
    // Check if window.api.deleteObjects exists
    if (!window.api || !window.api.deleteObjects) {
      console.error('Delete API not available. Make sure you have the latest code running.');
      return;
    }

    // Call the deletion API
    const result = await window.api.deleteObjects(pdfIds);
    
    console.log('Deletion complete!');
    console.log(`Successfully deleted: ${result.successful.length} objects`);
    console.log(`Failed to delete: ${result.failed.length} objects`);
    console.log(`Not found: ${result.notFound.length} objects`);
    
    if (result.successful.length > 0) {
      console.log('Successfully deleted IDs:', result.successful);
    }
    
    if (result.failed.length > 0) {
      console.error('Failed to delete IDs:', result.failed);
    }
    
    if (result.notFound.length > 0) {
      console.warn('IDs not found in database:', result.notFound);
    }
    
    if (result.orphanedChunkIds && result.orphanedChunkIds.length > 0) {
      console.warn(`Warning: ${result.orphanedChunkIds.length} chunks could not be deleted from ChromaDB`);
    }
    
    if (result.chromaDbError) {
      console.error('ChromaDB error (non-fatal):', result.chromaDbError);
    }
    
    if (result.sqliteError) {
      console.error('SQLite error (fatal):', result.sqliteError);
    }
    
    return result;
  } catch (error) {
    console.error('Error during deletion:', error);
    throw error;
  }
}

// Run the test
console.log('To delete the PDFs, run: testDeletePdfs()');
console.log('This function is now available in the console.');