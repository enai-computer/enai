# Enai

### A calm, focused interpersonal computer

Enai reimagines personal computing by organizing your entire digital environment around your intent, helping you be calmer, smarter, and more effective.

The Jeffers version of Enai is an experimental prototype which draws its name from Robinson Jeffers, a poet from Carmel whose work focuses on the cold, ferocious beauty of the California coast and wild animals. https://literaryamerica.net/LiteraryAmerica_RobinsonJeffers.pdf

## Historical Context

The vision for Enai draws from pioneering work that imagined computers as extensions of human thought:

- **Vannevar Bush's Memex (1945)**: An augmented memory device where information forms associative trails, not isolated files
- **Douglas Engelbart's NLS (1968)**: A system for augmenting human intellect through collaborative knowledge work
- **Alan Kay's Smalltalk (1972)**: A living environment where users shape their tools, not the reverse

The Alto-Mac paradigm defined in the 60s and 70s is aging. And it's based on assumptions that are no longer true: isolated devices, siloed native apps, and a different kind of computer intelligence. What kind of environment would we build if we started over, knowing what we know now?


### Core Principles

**Everything is an object with memory**  
Files (emails, spreadsheets, images...), conversations, traditional web content, apps, and AI applets are 'cognitive objects' that remember their context, relationships, and usage patterns.

**The browser is infrastructure, not an app**  
Like display layers in traditional computing, the net is an ambient layer deeply integrated in the Enai environment.

**An intelligent substrate**  
AI isn't bolted on through chatbots or copilots—it's woven into how objects are understood, related, and transformed.

**The environment learns and adapts**  
Your patterns of thought and work reshape the environment, creating a truly personal computer. Information is organized by meaning and intent instead of application or file format.


## Architecture

The current implementation (codebase: Jeffers) explores these ideas through a kernel-based architecture:

```
Cognitive Kernel
├── Object System      — Everything is a live object with behavior
├── Memory Layers      — Working memory (WOM) and long-term memory (LOM)  
├── View System        — Objects can present themselves in multiple ways
├── Intelligence       — AI-native understanding and transformation
└── Message Passing    — Objects communicate and coordinate
```

Enai aims to become a computing environment, not an app.

## Experience

**Calm**: Paperlike textures, warm colors, and human-paced interactions respect your perceptual wellbeing.

**Focused**: Supporting your intent and attention. The environment brings together everything you need, maintaining context across sessions.

**Interpersonal**: Share not just documents but entire contexts. Collaborate in shared knowledge spaces that organically preserve semantic relationships.


## Technical Stack

- **Runtime**: Electron 35.1.5 with Next.js 15.3.0
- **Storage**: SQLite (better-sqlite3) with LanceDB for vectors
- **Intelligence**: OpenAI models via LangChain
- **Language**: TypeScript throughout
- **State**: Zustand with IPC persistence

## Installation

Prerequisites: Node.js 20+, npm 10+

```bash
git clone https://github.com/yourusername/jeffers.git
cd jeffers
npm install
```

## Configuration

Create a `.env` file:

```
OPENAI_API_KEY=your_openai_api_key

# Optional
EXA_API_KEY=your_exa_api_key        # Web search
BROWSERBASE_API_KEY=your_key        # Web scraping
```

## Development

```bash
npm run dev           # Start development environment
npm run lint          # Run linting
npm run typecheck     # TypeScript checks
npm test             # Run test suite
```

## Architecture Details

### Services
- **Object Management**: Lifecycle, persistence, and identity of cognitive objects
- **Memory Management**: Working memory (WOM) and long-term memory (LOM) layers
- **View System**: Multiple representations via WebContentsView
- **Intelligence**: Embeddings, understanding, transformation
- **Message Bus**: Inter-object communication

### Key Directories
```
/electron/          Main process and IPC handlers
/src/               Renderer process (Next.js)
/models/            Data models (SQLite)
/services/          Business logic
/shared/types/      TypeScript definitions
```

## Roadmap

1. **Service Decomposition**: Break monolithic services into kernel modules
2. **Object Protocol**: Implement standard CognitiveObject interface
3. **Intent System**: Evolve natural language interaction
4. **Live Environment**: Enable runtime modification and inspection

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines and [CLAUDE.md](./CLAUDE.md) for AI-assisted development instructions. Your collaboration is welcome.

## License

[License tbd]
