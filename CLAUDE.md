# Jeffers Codebase Instructions

## Project Overview
Jeffers is an Electron + Next.js desktop application with AI capabilities, using SQLite for data persistence and ChromaDB for vector storage.

## Tech Stack
- **Frontend**: Next.js 15.3.0, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Electron 35 with Node.js
- **Database**: SQLite (better-sqlite3) with migrations
- **Vector Store**: ChromaDB for embeddings
- **AI**: LangChain with OpenAI integration
- **State**: Zustand with IPC persistence
- **Testing**: Vitest with React Testing Library

## Architecture Patterns

### 1. Model-Service-Controller Pattern
- **Models** (`/models/`): Database operations only
- **Services** (`/services/`): Business logic
- **Controllers** (`/electron/ipc/`): IPC handlers
- **Components** (`/src/components/`): UI layer

### 2. IPC Communication
All communication between main and renderer processes uses typed IPC channels defined in `shared/ipcChannels.ts`.

## Code Conventions

### Naming Conventions
- **Models**: `*Model` (e.g., `ChatModel`, `ObjectModel`)
- **Services**: `*Service` (e.g., `ChatService`, `NotebookService`)
- **IPC Handlers**: `register*Handler` functions
- **React Components**: PascalCase with descriptive names
- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Database fields**: snake_case (mapped to camelCase in code)

### File Structure
```
/electron/         # Electron main process
  /ipc/           # IPC handlers (register*Handler pattern)
  /workers/       # Background workers
  main.ts         # Entry point

/src/             # Next.js frontend
  /app/           # App router pages
  /components/    # React components
    /ui/          # Reusable UI components
    /apps/        # Feature-specific components
  /hooks/         # Custom React hooks
  /store/         # Zustand stores

/models/          # Data models (SQLite)
  /migrations/    # SQL migration files

/services/        # Business logic
  /agents/        # AI agents

/shared/          # Shared between main/renderer
```

### TypeScript Rules
- **Always use strict mode**
- **Explicit type annotations required**
- **Interfaces for data structures**
- **Types for unions/primitives**
- **No `any` types**

### Database Patterns
```typescript
// Always use prepared statements
const stmt = this.db.prepare(`
  INSERT INTO table_name (id, field1, field2) 
  VALUES ($id, $field1, $field2)
`);

// Always use UUID v4 for IDs
const id = uuidv4();

// Always handle errors
try {
  stmt.run({ id, field1, field2 });
} catch (error) {
  logger.error("[ModelName] Error:", error);
  throw error;
}
```

### Service Pattern
```typescript
export class ServiceName {
  private dependency: DependencyType;
  
  constructor(dependency: DependencyType) {
    this.dependency = dependency;
    logger.info("[ServiceName] Initialized.");
  }
  
  async methodName(params: ParamType): Promise<ReturnType> {
    logger.debug("[ServiceName] methodName called", { params });
    try {
      // Implementation
    } catch (error) {
      logger.error("[ServiceName] methodName error:", error);
      throw error;
    }
  }
}
```

### IPC Handler Pattern
```typescript
export function registerHandlerName(
  ipcMain: IpcMain,
  service: ServiceType
) {
  ipcMain.handle(IPC_CHANNELS.CHANNEL_NAME, async (event, args) => {
    try {
      logger.debug("[HandlerName] Called with:", args);
      return await service.methodName(args);
    } catch (error) {
      logger.error("[HandlerName] Error:", error);
      throw error;
    }
  });
}
```

### React Component Pattern
```typescript
"use client"; // For client components

import { useState, useCallback } from "react";

interface ComponentProps {
  prop1: string;
  prop2?: number;
}

export function ComponentName({ prop1, prop2 = 0 }: ComponentProps) {
  const [state, setState] = useState<string>("");
  
  const handleAction = useCallback(() => {
    // Implementation
  }, [dependencies]);
  
  return (
    <div className="class-names">
      {/* Component JSX */}
    </div>
  );
}
```

### Zustand Store Pattern
```typescript
interface StoreState {
  data: DataType[];
  addItem: (item: DataType) => void;
  removeItem: (id: string) => void;
  _hasHydrated: boolean;
  _setHasHydrated: (status: boolean) => void;
}

export const createStoreFactory = () => {
  return create<StoreState>()(
    persist(
      (set) => ({
        data: [],
        addItem: (item) => set((state) => ({ 
          data: [...state.data, item] 
        })),
        removeItem: (id) => set((state) => ({ 
          data: state.data.filter(item => item.id !== id) 
        })),
        _hasHydrated: false,
        _setHasHydrated: (status) => set({ _hasHydrated: status }),
      }),
      {
        name: 'store-name',
        storage: createIPCStorage(),
      }
    )
  );
};
```

## Testing Patterns
```typescript
describe('ComponentName', () => {
  let db: Database;
  
  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db);
  });
  
  afterEach(() => {
    db.close();
  });
  
  it('should do something', async () => {
    // Arrange
    const model = new ModelName(db);
    
    // Act
    const result = await model.methodName();
    
    // Assert
    expect(result).toBeDefined();
  });
});
```

## Important Rules

### 1. Logging
- **Always use logger with context**: `logger.info("[ServiceName] message")`
- **Log levels**: `error`, `warn`, `info`, `debug`
- **Log errors with full context**
- **Never log sensitive data**

### 2. Error Handling
- **Always wrap async operations in try-catch**
- **Throw meaningful errors**
- **Log errors before re-throwing**
- **Provide user-friendly error messages**

### 3. Database
- **Always use prepared statements**
- **Always use transactions for multiple operations**
- **Always run migrations on startup**
- **Never use raw SQL interpolation**

### 4. IPC Security
- **Only use defined channels from `shared/ipcChannels.ts`**
- **Validate all input from renderer**
- **Never expose sensitive operations directly**

### 5. State Management
- **Use Zustand factories for window-specific stores**
- **Always handle hydration race conditions**
- **Debounce persistence operations (750ms default)**

### 6. Performance
- **Stream AI responses using async generators**
- **Debounce expensive operations**
- **Use pagination for large datasets**
- **Lazy load components when possible**

## Environment Variables

### Required
- `OPENAI_API_KEY` - OpenAI API key for LLM and embeddings
- `CHROMA_URL` - ChromaDB server URL (default: http://localhost:8000)

### Optional
- `EXA_API_KEY` - Exa.ai API key for enhanced web search capabilities
  - Without this key, search will fall back to local vector database only
  - Get your key at https://exa.ai

## Common Commands

### Development
```bash
npm run dev          # Start development server
npm run electron:dev # Start Electron in dev mode
```

### Testing
```bash
npm test            # Run all tests
npm run test:watch  # Run tests in watch mode
```

### Linting & Type Checking
```bash
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript compiler check
```

### Building
```bash
npm run build       # Build Next.js
npm run electron:build # Build Electron app
```

## DO NOT
- Create files unless absolutely necessary
- Create documentation files unless explicitly requested
- Use `any` types
- Log sensitive information
- Use raw SQL interpolation
- Expose IPC channels without validation
- Forget to handle errors
- Skip logging important operations
- Mix database logic with business logic
- Put business logic in components

## ALWAYS
- Use TypeScript strict mode
- Follow existing patterns exactly
- Use prepared statements for database
- Log with context prefixes
- Handle errors gracefully
- Test with in-memory SQLite
- Use IPC channels from shared constants
- Stream AI responses
- Validate user input
- Check for existing implementations before creating new ones