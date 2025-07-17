import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentService } from '../IntentService';
import { NotebookService } from '../NotebookService';
import { AgentService } from '../AgentService';
import { WebContents } from 'electron';
import { NotebookRecord, SuggestedAction } from '../../shared/types';
import { ON_INTENT_RESULT, ON_SUGGESTED_ACTIONS } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

// Mock logger
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Mock performance tracker
vi.mock('../../utils/performanceTracker', () => ({
    performanceTracker: {
        recordEvent: vi.fn(),
        startStream: vi.fn(),
        endStream: vi.fn(),
        completeStream: vi.fn(),
    },
}));

// Mock services
const mockActivityLogService = {
    logActivity: vi.fn().mockResolvedValue(undefined),
};

const mockActionSuggestionService = {
    getSuggestions: vi.fn(),
};

const mockNotebookService = {
    createNotebook: vi.fn(),
    getAllNotebooks: vi.fn(),
    deleteNotebook: vi.fn(),
} as unknown as NotebookService;

const mockAgentService = {
    processComplexIntent: vi.fn(),
    processComplexIntentWithStreaming: vi.fn(),
} as unknown as AgentService;

const mockSender = {
    send: vi.fn(),
    id: 1,
} as unknown as WebContents;

describe('IntentService', () => {
    let intentService: IntentService;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = {} as any;
        
        intentService = new IntentService({
            db: mockDb,
            notebookService: mockNotebookService as any,
            agentService: mockAgentService as any,
            activityLogService: mockActivityLogService as any,
            actionSuggestionService: mockActionSuggestionService as any
        });
    });

    describe('Notebook Operations', () => {
        const mockNotebook: NotebookRecord = { 
            id: 'nb-1', 
            title: 'Test Notebook', 
            description: null, 
            createdAt: new Date().toISOString(), 
            updatedAt: new Date().toISOString(), 
            objectId: 'obj-1' 
        };

        it.each([
            ['create notebook', 'Test Notebook'],
            ['new notebook', 'Test Notebook']
        ])('should handle "%s" intent', async (prefix, title) => {
            (mockNotebookService.createNotebook as any).mockResolvedValue(mockNotebook);

            await intentService.handleIntent({ 
                intentText: `${prefix} ${title}`,
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.createNotebook).toHaveBeenCalledWith(title);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: mockNotebook.id,
                title: mockNotebook.title,
            });
        });

        it.each([
            'open notebook',
            'find notebook',
            'show notebook'
        ])('should handle "%s" intent', async (prefix) => {
            const notebooks = [mockNotebook];
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue(notebooks);

            await intentService.handleIntent({ 
                intentText: `${prefix} Test Notebook`,
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-1',
                title: 'Test Notebook',
            });
        });

        it.each([
            'delete notebook',
            'rm notebook'
        ])('should handle "%s" intent', async (prefix) => {
            const notebooks = [mockNotebook];
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue(notebooks);
            (mockNotebookService.deleteNotebook as any).mockResolvedValue(undefined);

            await intentService.handleIntent({ 
                intentText: `${prefix} Test Notebook`,
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.deleteNotebook).toHaveBeenCalledWith('nb-1');
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "Test Notebook" has been deleted.`,
            });
        });

        it('should handle missing notebook names', async () => {
            await intentService.handleIntent({ 
                intentText: 'create notebook ',
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please provide a title for the new notebook.',
            });
        });

        it('should handle notebook not found', async () => {
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([]);

            await intentService.handleIntent({ 
                intentText: 'open notebook NonExistent',
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "NonExistent" not found.`,
            });
        });

        it('should handle direct notebook title match', async () => {
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([mockNotebook]);

            await intentService.handleIntent({ 
                intentText: 'test notebook', // case-insensitive match
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-1',
                title: 'Test Notebook',
            });
        });

        it('should not match partial notebook names', async () => {
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([mockNotebook]);
            (mockAgentService.processComplexIntentWithStreaming as any).mockResolvedValue(undefined);

            await intentService.handleIntent({ 
                intentText: 'Test Note', // partial match
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            // Should not open notebook
            expect(mockSender.send).not.toHaveBeenCalledWith(
                ON_INTENT_RESULT, 
                expect.objectContaining({ type: 'open_notebook' })
            );
            // Should delegate to agent
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalled();
        });
    });

    describe('URL Handling', () => {
        const testUrls = [
            { input: 'https://example.com', expected: 'https://example.com' },
            { input: 'http://example.com/path', expected: 'http://example.com/path' },
            { input: 'example.com', expected: 'http://example.com' },
            { input: 'sub.example.co.uk/path?q=1', expected: 'http://sub.example.co.uk/path?q=1' },
        ];

        it.each(testUrls)('should handle URL: $input', async ({ input, expected }) => {
            await intentService.handleIntent({ 
                intentText: input,
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: expected,
                notebookId: 'test-notebook',
                message: `Opening ${expected}...`
            });
        });

        it('should handle URLs differently by context', async () => {
            const url = 'https://example.com';
            
            // Notebook context
            await intentService.handleIntent({ 
                intentText: url,
                context: 'notebook',
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: url,
                notebookId: 'test-notebook',
                message: `Opening ${url}...`
            });

            vi.clearAllMocks();

            // Welcome context
            await intentService.handleIntent({ 
                intentText: url,
                context: 'welcome'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: url,
                message: `Opening ${url}...`
            });
        });

        it('should not match invalid URLs', async () => {
            (mockAgentService.processComplexIntentWithStreaming as any).mockResolvedValue(undefined);
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([]);

            await intentService.handleIntent({ 
                intentText: 'not a url at all',
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).not.toHaveBeenCalledWith(
                ON_INTENT_RESULT, 
                expect.objectContaining({ type: 'open_url' })
            );
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalled();
        });
    });

    describe('Search Intents', () => {
        beforeEach(() => {
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([]);
        });

        const searchTests = [
            { intent: 'search perplexity for quantum', engine: 'perplexity', query: 'quantum' },
            { intent: 'search google for typescript', engine: 'google', query: 'typescript' },
            { intent: 'search for coffee shops', engine: 'perplexity', query: 'coffee shops' },
        ];

        it.each(searchTests)('should handle: $intent', async ({ intent, engine, query }) => {
            await intentService.handleIntent({ 
                intentText: intent,
                context: 'welcome'
            }, mockSender);

            const expectedUrl = engine === 'google' 
                ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
                : `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`;

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: expectedUrl,
                message: expect.stringContaining(query)
            });
        });

        it('should handle search with special characters', async () => {
            const query = 'C++ vs Rust & Go';
            await intentService.handleIntent({ 
                intentText: `search for ${query}`,
                context: 'welcome'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`,
                message: `Searching Perplexity for "${query}"...`
            });
        });
    });

    describe('ActionSuggestionService Integration', () => {
        beforeEach(() => {
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([]);
            (mockAgentService.processComplexIntentWithStreaming as any).mockResolvedValue(undefined);
        });

        it('should trigger suggestions in welcome context only', async () => {
            const mockSuggestions: SuggestedAction[] = [
                {
                    type: 'search_web',
                    displayText: 'Search for ML tutorials',
                    payload: { searchQuery: 'ML tutorials', searchEngine: 'perplexity' }
                }
            ];
            
            mockActionSuggestionService.getSuggestions.mockResolvedValue(mockSuggestions);
            
            // Test welcome context - should trigger
            await intentService.handleIntent({ 
                intentText: 'help me learn ML',
                context: 'welcome'
            }, mockSender);

            expect(mockActionSuggestionService.getSuggestions).toHaveBeenCalled();
            expect(mockSender.send).toHaveBeenCalledWith(ON_SUGGESTED_ACTIONS, mockSuggestions);

            vi.clearAllMocks();

            // Test notebook context - should NOT trigger
            await intentService.handleIntent({ 
                intentText: 'help me learn ML',
                context: 'notebook',
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockActionSuggestionService.getSuggestions).not.toHaveBeenCalled();
        });

        it('should handle suggestion service errors gracefully', async () => {
            mockActionSuggestionService.getSuggestions.mockRejectedValueOnce(
                new Error('Service failed')
            );
            
            await intentService.handleIntent({ 
                intentText: 'suggest something',
                context: 'welcome'
            }, mockSender);

            expect(logger.error).toHaveBeenCalledWith(
                '[IntentService] Error generating action suggestions:',
                expect.any(Error)
            );
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalled();
        });
    });

    describe('Agent Fallback', () => {
        beforeEach(() => {
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([]);
            (mockAgentService.processComplexIntentWithStreaming as any).mockResolvedValue(undefined);
        });

        it('should delegate unmatched intents to AgentService', async () => {
            await intentService.handleIntent({ 
                intentText: 'what is the weather?',
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalledWith(
                { 
                    intentText: 'what is the weather?',
                    context: 'notebook', 
                    notebookId: 'test-notebook'
                }, 
                "1", 
                mockSender, 
                expect.any(String)
            );
        });

        it('should handle agent errors', async () => {
            (mockAgentService.processComplexIntentWithStreaming as any)
                .mockRejectedValue(new Error('Agent failed'));

            await intentService.handleIntent({ 
                intentText: 'complex query',
                context: 'notebook', 
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: 'Error processing your request: Agent failed',
            });
        });
    });

    describe('Activity Logging', () => {
        it('should log successful intent handling', async () => {
            await intentService.handleIntent({ 
                intentText: 'search for test',
                context: 'welcome'
            }, mockSender);

            expect(mockActivityLogService.logActivity).toHaveBeenCalledWith({
                activityType: 'intent_selected',
                details: {
                    intentText: 'search for test',
                    context: 'welcome',
                    notebookId: undefined,
                    patternMatched: expect.any(String)
                }
            });
        });

        it('should continue if logging fails', async () => {
            mockActivityLogService.logActivity.mockRejectedValueOnce(new Error('Log failed'));
            
            await intentService.handleIntent({ 
                intentText: 'search for test',
                context: 'welcome'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, expect.any(Object));
            expect(logger.error).toHaveBeenCalledWith(
                '[IntentService] Failed to log activity:',
                expect.any(Error)
            );
        });
    });

    describe('Performance Tracking', () => {
        it('should track intent processing performance', async () => {
            const { performanceTracker } = await import('../../utils/performanceTracker');
            
            await intentService.handleIntent({ 
                intentText: 'search for test',
                context: 'welcome'
            }, mockSender);

            // Should track intent start
            expect(performanceTracker.recordEvent).toHaveBeenCalledWith(
                expect.any(String), // correlationId
                'IntentService',
                'intent_start',
                {
                    intentText: 'search for test',
                    context: 'welcome',
                    notebookId: undefined
                }
            );

            // Should track pattern match
            expect(performanceTracker.recordEvent).toHaveBeenCalledWith(
                expect.any(String),
                'IntentService',
                'pattern_matched',
                { pattern: expect.any(String) }
            );
        });

        it('should track agent delegation', async () => {
            const { performanceTracker } = await import('../../utils/performanceTracker');
            (mockNotebookService.getAllNotebooks as any).mockResolvedValue([]);
            (mockAgentService.processComplexIntentWithStreaming as any).mockResolvedValue(undefined);
            
            await intentService.handleIntent({ 
                intentText: 'complex query',
                context: 'notebook',
                notebookId: 'test-notebook'
            }, mockSender);

            expect(performanceTracker.recordEvent).toHaveBeenCalledWith(
                expect.any(String),
                'IntentService',
                'delegating_to_agent'
            );
        });
    });
});