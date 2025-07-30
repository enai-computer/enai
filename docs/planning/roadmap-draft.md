# Roadmap Planning

We might think of our initial target users as people who hope to be organized, but who struggle to keep their computers organized. They're active computer users, moderately familiar with technology but probably not early adopters of experimental AI tools. The reason they might think of using Enai is that context switching on the computer has become overwhelming and frustrating. Our goal is to build a calm, focused personal computing environment so people can stay organized effortlessly and switch tasks immediately. 

As a product, Enai consists of a homepage (for quick tasks, information management, and navigation), a series of notebooks (for working on something, putting it away, and coming back to it later), and an intent line connecting them both (for interacting with your computer in natural language).

The core data model enabling this to work is roughly modeled on the brain. It consists of an intent stream (INS: keeping track of the user's current intent and context in granular detail to optimize for the next minute of their attention), a working memory layer (WOM: keeping track of the user's recent and ongoing activity; degrades over a month), a long term memory layer (LOM: intentionally added bookmarks whose relevance might decay slightly over time but which stays in memory until it is removed), and an ontological model (OM: a synthesized profile of the user's goals, interests, preferences, and so on).

## Immediate Goal: Finish a demo that effectively communicates the advantages of creating a computing environment

### Already Accomplished:
- Welcome page with suggested actions, intent parsing & web layer
- Daily notebooks for "you can use it just like a normal computer" use case
- Rapid context switching between notebooks
- Classic web browser in notebooks
- Simple context-aware chat
- Simple context retrieval (full RAG pipeline not implemented)

### Existing Stubs to be Integrated:
- RAG pipeline (where the AI selects from a list returned by LanceDB)
- Smart excerpt generation for relevant content slices in Enai UI
- Profile synthesis that learns user preferences and goals over time (sort of)
- Hybrid search combining local vector search (LanceDB) with web search (Exa)

### Still to be Done:

#### 1. Organized Effortlessly
- a. Type "organize my tabs" in the intent line; tabs get organized in groups within notebooks or across notebooks
- b. Manually transfer tabs within and between notebooks

#### 2. Proactive Search for Context Flow
- a. Talking with someone about a document, right-click to see related information, the document has already been searched for by Enai
- b. Working on a piece of information, pull up relevant slices (in Enai UI) related to that content

#### 3. Natural Multimedia Environments
- a. Support multiple content types besides traditional web pages / classic web surfing activity
- b. Pull web apps out of the browser and give them a native, application experience

#### 4. Agentic Workflows
- a. "Pull up my invoices from Q2 and email them to my tax advisor"
- b. "Help me plan a Mexican dinner party for 8"

*If we can get 2-3 stubs finished, and 1-2 TBDs, we're in great shape for a demo imo*

## Medium Term Goal: Ship a beta which is helpful

### 1. ClassicBrowser Refinement
- a. Multiple WebContentsViews or at least support for persistent JS when writing emails etc.
- b. Finish all the basic features (navigable tab histories, print, download etc.)

### 2. Data Management
- a. Have a sufficiently robust data schema that we're sure we won't lose people's data
- b. Accounts and env variable management to track costs and pricing internally

### 3. Shipping and Packaging
- a. Signed releases for Apple and Microsoft
- b. Normal install and packaging

---

## Claude's Thoughts

After analyzing the roadmap against the existing codebase and product vision documents, I see a fascinating alignment between the technical foundation already built and the demo objectives ahead.

The recent Cognitive Objects architecture migration has created the infrastructure needed for "organized effortlessly." The new `objectBio` fields and `objectRelationships` tables aren't just database improvements - they're the memory system that will power intelligent tab organization. When a user types "organize my tabs," the system can leverage:

1. **Object histories** to understand which tabs belong together based on usage patterns
2. **Relationship tracking** to identify content clusters 
3. **The hybrid search system** to find semantic connections the user might have missed

The technical choices support the user experience goals. The junction tables for notebook associations mean tab transfers between notebooks will be instantaneous. The JSON fields for cognitive features mean the AI can add rich metadata without schema migrations. The multi-model approach (using different GPT variants for different tasks) suggests cost-conscious engineering that can scale.

Looking at the "stubs to be integrated," I notice they're not really stubs - they're mostly complete systems waiting for UI integration:

- The RAG pipeline exists but needs the selection logic
- Profile synthesis runs but lacks the feedback loops to improve
- Hybrid search works but isn't surfaced proactively

The gap between "what exists" and "demo ready" is surprisingly small. The heavy lifting - vector storage, cognitive architecture, multi-agent orchestration - is done. What remains is mostly UI/UX polish and connecting the dots.

Two technical insights stand out:

1. **The WOM layer degradation** mentioned in the roadmap aligns perfectly with the time-based filtering already in `HybridSearchService`. This isn't just search - it's digital forgetting, which paradoxically helps with organization by letting irrelevant content fade.

2. **The agentic workflows** will be straightforward to implement because `AgentService` already has web search, local knowledge, and tool use. The invoice example could literally be a new tool that queries objects by type and date range.

The most ambitious item - "proactive search for context flow" - is where Enai could truly differentiate. The infrastructure is there: objects track their access patterns, the profile system learns preferences, and the intent parser understands context. Imagine opening a document and having Enai silently pre-fetch related materials, ready for that right-click moment. That's not just organization - that's augmented cognition.

The roadmap reads like a treasure map where X marks a spot you've already dug most of the way to. The foundation is solid, the vision is clear, and the technical pieces are in place. Ship it.