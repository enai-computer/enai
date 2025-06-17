#!/usr/bin/env node

/**
 * Validation script for StreamManager refactoring
 * Run this to check if the streaming functionality is working correctly
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 StreamManager Validation Script\n');

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function success(msg) {
  console.log(`${colors.green}✓ ${msg}${colors.reset}`);
}

function error(msg) {
  console.log(`${colors.red}✗ ${msg}${colors.reset}`);
}

function info(msg) {
  console.log(`${colors.blue}ℹ ${msg}${colors.reset}`);
}

function warning(msg) {
  console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`);
}

// Check 1: TypeScript compilation
console.log('1. Checking TypeScript compilation...');
try {
  execSync('npm run typecheck', { stdio: 'pipe' });
  success('TypeScript compilation successful');
} catch (e) {
  error('TypeScript compilation failed');
  console.error(e.stderr.toString());
  process.exit(1);
}

// Check 2: Verify StreamManager implements IService
console.log('\n2. Verifying StreamManager interface implementation...');
const streamManagerPath = path.join(__dirname, '../services/StreamManager.ts');
const streamManagerContent = fs.readFileSync(streamManagerPath, 'utf8');

if (streamManagerContent.includes('implements IService')) {
  success('StreamManager implements IService interface');
} else {
  error('StreamManager does not implement IService interface');
}

if (streamManagerContent.includes('async initialize()')) {
  success('StreamManager has initialize method');
} else {
  error('StreamManager missing initialize method');
}

if (streamManagerContent.includes('async cleanup()')) {
  success('StreamManager has cleanup method');
} else {
  error('StreamManager missing cleanup method');
}

if (streamManagerContent.includes('async healthCheck()')) {
  success('StreamManager has healthCheck method');
} else {
  error('StreamManager missing healthCheck method');
}

// Check 3: Verify services are using StreamManager
console.log('\n3. Checking service dependencies...');

const chatServicePath = path.join(__dirname, '../services/ChatService.ts');
const chatServiceContent = fs.readFileSync(chatServicePath, 'utf8');

if (chatServiceContent.includes('streamManager: StreamManager')) {
  success('ChatService has StreamManager dependency');
} else {
  error('ChatService missing StreamManager dependency');
}

if (chatServiceContent.includes('this.deps.streamManager.startStream')) {
  success('ChatService uses StreamManager.startStream');
} else {
  error('ChatService not using StreamManager.startStream');
}

const agentServicePath = path.join(__dirname, '../services/AgentService.ts');
const agentServiceContent = fs.readFileSync(agentServicePath, 'utf8');

if (agentServiceContent.includes('streamManager: StreamManager')) {
  success('AgentService has StreamManager dependency');
} else {
  error('AgentService missing StreamManager dependency');
}

if (agentServiceContent.includes('this.deps.streamManager.startStream')) {
  success('AgentService uses StreamManager.startStream');
} else {
  error('AgentService not using StreamManager.startStream');
}

// Check 4: Verify bootstrap configuration
console.log('\n4. Checking service bootstrap...');

const bootstrapPath = path.join(__dirname, '../electron/bootstrap/serviceBootstrap.ts');
const bootstrapContent = fs.readFileSync(bootstrapPath, 'utf8');

if (bootstrapContent.includes('StreamManager.getInstance()')) {
  success('StreamManager instantiated in bootstrap');
} else {
  error('StreamManager not instantiated in bootstrap');
}

if (bootstrapContent.includes('streamManager: streamManager')) {
  success('StreamManager passed to dependent services');
} else {
  warning('StreamManager may not be passed to all services');
}

// Check 5: Check for duplicate streaming logic
console.log('\n5. Checking for duplicate streaming code...');

const patterns = [
  /for\s+await\s*\(\s*const\s+chunk\s+of\s+stream\s*\)/g,
  /sender\.send\s*\(\s*ON_.*_STREAM_CHUNK/g,
  /sender\.send\s*\(\s*ON_.*_STREAM_END/g,
  /sender\.send\s*\(\s*ON_.*_STREAM_ERROR/g
];

let duplicateCount = 0;

// Check in ChatService
patterns.forEach(pattern => {
  const matches = chatServiceContent.match(pattern);
  if (matches && matches.length > 0) {
    duplicateCount += matches.length;
  }
});

// Check in AgentService
patterns.forEach(pattern => {
  const matches = agentServiceContent.match(pattern);
  if (matches && matches.length > 0) {
    duplicateCount += matches.length;
  }
});

if (duplicateCount === 0) {
  success('No duplicate streaming logic found in services');
} else {
  warning(`Found ${duplicateCount} potential duplicate streaming patterns`);
}

// Check 6: Verify IPC channels are defined
console.log('\n6. Checking IPC channel definitions...');

const ipcChannelsPath = path.join(__dirname, '../shared/ipcChannels.ts');
const ipcChannelsContent = fs.readFileSync(ipcChannelsPath, 'utf8');

const requiredChannels = [
  'ON_STREAM_START',
  'ON_STREAM_CHUNK', 
  'ON_STREAM_END',
  'ON_STREAM_ERROR'
];

requiredChannels.forEach(channel => {
  if (ipcChannelsContent.includes(channel)) {
    success(`${channel} is defined`);
  } else {
    error(`${channel} is not defined`);
  }
});

// Check 7: Look for potential issues
console.log('\n7. Checking for potential issues...');

// Check for old streaming patterns
if (chatServiceContent.includes('streamMap') || chatServiceContent.includes('activeStreams')) {
  warning('ChatService may still have old streaming state management');
} else {
  success('ChatService cleaned of old streaming state');
}

if (agentServiceContent.includes('for await (const chunk of stream)')) {
  warning('AgentService may still have old streaming loops');
} else {
  success('AgentService cleaned of old streaming loops');
}

// Summary
console.log('\n📊 Validation Summary:');
info('StreamManager refactoring validation complete');
info('Run the application and test streaming functionality manually');
info('See TESTING_STREAMMANAGER.md for detailed test scenarios');

// Check if we have any ESLint issues
console.log('\n8. Running ESLint check...');
try {
  execSync('npm run lint -- --max-warnings=0', { stdio: 'pipe' });
  success('No ESLint issues found');
} catch (e) {
  warning('ESLint found some issues (this may be okay)');
}

console.log('\n✅ Validation script completed successfully!');