# TabBar Plus Icon Test Plan

## Test Objective
Verify that the plus icon in the TabBar component never overlaps with tabs and maintains proper positioning.

## Current Implementation (from TabBar.tsx)
The plus icon is implemented as follows:
- Located inside the scrollable container after all tabs
- Wrapped in a div with classes: `relative inline-flex items-start pl-2 h-9 pt-1.5`
- The `pl-2` class provides left padding to ensure spacing from the last tab
- Being inside the scrollable container means it scrolls with the tabs

## Test Cases

### 1. Plus Icon Position After Tabs
**Expected**: The plus icon container should always be the last child in the scrollable container
**Verification**: 
- Count children in `.inline-flex.items-start.overflow-x-auto`
- Verify last child contains the plus button
- Verify all previous children are tab elements

### 2. Spacing Between Last Tab and Plus Icon
**Expected**: The plus icon container has `pl-2` class for left padding
**Verification**: Check that the plus button container has the `pl-2` class

### 3. Plus Icon in Scrollable Area
**Expected**: With many tabs, the plus icon remains in the scrollable container
**Verification**: 
- Create 20+ tabs
- Verify plus icon is still the last child
- Verify it's not positioned absolutely or outside the container

### 4. Single Tab Behavior
**Expected**: Tab bar doesn't render when only one tab exists
**Verification**: Render with single tab and verify no DOM output

## Manual Testing Steps

1. Open a ClassicBrowser window
2. Add multiple tabs (use the + button repeatedly)
3. Verify:
   - Plus icon never overlaps with any tab
   - Plus icon maintains consistent spacing from the last tab
   - When tabs overflow and scrolling is needed, the plus icon scrolls with them
   - Plus icon is always accessible at the end of the tab list

## Implementation Details
The key to preventing overlap is:
1. Plus icon is a sibling of tabs (not absolutely positioned)
2. Uses `inline-flex` display to flow naturally after tabs
3. Has explicit padding (`pl-2`) to maintain spacing
4. Is contained within the same scrollable parent as tabs

This design ensures the plus icon follows normal document flow and cannot overlap with tabs.