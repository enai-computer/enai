# Jeffers

Jeffers is an AI-powered desktop knowledge management application that combines natural language interfaces, web browsing, note-taking, and intelligent search into a unified workspace.

## Features

### AI-Powered Intelligence
- **Natural Language Commands**: Type commands like "create notebook about AI research" or "search news about climate change"
- **Smart AI Agent**: Powered by OpenAI, understands context and executes complex tasks
- **Streaming Responses**: Real-time AI interactions with context awareness
- **User Profile Awareness**: AI remembers your goals, interests, and preferences
- **Time-Bound Goal Tracking**: Automatically captures and tracks goals with temporal context

### Knowledge Management
- **Notebook System**: Create and organize notebooks for different topics or projects
- **Multi-Window Workspace**: Drag-and-drop windows including chat, browser, and more
- **Automatic Organization**: Content is automatically chunked, embedded, and indexed
- **PDF Support**: Import and search through PDF documents

### Advanced Search
- **Hybrid Search**: Combines local vector search with web results via Exa.ai
- **News Aggregation**: Search across multiple news sources (WSJ, NYT, Bloomberg, etc.)
- **Smart Deduplication**: Automatic filtering of similar content

### Integrated Browsing
- **Built-in Browser**: Full web browsing capabilities within the app
- **Bookmark Import**: Import bookmarks from Chrome, Firefox, or Safari
- **Content Extraction**: Automatic extraction and indexing of web content

### Data & Privacy
- **Local-First Storage**: SQLite database keeps your data on your machine
- **Vector Embeddings**: ChromaDB for intelligent similarity search
- **Offline Capabilities**: Core features work without internet connection

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm or yarn
- Docker (for ChromaDB)

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

3. Start ChromaDB using Docker:
```bash
docker-compose up -d
```

4. Run the development server:
```bash
npm run dev
```

The application will open automatically. If not, you can access it at the Electron window that launches.

## Tech Stack

- **Frontend**: Next.js 15.3.0, React 19, TypeScript, Tailwind CSS v4
- **Desktop**: Electron 35 with custom IPC architecture
- **Database**: SQLite with better-sqlite3
- **Vector Store**: ChromaDB for embeddings
- **AI**: OpenAI via LangChain
- **State Management**: Zustand with IPC persistence

## Configuration

This application uses environment variables for configuration. Create a `.env` file in the project root and add the following variables:

```dotenv
# Required for Browserbase integration (if used)
BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_browserbase_project_id

# Required for OpenAI Embeddings
OPENAI_API_KEY=your_openai_api_key

# Required for Chroma Vector Store
# Typically http://localhost:8000 if running locally via Docker
CHROMA_URL=http://localhost:8000

# Optional: API Key for Chroma Cloud (if applicable)
# CHROMA_API_KEY=your_chroma_cloud_api_key

# Optional: URL for the Next.js development server (defaults to http://localhost:3000)
# NEXT_DEV_SERVER_URL=http://localhost:3000

# Optional: Set to true to open DevTools on startup (defaults to true in dev)
# OPEN_DEVTOOLS=true

# Optional: Exa.ai API key for enhanced web search capabilities
# Without this key, search will fall back to local vector database only
# Get your key at https://exa.ai
EXA_API_KEY=your_exa_api_key
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

# Linting & Type Checking
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript compiler check

# Utilities
npm run cli:reset-embeddings  # Reset all embeddings in the database
npm run storybook            # Start Storybook for component development
```

### Project Structure

```
/electron/         # Electron main process
  /ipc/           # IPC handlers
  /workers/       # Background workers
  main.ts         # Entry point

/electron_modules/ # Electron-specific native module builds
  /better-sqlite3 # Pre-built SQLite for Electron

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
  /ingestion/     # Content ingestion pipeline

/shared/          # Shared between main/renderer
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

Jeffers follows a Model-Service-Controller pattern:

- **Models**: Handle database operations (SQLite)
- **Services**: Contain business logic and orchestration
- **Controllers**: IPC handlers for Electron communication
- **Components**: React UI components

All IPC communication is strongly typed using channels defined in `shared/ipcChannels.ts`.

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass (`npm test`)
2. Code follows existing patterns (see CLAUDE.md)
3. TypeScript strict mode compliance
4. Proper error handling and logging

## License

[MIT License](LICENSE)
