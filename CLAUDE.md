# Jeffers Codebase Instructions

## Project Overview
Jeffers is an Electron + Next.js desktop application with AI capabilities, using SQLite for data persistence and LanceDB for vector storage. It features advanced content ingestion, PDF processing, web scraping, and intelligent search capabilities with personalized AI interactions.

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

### 7. AI & Personalization Architecture

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

### 8. Standardized Service Architecture

The service layer follows a standardized architecture with dependency injection, lifecycle management, and consistent patterns.

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
All services are instantiated in a single location (`/electron/bootstrap/initServices.ts`):
```typescript
interface ServiceRegistry {
  // Core services
  activityLog: ActivityLogService;
  profile: ProfileService;
  todo: ToDoService;
  
  // Feature services
  chat: ChatService;
  notebook: NotebookService;
  agent: AgentService;
  
  // ... all other services
}
```

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

#### Service Interfaces
Located in `/services/interfaces/`:
- `IService` - Base service interface with lifecycle methods
- `BaseServiceDependencies` - Common dependencies (db)
- `VectorServiceDependencies` - For services needing LanceDB
- `ServiceConfig` - Configuration for service initialization
- `ServiceMetadata`, `ServiceInstance` - Service registration types
- `ServiceHealthResult`, `ServiceInitResult` - Status types

#### Service Architecture Status
All services have been successfully refactored to extend BaseService with proper dependency injection, lifecycle management, and standardized patterns. The singleton pattern has been completely eliminated from the codebase.

The application uses a comprehensive bootstrap system (`/electron/bootstrap/serviceBootstrap.ts`) that initializes all services in dependency order with proper error handling and health checks.

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
Controls embedded BrowserView instances with:
- Security flags: `sameSite: 'strict'`, CSP headers
- Ad-blocking via URL patterns
- Cookie isolation per window
- Emits: `ON_CLASSIC_BROWSER_STATE`, `ON_CLASSIC_BROWSER_NAVIGATE`

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
  /migrations/         # SQL migration files (22 migrations)
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

### Legacy Service Pattern (To be refactored)
```typescript
// Old pattern - avoid in new code
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
// For external service errors
export class BrowserbaseRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserbaseRateLimitError';
  }
}

export class BrowserbaseAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserbaseAuthError';
  }
}

// Similar patterns for TimeoutError, ConnectionError, EmptyResultError
```

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
- **Current schema version**: 22 migrations
- **Note**: Models use async signatures with synchronous better-sqlite3 (intentional pattern)
- **Transaction callbacks must be synchronous** - avoid async/await inside `db.transaction()`

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
- `JEFFERS_DB_PATH` - Path to SQLite database (default: /Users/currandwyer/Library/Application Support/src/jeffers.db)
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

## UI Components

### Core UI Components (`/src/components/ui/`)
- **WindowControls**, **WindowFrame** - Electron window management
- **button**, **input**, **dialog**, **sheet** - Basic UI primitives
- **chat**, **chat-message**, **message-list** - Chat interface
- **audio-visualizer** - Audio recording visualization
- **file-preview** - File preview display
- **intent-line** - User intent display
- **slice-context** - Content slice visualization
- **markdown-renderer** - Markdown content display

### Feature Components (`/src/components/apps/`)
- **ChatWindow** - Main chat interface
- **ClassicBrowser** - Embedded browser
- **WebLayer** - Web content overlay

### Dialogs
- **AppSidebar** - Main navigation
- **BookmarkUploadDialog** - Bookmark import
- **PdfUploadDialog** - PDF upload interface

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