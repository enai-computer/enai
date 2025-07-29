# Investigation: Multi-WebContentsView Architecture for Window Management

## Problem Statement

Enai currently uses a single WebContentsView with a freeze/unfreeze mechanism to handle overlapping windows in our desktop environment. This approach has significant limitations:
- High latency when switching between tabs
- No true multitasking (background tabs are paused)
- Complex state management

We investigated whether using multiple WebContentsViews (one per tab/window) would solve these issues.

## Investigation Summary

### Key Findings

1. **WebContentsView Layering Limitations**
   - WebContentsViews ALWAYS render above HTML content, regardless of z-index
   - No native z-index API exists (the proposed `setTopWebContentsView` method doesn't exist)
   - Z-ordering requires remove/re-add operations: `win.contentView.removeChildView(view); win.contentView.addChildView(view);`

2. **Memory Impact**
   - Each WebContentsView spawns a separate renderer process
   - Memory cost per view: 80-100 MB (simple HTML) to 150-250 MB (complex websites)
   - 20 windows would consume 3-4 GB RAM (vs ~400 MB for current approach)

3. **Architectural Complexity**
   - Every window interaction requires IPC through main process
   - No direct state sharing between windows
   - Significant increase in development and debugging complexity

### Test Results

We created several test scripts to validate the approach:
- [`test_with_chrome.js`](./test_with_chrome.js) - Demonstrates that WebContentsViews render above all HTML UI elements
- [`test_websites.js`](./test_websites.js) - Shows z-order management with real websites
- [`test_process_memory.js`](./test_process_memory.js) - Detailed memory analysis per WebContentsView

## Proposed Solutions

### Option 1: Optimize Current Approach
Keep the single WebContentsView with freeze/unfreeze but optimize performance.

**Pros**: Memory efficient, simpler architecture  
**Cons**: No true multitasking, switching latency remains

### Option 2: Hybrid Approach
Use 3-5 WebContentsViews for "active" tabs with intelligent lifecycle management.

**Pros**: Partial multitasking, reasonable memory usage  
**Cons**: Complex lifecycle management

### Option 3: Full Multi-View Architecture
Make every UI element (tabs, notes, panels) its own WebContentsView.

**Pros**: True window layering and multitasking  
**Cons**: 5-10x memory usage, complex IPC architecture

## Recommendation

Given Electron's architectural limitations, the current freeze/unfreeze approach may be the most practical solution. The memory and complexity costs of a full multi-view architecture appear to outweigh the benefits for most use cases.

If true multitasking is critical, consider the hybrid approach with a limited number of active WebContentsViews.

## Related Files
- Test scripts in repository root: `test_*.js`
- Current implementation: `services/ClassicBrowserService.ts`

## Discussion Points
1. Is true multitasking a hard requirement for Enai?
2. What is our target memory budget?
3. Should we explore alternative frameworks better suited for desktop environments?