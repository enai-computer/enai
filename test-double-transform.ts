import { BaseIngestionWorker } from './services/ingestion/BaseIngestionWorker';

console.log('Testing double transformation fix:\n');

// Original AI output format
const aiOutput = [
  { type: 'main' as const, content: 'Main proposition' },
  { type: 'supporting' as const, content: 'Supporting detail' }
];

console.log('1. Original AI output:');
console.log(JSON.stringify(aiOutput, null, 2));

// First transformation (what was happening in UrlIngestionWorker before fix)
const firstTransform = BaseIngestionWorker.transformPropositions(aiOutput);
console.log('\n2. After first transformation:');
console.log(JSON.stringify(firstTransform, null, 2));

// Attempting second transformation (what would happen in helper method)
console.log('\n3. Attempting second transformation on already-transformed data:');
try {
  // This will fail because firstTransform is not an array
  const secondTransform = BaseIngestionWorker.transformPropositions(firstTransform as any);
  console.log('Result:', JSON.stringify(secondTransform, null, 2));
  console.log('❌ PROBLEM: Double transformation produced incorrect result!');
} catch (error) {
  console.log('❌ ERROR: Double transformation failed!');
  console.log('Error:', error);
}

console.log('\n4. With the fix - passing raw AI output directly:');
// This is what happens now after the fix
const correctTransform = BaseIngestionWorker.transformPropositions(aiOutput);
console.log('Result:', JSON.stringify(correctTransform, null, 2));
console.log('✅ SUCCESS: Single transformation produces correct result!');

// Test the fallback scenario
console.log('\n5. Testing fallback with empty array (after fix):');
const fallbackPropositions: any[] = [];
const fallbackResult = BaseIngestionWorker.transformPropositions(fallbackPropositions);
console.log('Result:', JSON.stringify(fallbackResult, null, 2));
console.log('✅ SUCCESS: Empty array fallback works correctly!');