# Context API Refactoring Proposal

## Overview

This document outlines a refactoring strategy to eliminate extreme prop threading in the Jeffers codebase by implementing React Context API. This will reduce code complexity, improve maintainability, and align with the codebase philosophy of shipping minimal code.

## Problem Statement

The codebase currently exhibits several instances of extreme prop threading:

### 1. NotebookContent Component (15 props)
```typescript
// Current: Props threaded through multiple levels
NotebookView → NotebookContent → AppSidebar/IntentLine
```

Props being threaded:
- `windows`, `activeStore`, `notebookId`, `notebookTitle`
- `setNotebookTitle`, `onAddChat`, `onAddBrowser`, `onGoHome`
- `notebookIntentText`, `setNotebookIntentText`, `handleNotebookIntentSubmit`
- `isNotebookIntentProcessing`, `isReady`, `isIntentLineVisible`, `setIsIntentLineVisible`

### 2. Chat Component Hierarchy
```typescript
// Props threaded through 4+ levels
ChatWindow → Chat → ChatMessages → MessageList → ChatMessage
```

### 3. Excessive Spread Props
- `context-menu.tsx`: 15+ instances of `{...props}`
- `sidebar.tsx`: 20+ instances of `{...props}`
- `dialog.tsx`: 10+ instances of `{...props}`

## Proposed Solution

Implement Context API to share state directly between components without prop drilling.

### Implementation Strategy

#### Phase 1: Notebook Context
Create a context for notebook-related state and callbacks:

```typescript
// contexts/NotebookContext.tsx
interface NotebookContextValue {
  // State
  notebookId: string;
  notebookTitle: string;
  notebookIntentText: string;
  isNotebookIntentProcessing: boolean;
  isIntentLineVisible: boolean;
  
  // Actions
  setNotebookTitle: (title: string) => void;
  setNotebookIntentText: (text: string) => void;
  setIsIntentLineVisible: (visible: boolean) => void;
  handleNotebookIntentSubmit: () => void;
  onAddChat: () => void;
  onAddBrowser: () => void;
  onGoHome: () => void;
  
  // Window management
  windows: WindowItem[];
  activeStore: StoreApi<WindowStoreState>;
}

export const NotebookContext = createContext<NotebookContextValue | null>(null);

// Custom hook for type safety
export function useNotebook() {
  const context = useContext(NotebookContext);
  if (!context) {
    throw new Error('useNotebook must be used within NotebookProvider');
  }
  return context;
}
```

#### Phase 2: Chat Context
Create a context for chat-related state:

```typescript
// contexts/ChatContext.tsx
interface ChatContextValue {
  contextDetailsMap: Map<string, ContextDetails>;
  onLinkClick: (url: string) => void;
  // Additional chat-related props
}
```

#### Phase 3: Window Store Context
Consolidate window store state management:

```typescript
// contexts/WindowContext.tsx
interface WindowContextValue {
  activeStore: StoreApi<WindowStoreState>;
  contentGeometry: ContentGeometry;
  sidebarState: SidebarState;
  // Additional window-related state
}
```

## Expected Benefits

### Code Reduction
- **~200-300 lines** removed from prop declarations
- **~50%** reduction in component prop interfaces
- Elimination of intermediate prop passing

### Before/After Example
```typescript
// Before: 15 props
function NotebookContent({
  windows,
  activeStore,
  notebookId,
  notebookTitle,
  setNotebookTitle,
  onAddChat,
  onAddBrowser,
  onGoHome,
  notebookIntentText,
  setNotebookIntentText,
  handleNotebookIntentSubmit,
  isNotebookIntentProcessing,
  isReady,
  isIntentLineVisible,
  setIsIntentLineVisible,
}: NotebookContentProps) {
  // Component implementation
}

// After: Zero props needed
function NotebookContent() {
  const { notebookTitle, onAddChat } = useNotebook();
  // Component implementation
}
```

### Improved Developer Experience
- Cleaner component interfaces
- Easier to add new shared state
- Less refactoring when component hierarchy changes
- Better type safety with custom hooks

## Implementation Guidelines

### 1. Start with Highest Impact
Begin with NotebookView hierarchy (15 props) for immediate benefits.

### 2. Complete Refactoring
Following the codebase principle: "Ship minimal code that solves the problem"
- Remove all prop threading in affected components
- Don't maintain backward compatibility
- Delete old prop interfaces completely

### 3. Pattern for Context Creation
```typescript
// 1. Define context value interface
// 2. Create context with null default
// 3. Create provider component
// 4. Create custom hook with error handling
// 5. Export all from single file
```

### 4. Testing Considerations
- Wrap components in appropriate providers during tests
- Create test utilities for common provider setups
- Update existing tests to use context instead of props

## Migration Checklist

- [ ] Create NotebookContext and provider
- [ ] Refactor NotebookView to use provider
- [ ] Update NotebookContent to use context
- [ ] Update AppSidebar to use context
- [ ] Update IntentLine to use context
- [ ] Remove all related prop interfaces
- [ ] Update tests
- [ ] Create ChatContext and migrate chat components
- [ ] Create WindowContext and migrate window components
- [ ] Document context patterns in CLAUDE.md

## Success Metrics

- ✅ NotebookContent requires 0 props (down from 15)
- ✅ No props threaded more than 2 levels deep
- ✅ Reduced total lines of code
- ✅ All tests passing
- ✅ No backward compatibility code

## References

- [React Context API Documentation](https://react.dev/reference/react/createContext)
- Current prop threading examples: `src/components/NotebookView.tsx:397-411`