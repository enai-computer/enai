# Enai Codebase Instructions
You are from California. We are both from California, and are based in San Francisco.

## Project Overview
Enai is an Electron + Next.js desktop application with AI capabilities, using SQLite for data persistence and LanceDB for vector storage. It features advanced content ingestion, PDF processing, web scraping, and intelligent search capabilities with personalized AI interactions.

## Tech Stack
- **Frontend**: Next.js 15.3.0, React 19.0.0, TypeScript, Tailwind CSS 4.1.4
- **Backend**: Electron 35.1.5 with Node.js
- **Database**: SQLite (better-sqlite3 11.9.1) with migrations
- **Vector Store**: LanceDB (embedded vector database)
- **AI**: LangChain with OpenAI integration (direct model instantiation via `utils/llm.ts`)
  - **Model Usage by Service**:
    - `AgentService`: gpt-4.1 (general tasks), gpt-4o (reasoning/tools)
    - `ProfileAgent`: gpt-4o (profile synthesis)
    - `IngestionAIService`: gpt-4.1-nano (chunking/summarization)
    - `ActionSuggestionService`: o1-mini (UI suggestions)
    - `LangchainAgent`: gpt-4o-mini (rephrasing), gpt-4o (answers)
    - `LanceVectorModel`: text-embedding-3-small (embeddings)
- **State**: Zustand 5.0.4 with IPC persistence
- **Testing**: Vitest 3.1.2 with React Testing Library
- **Component Development**: Storybook 9.0.4
- **Code Quality**: ESLint + Prettier + Husky with lint-staged
- **Utilities**: uuid 11.1.0

### Additional Integrations
- **Web Scraping**: Browserbase SDK (`@browserbasehq/sdk`)
- **PDF Processing**: PDF.js (`pdfjs-dist`)
- **Web Automation**: Puppeteer
- **Content Extraction**: Mozilla Readability (`@mozilla/readability`)

## Architecture Patterns

### 1. Model-Service-Controller Pattern
- **Models** (`/models/`): Database operations only
- **Services** (`/services/`): Business logic
- **Controllers** (`/electron/ipc/`): IPC handlers
- **Components** (`/src/components/`): UI layer

### 2. IPC Communication & Security

#### Preload Bridge Pattern
The application uses a secure preload bridge (`electron/preload.ts`) with strict security settings:
```typescript
// Security configuration:
contextIsolation: true    // Renderer runs in isolated context
sandbox: true            // Renderer runs in OS sandbox
nodeIntegration: false   // No Node.js in renderer
webviewTag: false        // No webview tags
```

The preload script exposes a typed `window.api` object that serves as the only communication channel between renderer and main process:
```typescript
window.api = {
  // All IPC methods are exposed through this typed API
  chat: { send, stream, getHistory },
  objects: { search, get, create },
  notebooks: { create, update, delete },
  // ... etc
}
```

**Security Rule**: ALL renderer→main communication MUST go through `window.api`. Direct IPC access is forbidden.

### 3. Type System Organization
Types are organized by domain in `/shared/types/`:
- **Core types**: `object.types.ts`, `chunk.types.ts`
- **Domain types**: `chat.types.ts`, `notebook.types.ts`, `notes.types.ts`, `search.types.ts`, `profile.types.ts`, `todo.types.ts`, `ingestion.types.ts`
- **UI types**: `window.types.ts`, `intent.types.ts`
- **API types**: `api.types.ts`
- **Storage types**: `store.types.ts`
- **Central export**: `index.ts` - All types re-exported for backward compatibility

Schemas for data validation are defined in `/shared/schemas/`:
- `aiSchemas.ts` - AI-related data structures
- `chatSchemas.ts` - Chat message validation
- `pdfSchemas.ts` - PDF document schemas
- `profileSchemas.ts` - User profile validation

### 4. Ingestion Pipeline Architecture
The ingestion system uses a worker-based pattern:
```
BaseIngestionWorker (abstract)
├── UrlIngestionWorker - Web content ingestion
└── PdfIngestionWorker - PDF document ingestion

Supporting Services:
- IngestionQueueService - Job queue management
- IngestionAIService - AI-powered content processing
- ChunkingService - Content chunking strategies
```

### 5. Background Workers
Background processing in `/electron/workers/`:
- `readabilityWorker.ts` - Content extraction worker

### 6. Hybrid Search Architecture

The search system implements a sophisticated multi-stage flow:

```
1. HybridSearchService.search() triggered
   ↓
2. Local vector search (LanceDB)
   - Query embeddings generated
   - Similarity search in local vectors
   - Returns initial results
   ↓
3. Exa search (if EXA_API_KEY present)
   - Parallel web search via ExaService
   - Fallback: skip if no API key
   ↓
4. Result merging & ranking
   - Deduplication by URL/content
   - Score normalization
   - Re-ranking by relevance + recency
   ↓
5. SearchResultFormatter
   - Unified result format
   - Snippet generation
   - Metadata enrichment
```

**Fallback behavior**: If Exa fails or is disabled, system returns local-only results.

### 7. Vector Storage Architecture

The vector database (LanceDB) implements a multi-layered cognitive architecture for storing embeddings:

#### Cognitive Layers
- **INS (Intent Stream)**: Not embedded - represents user intents and interactions
- **WOM (Working Memory)**: Embedded - temporary/active content (tabs, recent objects)
- **LOM (Long Term Memory)**: Embedded - persistent knowledge (documents, chunks)
- **OM (Ontological Model)**: Not embedded - conceptual relationships

#### Record Types & Media Types
Every vector record has two classification dimensions:

1. **`recordType: 'object' | 'chunk'`**
   - `'object'`: Whole things (complete webpage, PDF, notebook, tab group)
   - `'chunk'`: Parts of things (section of webpage, PDF page, etc.)

2. **`mediaType`**: The kind of content
   - `'webpage'`, `'pdf'`, `'notebook'`, `'tab_group'`, `'image'`, etc.

#### Embedding Strategy
- **Objects at WOM layer**: Whole documents/tabs for working memory search
- **Objects at LOM layer**: Document summaries for long-term retrieval
- **Chunks at LOM layer**: Document sections for detailed search

#### Search Result Deduplication
To prevent flooding results with multiple chunks from the same document:
- Never return multiple chunks from the same `objectId`
- Options: return whole object only, specific chunk only, or object + most relevant chunk
- Filter by `recordType` to control whether searching objects, chunks, or both

#### Schema Details
See `/shared/types/vector.types.ts` for the complete type definitions. Key fields:
- `id`: UUID for each vector record
- `objectId`: Reference to the parent object
- `sqlChunkId`: Reference to chunk (if `recordType === 'chunk'`)
- `layer`: Cognitive layer placement
- `processingDepth`: 'title' | 'summary' | 'chunk'
- `mediaType`: Same as `JeffersObject.objectType` - renamed for clarity in vector context

### 8. AI & Personalization Architecture

#### Profile System
- **ProfileService**: Manages user preferences, goals, expertise areas
- **ProfileAgent**: LangChain agent that analyzes user behavior to update profile
- **Activity synthesis**: Periodic background job that updates profile based on usage

#### Intent System
- **IntentService**: Classifies user queries into actionable intents
- **Intent routing**: Maps intents to appropriate handlers/agents
- **Context awareness**: Uses profile + recent activity for better classification

#### Prompt Template Pattern
All LangChain agents use a standardized prompt skeleton:
```typescript
const systemPrompt = `
You are an AI assistant with the following context:

User Profile:
{userProfile}

Search Context:
{searchContext}

Recent Chat History:
{chatHistory}

[Agent-specific instructions here]
`;
```

This pattern ensures consistent context injection across all AI features.

### 9. Standardized Service Architecture

The service layer follows a standardized architecture with dependency injection, lifecycle management, and consistent patterns.

#### Service Dependencies Documentation
When creating service interfaces, document dependencies using JSDoc:
```typescript
/**
 * Manages conversation state and chat history
 * @requires NotebookService - for associating conversations with notebooks
 * @requires ChatModel - for persisting messages
 */
interface ConversationServiceDeps {
  db: Database.Database;
  chatModel: ChatModel;
  notebookService: NotebookService;
}
```

#### Core Service Dependencies
- **ConversationService**: ChatModel, NotebookService
- **LLMClient**: ProfileService, ConversationService
- **SearchService**: HybridSearchService, SliceService, SearchResultFormatter
- **ToolService**: NotebookService, ProfileService, ObjectService, HybridSearchService, SearchService, ToDoService, ConversationService
- **NotebookService**: NotebookModel, ChatModel
- **ProfileService**: UserProfileModel, ActivityLogService
- **HybridSearchService**: LanceVectorModel, ExaService, EmbeddingModel, ObjectModel, ChunkModel, SearchResultFormatter

#### BaseService Pattern
All services extend a common base class:
```typescript
abstract class BaseService<TDeps = {}> {
  protected readonly deps: TDeps;
  protected readonly logger: Logger;
  protected readonly serviceName: string;

  constructor(serviceName: string, deps: TDeps);

  // Lifecycle hooks (non-optional, default implementations provided)
  async initialize(): Promise<void>;
  async cleanup(): Promise<void>;
  async healthCheck(): Promise<boolean>;

  // Utility methods
  protected async execute<T>(
    operation: string, 
    fn: () => Promise<T>,
    context?: Record<string, any>,
    options?: { trackPerformance?: boolean; correlationId?: string }
  ): Promise<T>;
  
  protected async transaction<T>(
    db: Database.Database,
    fn: () => T
  ): Promise<T>;

  // Logging helpers
  protected logInfo(message: string, ...args: any[]): void;
  protected logDebug(message: string, ...args: any[]): void;
  protected logWarn(message: string, ...args: any[]): void;
  protected logError(message: string, error?: any, ...args: any[]): void;
}
```

#### Dependency Injection Pattern
- All dependencies explicitly declared in constructor
- No internal service/model instantiation
- Clear dependency graph for testing and maintenance

#### Composition Root
All services are instantiated through the bootstrap system (`/electron/bootstrap/serviceBootstrap.ts`), which creates a `ServiceRegistry` that manages dependencies and ensures proper initialization order. The registry contains core services (e.g., `ActivityLogService`, `ProfileService`), feature services (e.g., `ChatService`, `NotebookService`), and browser services (e.g., `ClassicBrowserService`).

#### Service Lifecycle Management
Services implement lifecycle hooks for proper resource management:
- **initialize()**: Called after all services are constructed
- **cleanup()**: Called on application shutdown
- **healthCheck()**: Returns service health status

Critical cleanup examples:
- **ActivityLogService**: Flushes activity queue and clears timer
- **SchedulerService**: Clears all interval timers
- **ChatService**: Aborts active streams and cleans up stream map
- **ClassicBrowserService**: Destroys all WebContentsViews and prefetch views

#### Custom Error Types
Standardized error types in `/services/base/ServiceError.ts`:
- `ServiceError` (base class)
- `NotFoundError`
- `ValidationError`
- `AuthorizationError`
- `ExternalServiceError`
- `DatabaseError`



## Service Catalog

### Core Services

#### ActivityLogService
Tracks user interactions for analytics and profile building. Records:
- Page views, searches, chat interactions
- Time spent on content
- Feature usage patterns

#### AgentService
Orchestrates LangChain agents with tools for:
- Web search (via Exa)
- Local knowledge base queries
- File operations
- Task planning

#### ChatService
Manages chat sessions and streaming responses:
- Message persistence
- Stream handling with backpressure
- Context window management

#### ClassicBrowserService
Orchestrates browser functionality through a sophisticated sub-service architecture with event-driven communication. The main service coordinates multiple specialized sub-services, including:
- **BrowserEventBus**: Central event hub for inter-service communication.
- **ClassicBrowserViewManager**: Manages WebContentsView lifecycle and operations.
- **ClassicBrowserStateService**: Manages browser state and IPC communication.
- **ClassicBrowserNavigationService**: Handles navigation logic and URL loading.
- **ClassicBrowserTabService**: Manages tab operations (create, switch, close).
- **ClassicBrowserWOMService**: Integrates with Working Memory for tab persistence.
- **ClassicBrowserSnapshotService**: Captures and manages browser view screenshots.

#### HybridSearchService
Orchestrates multi-source search (see Hybrid Search Architecture above)

#### NotebookService
Manages notebook CRUD operations and AI-powered features:
- Auto-summarization
- Topic extraction
- Cover image generation

#### ProfileService
User profile management with:
- Goal tracking (including time-bound goals)
- Expertise area detection
- Preference learning

#### SchedulerService
Manages periodic background jobs:
- Profile synthesis (every `CONTENT_SYNTHESIS_INTERVAL_MS`)
- Activity aggregation (every `ACTIVITY_SYNTHESIS_INTERVAL_MS`)
- Cleanup tasks

#### SliceService
Extracts and manages content "slices":
- Smart excerpt generation
- Context preservation
- Relevance scoring

#### SearchResultFormatter
Standardizes search results from multiple sources into unified format

#### ActionSuggestionService
Provides contextual UI action suggestions using AI:
- Analyzes user context and recent activity
- Suggests relevant actions based on current state
- Uses o1-mini model for intelligent suggestions

#### LLMClient
Core AI client that manages LLM interactions:
- Handles conversation context and history
- Integrates user profile for personalized responses
- Supports streaming and non-streaming modes
- Uses gpt-4o model

#### ObjectService
Manages CRUD operations for all content objects:
- Handles object creation, retrieval, updates, and deletion
- Manages object associations and relationships
- Integrates with vector embeddings for search

#### ToDoService
Task management service:
- CRUD operations for todo items
- Task status tracking and completion
- Integration with activity logging

#### ToolService
Provides LangChain tools for AI agents:
- Search tools (local and web)
- Notebook management tools
- Profile and preference tools
- Task management tools

## Code Conventions

### Naming Conventions
- **Models**: `*Model` (e.g., `ChatModel`, `ObjectModel`, `ChunkModel`)
- **Services**: `*Service` (e.g., `ChatService`, `SliceService`, `IngestionQueueService`)
- **Workers**: `*Worker` (e.g., `UrlIngestionWorker`, `PdfIngestionWorker`)
- **IPC Handlers**: `register*Handler` functions
- **React Components**: PascalCase with descriptive names
- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Database fields**: snake_case (mapped to camelCase in code)

### File Structure
```
/electron/              # Electron main process
  /bootstrap/          # Application bootstrap
    initServices.ts    # Service composition root
  /ipc/                # IPC handlers (register*Handler pattern)
    activityLogHandlers.ts
    bookmarks.ts
    chatSessionHandlers.ts
    chatStreamHandler.ts
    classicBrowser*.ts # Browser control handlers
    debugHandlers.ts
    notebookHandlers.ts
    objectHandlers.ts
    pdfIngestionHandler.ts
    ...
  /workers/            # Background workers
  main.ts              # Entry point

/src/                  # Next.js frontend
  /app/                # App router pages
  /components/         # React components
    /ui/               # Reusable UI components
    /apps/             # Feature-specific components
      /chat/
      /classic-browser/
      /web-layer/
  /hooks/              # Custom React hooks
  /store/              # Zustand stores

/models/               # Data models (SQLite)
  /migrations/         # SQL migration files (5 migrations: 0000-0004)
  ActivityLogModel.ts
  ChatModel.ts
  LanceVectorModel.ts
  ChunkModel.ts
  EmbeddingModel.ts
  IngestionJobModel.ts
  NotebookModel.ts
  ObjectModel.ts
  ToDoModel.ts
  UserProfileModel.ts

/services/             # Business logic
  /_tests/             # Service tests
    ProfileService.spec.ts
  /base/               # Base service infrastructure
    BaseService.ts     # Abstract base service class
    ServiceError.ts    # Custom error types
  /interfaces/         # Service interfaces
    index.ts           # IService and dependency types
  /agents/             # AI agents
    /tools/            # Agent tools
  /ingestion/          # Ingestion services
    BaseIngestionWorker.ts
    ChunkingService.ts
    IngestionAIService.ts
    IngestionQueueService.ts
    PdfIngestionService.ts
    PdfIngestionWorker.ts
    UrlIngestionWorker.ts
  ActivityLogService.ts
  AgentService.ts
  CanaryService.ts      # Test service for validating base infrastructure
  ChatService.ts
  ClassicBrowserService.ts
  ExaService.ts
  HybridSearchService.ts
  IntentService.ts
  NotebookService.ts
  ProfileService.ts
  SchedulerService.ts
  SearchResultFormatter.ts
  SliceService.ts
  ToDoService.ts

/shared/               # Shared between main/renderer
  /schemas/            # Data validation schemas
  /types/              # Domain-based type definitions
    index.ts           # Central export point
    api.types.ts       # API-related types
    chat.types.ts      # Chat domain types
    chunk.types.ts     # Chunk-related types
    ingestion.types.ts # Ingestion types
    intent.types.ts    # Intent classification types
    notebook.types.ts  # Notebook types
    notes.types.ts     # Note-related types
    object.types.ts    # Core object types
    profile.types.ts   # User profile types
    search.types.ts    # Search-related types
    store.types.ts     # Storage types
    todo.types.ts      # Todo types
    window.types.ts    # Window management types
  ipcChannels.ts
  types.d.ts           # (Legacy, being phased out)

/ingestion/            # Ingestion utilities
  /clean/              # Text cleaning utilities
  /fetch/              # Content fetching
    browserbaseFetch.ts
    fetchMethod.ts
    pageFetcher.ts
  /parsers/            # Content parsers
    chromeHtml.ts
    firefoxJson.ts
    safariHtml.ts

/utils/                # Utilities
  /cli/                # CLI tools
    rebuildBetterSqlite3.ts
    resetEmbeddings.ts
  logger.ts
  performanceTracker.ts
  startupChecks.ts
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

### Service Pattern (Updated)
```typescript
// Define dependency interface
interface ServiceNameDeps {
  db: Database;
  modelA: ModelA;
  serviceB: ServiceB;
}

// Extend BaseService with typed dependencies
export class ServiceName extends BaseService<ServiceNameDeps> {
  constructor(deps: ServiceNameDeps) {
    super('ServiceName', deps);
  }
  
  // Optional lifecycle hooks
  async initialize(): Promise<void> {
    // Setup code if needed
  }
  
  async cleanup(): Promise<void> {
    // Cleanup resources (timers, connections, queues)
  }
  
  // Use execute wrapper for consistent error handling
  async methodName(params: ParamType): Promise<ReturnType> {
    return this.execute('methodName', async () => {
      // Implementation
      return result;
    });
  }
  
  // Use withTransaction for database operations
  async transactionalMethod(data: DataType): Promise<void> {
    return this.withTransaction(async (tx) => {
      // Multiple database operations in transaction
    });
  }
}
```

### Legacy Service Pattern
Legacy services do not extend BaseService, store dependencies as private properties, use manual logger calls with `[ServiceName]` prefixes, lack lifecycle hooks (initialize/cleanup), and handle errors without the execute() wrapper. Avoid these patterns in new code - always extend BaseService instead.

### Critical API Gotchas

#### Model Method Signatures
**ObjectModelCore** methods have specific async/sync behaviors that often trip up tests:
- `create()` - **ASYNC**, returns `Promise<JeffersObject>`, generates its own UUID
- `createSync()` - **SYNC**, returns `JeffersObject`, for use in transactions
- `getById()` - **ASYNC**, returns `Promise<JeffersObject | null>`
- `update()` - **ASYNC**, returns `Promise<void>`
- `deleteById()` - **SYNC**, returns `void`

**Common test failures:**
- Calling `create()` without `await` → returns undefined
- Passing `id` to `create()` → ignored, UUID auto-generated
- Using `createSync()` outside transaction → works but inconsistent

#### Service Dependencies
Services receive dependencies via constructor injection, not factory methods:
```typescript
// WRONG - tests often mock this incorrectly
const llm = getModel('gpt-4o');  

// RIGHT - service receives instance directly
constructor(deps: { llm: BaseChatModel }) {
  super('ServiceName', deps);
}
```

#### Hidden Business Rules
Some services have non-obvious requirements that cause tests to fail silently:
- **CompositeObjectEnrichmentService**: Requires MIN_CHILDREN_FOR_AUTO_ENRICH (3) children or skips enrichment
- **Vector operations**: May require actual vector DB running, mock appropriately
- **Debounced operations**: Default delays (e.g., 5000ms) require test timeouts

### Worker Pattern
```typescript
export abstract class BaseWorker {
  abstract process(job: JobType): Promise<ResultType>;
  
  protected async handleError(error: Error): Promise<void> {
    logger.error(`[${this.constructor.name}] Error:`, error);
    // Error handling logic
  }
}

export class SpecificWorker extends BaseWorker {
  async process(job: JobType): Promise<ResultType> {
    try {
      // Implementation
    } catch (error) {
      await this.handleError(error);
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

### Custom Error Types
```typescript
export class BrowserbaseRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserbaseRateLimitError';
  }
}
```
Similar error types: `BrowserbaseAuthError`, `TimeoutError`, `ConnectionError`, `EmptyResultError`

### Classic Browser Security Pattern
```typescript
// BrowserView creation with security flags
const view = new BrowserView({
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    // Custom cookie policy
    partition: `persist:browser-${windowId}`
  }
});

// URL filtering for ad-blocking
const blockedPatterns = [
  '*://*.doubleclick.net/*',
  '*://*.googleadservices.com/*',
  // ... more patterns
];
```

## Testing Patterns

### Testing Principles

Tests are written for AI agents to understand behavior and verify changes. Keep them simple and clear.

#### Core Guidelines
- **Test behavior, not implementation** - Focus on what the code does, not how
- **80/20 rule** - Test the critical paths thoroughly, edge cases sparingly
- **One concept per test** - Each test should verify exactly one behavior
- **Descriptive names** - `it('should return existing session for returning sender')` not `it('works')`
- **Minimal mocking** - Prefer in-memory databases and real implementations over mocks

#### Test Structure
```typescript
describe('ServiceName', () => {
  // Shared setup - keep it minimal
  let service: ServiceName;
  beforeEach(() => { /* only essential setup */ });

  describe('methodName', () => {
    it('should handle normal case', () => {
      // Arrange: Set up test data (1-3 lines)
      // Act: Call the method (1 line)
      // Assert: Verify outcome (1-2 lines)
    });

    it('should throw on invalid input', () => {
      // Test one specific error condition
    });
  });
});
```

#### What to Test
- **Public API** - All public methods and their contracts
- **Critical paths** - Core business logic and user journeys
- **Error handling** - What errors are thrown and when
- **Edge cases** - Only those that would cause real issues

#### What NOT to Test
- Private methods (test through public API)
- Framework functionality
- Simple getters/setters
- Implementation details that might change

#### Remember
Tests are executable documentation. If an AI can't understand what your code does by reading the tests, the tests need improvement.

#### File Structure
- **Tests in `_tests/` directories** - Tests should be in their own directory adjacent to production code
- **Use `.test` naming convention** - All test files should end with `.test.ts` or `.test.tsx` (not `.spec`)
- **Match source file names** - Test files should match the name of the file they test

### Testing Stack
- **Framework**: Vitest 3.1.2
- **React Testing**: @testing-library/react with jest-dom matchers
- **Setup Files**: `test-setup/electron-mocks.ts`, `.storybook/vitest.setup.ts`

### Database Tests
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

### Testing Configuration
- **Test timeout**: 900000ms (15 minutes)
- **Hook timeout**: 30000ms (30 seconds)
- **Workspace**: Configured via `vitest.workspace.ts`
- **Component testing**: Storybook integration

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
- **Use custom error types for external services**

### 3. Database
- **Always use prepared statements**
- **Always use transactions for multiple operations**
- **Always run migrations on startup**
- **Never use raw SQL interpolation**
- **Current schema version**: 5 migrations (0000-0004)
- **Note**: Models use async signatures with synchronous better-sqlite3 (intentional pattern)
- **Transaction callbacks must be synchronous** - avoid async/await inside `db.transaction()`
- **Timestamp Standard**: All timestamps in the database should be stored as TEXT in ISO 8601 UTC format with explicit .000 milliseconds
  - Use `new Date().toISOString()` in JavaScript (returns "2024-01-16T10:30:00.000Z")
  - For SQLite defaults, use `strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')` (note: .000 not %f)
  - Always include exactly 3 decimal places for milliseconds (.000)
  - Always include the 'Z' suffix to indicate UTC
  - SQLite stores these as TEXT but understands the format for date functions
  - This ensures perfect consistency between JavaScript and SQLite timestamps
  - This standard applies to all `created_at`, `updated_at`, `completed_at`, etc. fields

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
- **Use background workers for heavy processing**

### 7. Content Ingestion
- **Use appropriate worker for content type**
- **Implement chunking strategies based on content**
- **Handle rate limits and retries**
- **Validate content before processing**

### 8. Security
- **All renderer communication through `window.api`**
- **Validate all IPC inputs**
- **Use strict CSP in BrowserViews**
- **Sanitize all user-generated content**

### 9. Service Architecture
- **Extend BaseService for all new services**
- **Use dependency injection - no internal instantiation**
- **Implement cleanup() for services with resources**
- **Use execute() wrapper for error handling**
- **Initialize services through composition root**
- **No singleton patterns - use ServiceRegistry**

## Environment Variables

### Required
- `OPENAI_API_KEY` - OpenAI API key for LLM and embeddings

### Optional - External Services
- `EXA_API_KEY` - Exa.ai API key for enhanced web search capabilities
  - Without this key, search will fall back to local vector database only
  - Get your key at https://exa.ai
- `BROWSERBASE_API_KEY` - Browserbase API key for web scraping
- `BROWSERBASE_PROJECT_ID` - Browserbase project ID

### Optional - Configuration
- `ENAI_DB_PATH` - Path to SQLite database (default: /Users/currandwyer/Library/Application Support/src/enai.db)
- `EXA_SEARCH_ENABLED` - Enable/disable Exa search (feature flag)
- `EXA_RESULTS_LIMIT` - Maximum results from Exa search
- `CONTENT_SYNTHESIS_INTERVAL_MS` - Profile content synthesis interval (default: 3600000)
- `ACTIVITY_SYNTHESIS_INTERVAL_MS` - Activity synthesis interval (default: 1800000)

### Optional - Development
- `LOG_LEVEL` - Logging verbosity: error | warn | info | debug (default: info)
- `PERFORMANCE_TRACKING` - Enable performance metrics (default: false)

## Common Commands

### Development
```bash
npm run dev          # Start development server
npm run electron:dev # Start Electron in dev mode
npm run storybook    # Start Storybook for component development
```

### Testing
```bash
npm test            # Run all tests
npm run test:watch  # Run tests in watch mode
```

### Code Quality
```bash
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript compiler check
npm run prettier    # Format code
```

### Pre-commit Hooks
Husky runs automatically on commit:
1. ESLint checks modified files
2. Prettier formats staged files
3. TypeScript compilation check
4. Tests run for changed modules

To bypass (emergency only): `git commit --no-verify`

### Building
```bash
npm run build       # Build Next.js
npm run electron:build # Build Electron app
npm run package     # Package Electron app
npm run make        # Build distributables
```

### Release Pipeline
```bash
# macOS release with notarization
npm run make:mac    # Builds and signs
npm run notarize    # Submits to Apple (requires certs)

# Windows/Linux
npm run make:win
npm run make:linux
```

**Note**: Release builds require code signing certificates configured in `forge.config.js`.

### Utilities
```bash
npm run rebuild:electron        # Rebuild native modules
npm run cli:reset-embeddings    # Reset all embeddings
```

You will see `NODE_MODULE_VERSION` errors when running tests that use native modules (particularly better-sqlite3 in database-related tests). This happens because:
- Tests use better-sqlite3 which contains compiled C++ code
- The compiled code must match your current Node.js version
- This error commonly appears after: switching Node versions, pulling new code, or updating dependencies

**Before running any tests involving SQLite/database operations**, proactively run:
```bash
npm rebuild better-sqlite3
# or for all native modules:
npm run rebuild:electron
```

**Quick diagnosis**: If you see an error like "was compiled against NODE_MODULE_VERSION X but this version requires Y", immediately run `npm rebuild better-sqlite3` before investigating other causes.

## Performance & Debugging

### Performance Tracking
When `PERFORMANCE_TRACKING=true`, the app logs:
- IPC call durations
- Database query times
- AI response latencies
- Memory usage snapshots

Access via: `utils/performanceTracker.ts`

### Debug Logging
Set `LOG_LEVEL=debug` to see:
- All IPC communications
- SQL queries (sanitized)
- AI prompt/response pairs
- State mutations

## Font System
The application uses custom fonts:
- **Soehne**: Primary UI font (buch, leicht, kraftig, dreiviertelfett)
- **Signifier**: Display font (thin through bold, with italics)

Fonts are loaded via `/public/fonts/` and configured in Tailwind.

## UX Architecture

- **app/page.tsx** - The notebook cover and starting point, where you tell your computer what you're trying to do
- **app/notebook/[notebookId]/page.tsx** - The notebook. A contextual computing environment where most work gets done. Notebooks help users stay organized, switch context quickly (by switching notebooks), and build knowledge on various topics
- **ClassicBrowser** - An embedded browser to enable classic web browsing (still an important use case)
- **IntentLine** - Where the user sets their intent - exists in both notebook cover and notebook variants

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
- Ignore rate limits on external services
- Process large files synchronously
- Access IPC directly from renderer (use window.api)
- Disable security flags in BrowserViews
- **Implement backward compatibility unless explicitly required**
  - When formats change, update all code to use the new format
  - Remove old code paths instead of supporting both
  - Example: If LLM output format changes, fix the root cause rather than handling multiple formats
- **Add unnecessary code to support multiple versions**
  - Ship the minimal code that solves the problem
  - Choose one clear approach over multiple options
  - Complexity is a bigger risk than breaking changes

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
- Use appropriate workers for background tasks
- Implement proper chunking for large content
- Handle external service errors with custom error types
- Route all renderer IPC through window.api
- Apply security headers to BrowserViews
- Run code quality checks before committing
- **ASK AND EXPLAIN before implementing new features or architectural changes**
  - When identifying potential improvements (like consolidating duplicate code)
  - Before creating new services, utilities, or abstractions
  - When proposing architectural changes
  - Always explain the benefits, risks, and implementation approach first

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.