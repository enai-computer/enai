# Jeffers

Jeffers is an AI-powered desktop knowledge management application that combines natural language interfaces, web browsing, note-taking, and intelligent search into a unified workspace.

## Features

### AI-Powered Intelligence
- **Natural Language Commands**: Type commands like "create notebook about AI research" or "search news about climate change"
- **Smart AI Agent**: Powered by OpenAI GPT-4o and GPT-4.1-nano, understands context and executes complex tasks
- **Streaming Responses**: Real-time AI interactions with context awareness
- **User Profile Awareness**: AI remembers your goals, interests, and preferences
- **Time-Bound Goal Tracking**: Automatically captures and tracks goals with temporal context
- **Intent Recognition**: Intelligent routing of queries to appropriate handlers

### Knowledge Management
- **Notebook System**: Create and organize notebooks with AI-powered summarization and topic extraction
- **Multi-Window Workspace**: Drag-and-drop windows including chat, browser, and notebooks
- **Automatic Organization**: Content is automatically chunked, embedded, and indexed
- **PDF Support**: Import and process PDF documents with dedicated ingestion pipeline
- **Content Slicing**: Smart excerpt generation with context preservation

### Advanced Search
- **Hybrid Search**: Multi-stage search combining local vector embeddings with Exa.ai web results
- **News Aggregation**: Search across multiple news sources with intelligent deduplication
- **Fallback Handling**: Graceful degradation when external services unavailable
- **Result Ranking**: Relevance and recency-based scoring

### Integrated Browsing
- **Secure Browser**: Sandboxed BrowserView with strict security policies
- **Bookmark Import**: Import bookmarks from Chrome, Firefox, or Safari
- **Content Extraction**: Automatic extraction using Mozilla Readability
- **Ad Blocking**: Built-in URL pattern filtering
- **Cookie Isolation**: Per-window cookie partitioning

### Data & Privacy
- **Local-First Storage**: SQLite database keeps your data on your machine
- **Vector Embeddings**: LanceDB for intelligent similarity search (embedded, no external service)
- **Offline Capabilities**: Core features work without internet connection
- **Secure IPC**: All renderer-main communication through typed window.api bridge

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- macOS, Windows, or Linux
- 8GB RAM minimum (16GB recommended for large PDF processing)
- OpenAI API key (required for AI features)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/jeffers.git
cd jeffers
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

The application will open automatically. If not, you can access it at the Electron window that launches.

## Tech Stack

- **Frontend**: Next.js 15.3.0, React 19.0.0, TypeScript, Tailwind CSS 4.1.4
- **Desktop**: Electron 35.1.5 with secure IPC architecture
- **Database**: SQLite with better-sqlite3 11.9.1
- **Vector Store**: LanceDB (embedded vector database)
- **AI**: OpenAI via LangChain (GPT-4o, GPT-4.1-nano, text-embedding-3-small)
- **State Management**: Zustand 5.0.4 with IPC persistence
- **Testing**: Vitest 3.1.2 with React Testing Library
- **Component Development**: Storybook 9.0.4
- **Code Quality**: ESLint + Prettier + Husky with lint-staged

> **Note**: Jeffers previously used ChromaDB for vector storage but has migrated to LanceDB. 
> No external vector database service is required.

## Configuration

This application uses environment variables for configuration. Create a `.env` file in the project root and add the following variables:

### Required

```dotenv
# OpenAI API key for LLM and embeddings
OPENAI_API_KEY=your_openai_api_key
```

### Optional - External Services

```dotenv
# Exa.ai API key for enhanced web search capabilities
# Without this key, search will fall back to local vector database only
# Get your key at https://exa.ai
EXA_API_KEY=your_exa_api_key

# Browserbase API key and project ID for web scraping
BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_browserbase_project_id
```

### Optional - Configuration

```dotenv
# Database path (defaults to system app data directory)
JEFFERS_DB_PATH=/path/to/jeffers.db

# Note: LanceDB vector data is stored alongside the SQLite database in 
# <app_data_directory>/data/lancedb/ and persists across app restarts

# Feature flags
EXA_SEARCH_ENABLED=true
EXA_RESULTS_LIMIT=10

# Synthesis intervals (milliseconds)
CONTENT_SYNTHESIS_INTERVAL_MS=3600000    # 1 hour
ACTIVITY_SYNTHESIS_INTERVAL_MS=1800000   # 30 minutes
```

### Optional - Development

```dotenv
# Next.js development server URL (default: http://localhost:3000)
NEXT_DEV_SERVER_URL=http://localhost:3000

# Open DevTools on startup (default: true in dev)
OPEN_DEVTOOLS=true

# Logging level: error | warn | info | debug (default: info)
LOG_LEVEL=info

# Enable performance tracking (default: false)
PERFORMANCE_TRACKING=false
```

Make sure this `.env` file is not committed to version control (it should be listed in your `.gitignore`).

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start both Next.js and Electron in dev mode
npm run dev:web          # Start only Next.js development server
npm run dev:electron     # Start only Electron in dev mode

# Testing
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:models      # Run model tests only

# Building
npm run build            # Build Next.js for production
npm run electron:build   # Build Electron app
npm run package          # Package Electron app
npm run make             # Create distributables

# Code Quality
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript compiler check
npm run prettier         # Format code with Prettier

# Utilities
npm run rebuild:electron      # Rebuild native modules for Electron
npm run cli:reset-embeddings  # Reset all embeddings in the database
npm run storybook            # Start Storybook for component development
```

### Project Structure

```
/electron/              # Electron main process
  /ipc/                # IPC handlers (typed channels)
  /workers/            # Background workers
  main.ts              # Entry point
  preload.ts           # Secure preload bridge

/src/                  # Next.js frontend
  /app/                # App router pages
  /components/         # React components
    /ui/               # Reusable UI components
    /apps/             # Feature-specific components
      /chat/           # Chat interface
      /classic-browser/# Embedded browser
      /web-layer/      # Web content overlay
  /hooks/              # Custom React hooks
  /store/              # Zustand stores

/models/               # Data models (SQLite)
  /migrations/         # SQL migration files (22 migrations)
  *Model.ts            # Model classes

/services/             # Business logic layer
  /agents/             # AI agents (LangChain)
    /tools/            # Agent tools
  /ingestion/          # Content ingestion pipeline
    BaseIngestionWorker.ts
    ChunkingService.ts
    IngestionQueueService.ts
    PdfIngestionService.ts
  *Service.ts          # Service classes

/shared/               # Shared types and schemas
  /schemas/            # Validation schemas
  ipcChannels.ts       # IPC channel constants
  types.d.ts           # Shared type definitions

/ingestion/            # Ingestion utilities
  /clean/              # Text cleaning
  /fetch/              # Content fetching
  /parsers/            # Format parsers

/utils/                # Utilities
  /cli/                # CLI tools
  logger.ts            # Centralized logging
  performanceTracker.ts
```

### Testing

The project uses Vitest for testing with React Testing Library for component tests. Tests use in-memory SQLite databases for isolation.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test files
npm test ChatModel.test.ts
```

## Architecture

Jeffers follows a secure, layered architecture:

### Core Patterns

- **Model-Service-Controller**: Clean separation of concerns
  - **Models**: Database operations only (SQLite)
  - **Services**: Business logic and orchestration
  - **Controllers**: IPC handlers for Electron communication
  - **Components**: React UI layer

- **Security-First IPC**: 
  - All renderer-main communication through typed `window.api` bridge
  - Context isolation and sandboxing enabled
  - No direct Node.js access in renderer

- **Ingestion Pipeline**:
  - Worker-based architecture for scalable content processing
  - Queue system with retry logic and progress tracking
  - Specialized workers for URLs, PDFs, and other content types

- **AI Integration**:
  - Standardized prompt templates with user profile injection
  - Streaming responses with backpressure handling
  - Hybrid search combining local vectors and web results

### Key Services

- **HybridSearchService**: Multi-stage search with fallback logic
- **IngestionQueueService**: Job queue management with concurrency control
- **ChunkingService**: Intelligent content chunking and embedding
- **ProfileAgent**: Automated user profile learning
- **IntentService**: Query classification and routing

For detailed architecture documentation, see [CLAUDE.md](CLAUDE.md).

## Performance

Jeffers is optimized for handling large knowledge bases:

- **Concurrent Processing**: Ingestion queue supports 20+ concurrent jobs
- **Streaming Architecture**: AI responses stream in real-time
- **Background Workers**: Heavy processing runs in separate threads
- **Smart Chunking**: Configurable chunk sizes based on content type
- **Debounced Operations**: State persistence and expensive operations are debounced

Monitor performance with `PERFORMANCE_TRACKING=true` in your `.env` file.

## Troubleshooting

### Common Issues

1. **Electron Window Doesn't Open**
   - Check if port 3000 is available for Next.js
   - Try rebuilding native modules: `npm run rebuild:electron`

2. **PDF Processing Fails**
   - Ensure sufficient memory is available
   - Check logs for specific error messages
   - Verify PDF is not corrupted

3. **Vector Search Not Working**
   - Check if embeddings exist: run the health check
   - If migrating from ChromaDB, see `/junkDrawer/README.md` for migration steps
   - Verify LanceDB data directory exists at `<app_data>/data/lancedb/`

4. **Search Returns No Results**
   - Check if content has been indexed (status should be 'embedded')
   - Verify embeddings exist in the database
   - Check logs for any vector store errors
   - For web search, ensure EXA_API_KEY is set

### Debug Mode

Set `LOG_LEVEL=debug` in your `.env` file to see detailed logs including:
- IPC communications
- SQL queries
- AI prompts and responses
- Performance metrics

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass (`npm test`)
2. Code follows existing patterns (see [CLAUDE.md](CLAUDE.md))
3. TypeScript strict mode compliance
4. Proper error handling and logging
5. Pre-commit hooks pass (ESLint, Prettier, TypeScript)

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes following the patterns in CLAUDE.md
4. Write/update tests as needed
5. Run `npm test` and `npm run typecheck`
6. Commit with descriptive messages
7. Push and create a pull request

## Security

- All renderer-main process communication uses a secure IPC bridge
- Context isolation and sandboxing are enforced
- BrowserViews run with strict CSP and cookie isolation
- User data stays local - no cloud sync by default
- API keys are never exposed to the renderer process

Report security issues to [security email/link]

## License

[MIT License](LICENSE)
