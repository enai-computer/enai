#!/usr/bin/env node

// Simple test runner for the user profile system
console.log('=== User Profile System Test Runner ===\n');

console.log('To test the user profile system:\n');

console.log('1. Start the application:');
console.log('   npm run electron:dev\n');

console.log('2. Open Developer Tools in the app (Cmd+Option+I on Mac)\n');

console.log('3. Test Activity Logging:');
console.log('   - Create notebooks');
console.log('   - Start chat conversations');
console.log('   - Navigate in ClassicBrowser');
console.log('   - Select intents from suggestions\n');

console.log('4. Check Current Profile:');
console.log('   await window.electron.getProfile()\n');

console.log('5. Check Full Profile (with raw data):');
console.log('   await window.electron.getFullProfile()\n');

console.log('6. Check Recent Activities:');
console.log('   await window.electron.getRecentActivities(24)\n');

console.log('7. Force Profile Synthesis:');
console.log('   await window.electron.forceSynthesis("both")\n');
console.log('   // Options: "activities", "content", or "both"\n');

console.log('8. Check Synthesis State:');
console.log('   await window.electron.getSynthesisState()\n');

console.log('9. Clear Profile (for testing fresh synthesis):');
console.log('   await window.electron.clearProfile()\n');

console.log('9. Run Automated Tests:');
console.log('   npm test services/agents/ProfileAgent.test.ts\n');

console.log('Note: Debug functions are only available in development mode.');
console.log('The profile synthesis runs automatically on startup and periodically.');
console.log('- Activity synthesis: every 15 minutes (configurable)');
console.log('- Content synthesis: every 30 minutes (configurable)\n');

console.log('For detailed testing instructions, see TEST_USER_PROFILE.md');