# StreamManager Testing & Validation Guide

## Overview
This document provides comprehensive testing scenarios to validate the StreamManager refactoring in the Enai codebase.

## Test Scenarios

### 1. Chat Streaming Tests

#### Test 1.1: Basic Chat Streaming
**Steps:**
1. Open a notebook
2. Type a question in the chat
3. Observe streaming response

**Expected Results:**
- Chat response streams in chunks (buffered at 50ms intervals)
- Smooth text appearance without character-by-character updates
- Complete response saved to database
- No console errors

**Validation Points:**
- Check browser console for any streaming errors
- Verify in logs: `[StreamManager] Starting stream` and `[StreamManager] Stream completed successfully`
- Database should have complete message after streaming

#### Test 1.2: Chat Stream Interruption
**Steps:**
1. Start a chat stream with a long response
2. Quickly type another question before the first completes

**Expected Results:**
- First stream stops cleanly
- Second stream starts immediately
- No orphaned streams or memory leaks
- Log shows: `[StreamManager] Stopping stream` for the interrupted stream

#### Test 1.3: Chat Error Handling
**Steps:**
1. Disconnect from OpenAI (set invalid API key temporarily)
2. Try to send a chat message

**Expected Results:**
- Error message displayed to user
- `ON_CHAT_STREAM_ERROR` event sent
- No application crash
- Stream cleanup occurs properly

### 2. Intent Streaming Tests

#### Test 2.1: Search Intent with Results
**Steps:**
1. In the welcome screen, type a search query
2. Observe search results and AI summary streaming

**Expected Results:**
- Search results (slices) appear immediately
- AI summary streams after results
- Both local and web results displayed (if Exa enabled)
- Summary references the search results

**Validation Points:**
- Check for `[AgentService] Starting summary stream` in logs
- Verify slices are sent before streaming starts
- Confirm stream completion with correlation ID

#### Test 2.2: Tool-Based Intents
**Steps:**
1. Try "create notebook Test Notebook"
2. Try "open notebook [existing name]"
3. Try opening a URL

**Expected Results:**
- Immediate responses (no streaming needed)
- Correct intent results sent
- No unnecessary streaming initialization

#### Test 2.3: Complex Intent Streaming
**Steps:**
1. Ask a complex question that triggers agent tools
2. Observe multi-step processing

**Expected Results:**
- Tool calls executed in sequence
- Final summary streams to user
- All tool results properly saved to conversation history

### 3. Performance Tests

#### Test 3.1: Concurrent Streams
**Steps:**
1. Open multiple notebook windows
2. Start chat streams in each simultaneously

**Expected Results:**
- Each window streams independently
- No cross-contamination of streams
- StreamManager tracks all active streams correctly
- `getActiveStreamCount()` reflects correct number

#### Test 3.2: Memory Usage
**Steps:**
1. Start a very long streaming response
2. Monitor browser memory usage

**Expected Results:**
- Memory usage remains stable
- No accumulation of buffered chunks
- Proper cleanup after stream completion

### 4. Edge Cases

#### Test 4.1: Rapid Window Close
**Steps:**
1. Start a streaming response
2. Immediately close the window

**Expected Results:**
- No errors in main process
- Stream cleanup happens automatically
- Log shows stream was interrupted

#### Test 4.2: Network Interruption
**Steps:**
1. Start streaming
2. Disconnect network briefly

**Expected Results:**
- Stream errors gracefully
- Error event sent to renderer
- User sees appropriate error message

## Validation Checklist

### Code-Level Validation
- [ ] TypeScript compilation passes (`npm run typecheck`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] All imports resolved correctly

### Runtime Validation
- [ ] Application starts without errors
- [ ] Chat streaming works in notebooks
- [ ] Intent streaming works in welcome screen
- [ ] No memory leaks during extended use
- [ ] Proper cleanup on app shutdown

### Log Validation
Look for these key log messages:
- `[StreamManager] Initialized`
- `[StreamManager] Starting stream`
- `[StreamManager] Stream completed successfully`
- `[ChatService] ChatService initialized`
- `[AgentService] AgentService initialized`

### Database Validation
- [ ] Chat messages saved correctly after streaming
- [ ] Message IDs properly tracked
- [ ] Session management works correctly

## Manual Testing Commands

### 1. Check Active Streams
In the Electron console:
```javascript
// Get StreamManager instance
const sm = require('./services/StreamManager').StreamManager.getInstance();
console.log('Active streams:', sm.getActiveStreamCount());
```

### 2. Monitor Stream Events
In the browser console:
```javascript
// Listen to stream events
window.api.on('stream:onStart', (data) => console.log('Stream started:', data));
window.api.on('stream:onChunk', (data) => console.log('Chunk:', data.chunk));
window.api.on('stream:onEnd', (data) => console.log('Stream ended:', data));
window.api.on('stream:onError', (data) => console.error('Stream error:', data));
```

### 3. Test Stream Abort
```javascript
// Start a stream and immediately stop it
// This should be done through the UI by switching contexts quickly
```

## Performance Metrics

Monitor these metrics during testing:
1. **Stream Latency**: Time from request to first chunk
2. **Chunk Frequency**: Should see chunks every ~50ms during active streaming
3. **Memory Usage**: Should remain stable during long streams
4. **CPU Usage**: Should not spike excessively during streaming

## Regression Tests

Ensure these existing features still work:
1. [ ] Chat history loads correctly
2. [ ] Search results display properly
3. [ ] Notebook creation/deletion works
4. [ ] URL opening functions correctly
5. [ ] Tool calls execute properly
6. [ ] Activity logging continues to work

## Notes for Testers

1. **Buffer Behavior**: You should see text appear in small chunks (multiple words at once) rather than character by character due to the 50ms buffer.

2. **Stream IDs**: Each stream has a unique correlation ID visible in logs for debugging.

3. **Error Recovery**: The system should recover gracefully from all error conditions without requiring app restart.

4. **Service Health**: Run health checks to ensure all services initialized properly.

## Automated Test Ideas (Future)

1. Unit tests for StreamManager buffer logic
2. Integration tests for ChatService streaming
3. E2E tests for full streaming flow
4. Performance benchmarks for stream processing
5. Load tests with multiple concurrent streams