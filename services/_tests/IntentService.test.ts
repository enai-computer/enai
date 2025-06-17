import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentService } from '../IntentService';
import { NotebookService } from '../NotebookService';
import { AgentService } from '../AgentService';
import { WebContents } from 'electron';
import { SetIntentPayload, IntentResultPayload, NotebookRecord, SuggestedAction } from '../../shared/types';
import { ON_INTENT_RESULT, ON_SUGGESTED_ACTIONS } from '../../shared/ipcChannels';
import { logger } from '../../utils/logger';

// Mock logger to prevent console output during tests and allow assertions
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

// Mock ActivityLogService
const mockActivityLogService = {
    logActivity: vi.fn().mockResolvedValue(undefined),
};

// Mock ActionSuggestionService
const mockActionSuggestionService = {
    getSuggestions: vi.fn(),
};

// Mock services
const mockNotebookService = {
    createNotebook: vi.fn(),
    getAllNotebooks: vi.fn(),
    deleteNotebook: vi.fn(),
} as unknown as NotebookService;

const mockAgentService = {
    processComplexIntent: vi.fn(),
    processComplexIntentWithStreaming: vi.fn(),
} as unknown as AgentService;

// Mock WebContents for sender
const mockSender = {
    send: vi.fn(),
    id: 1, // Mock sender ID (number, as in Electron WebContents)
} as unknown as WebContents;

describe('IntentService', () => {
    let intentService: IntentService;

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        // Create a mock database
        const mockDb = {} as any;
        
        intentService = new IntentService({
            db: mockDb,
            notebookService: mockNotebookService as any,
            agentService: mockAgentService as any,
            activityLogService: mockActivityLogService as any,
            actionSuggestionService: mockActionSuggestionService as any
        });
    });

    describe('Notebook Creation Intents', () => {
        it('should handle "create notebook <title>" intent', async () => {
            const title = 'My New Notebook';
            const mockNewNotebook: NotebookRecord = { id: 'notebook-1', title, description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-1' };
            (mockNotebookService.createNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewNotebook);

            await intentService.handleIntent({ 
                intentText: `create notebook ${title}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.createNotebook).toHaveBeenCalledWith(title);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: mockNewNotebook.id,
                title: mockNewNotebook.title,
            });
        });

        it('should handle "new notebook <title>" intent', async () => {
            const title = 'Another New Notebook';
            const mockNewNotebook: NotebookRecord = { id: 'notebook-2', title, description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-2' };
            (mockNotebookService.createNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewNotebook);

            await intentService.handleIntent({ 
                intentText: `new notebook ${title}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.createNotebook).toHaveBeenCalledWith(title);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: mockNewNotebook.id,
                title: mockNewNotebook.title,
            });
        });

        it('should send error if create notebook intent has no title', async () => {
            await intentService.handleIntent({ 
                intentText: 'create notebook ' ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.createNotebook).not.toHaveBeenCalled();
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please provide a title for the new notebook.',
            });
        });
    });

    describe('Notebook Open/Find Intents', () => {
        const notebooks: NotebookRecord[] = [
            { id: 'nb-1', title: 'Alpha Book', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-nb1' },
            { id: 'nb-2', title: 'Beta Book', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-nb2' },
        ];

        beforeEach(() => {
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue(notebooks);
        });

        it('should handle "open notebook <name>" and find existing notebook', async () => {
            const notebookName = 'Alpha Book';
            await intentService.handleIntent({ 
                intentText: `open notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalled();
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-1',
                title: notebookName,
            });
        });

        it('should handle "find notebook <name>" and find existing notebook', async () => {
            const notebookName = 'Beta Book';
            await intentService.handleIntent({ 
                intentText: `find notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-2',
                title: notebookName,
            });
        });
        
        it('should handle "show notebook <name>" and find existing notebook', async () => {
            const notebookName = 'Alpha Book';
            await intentService.handleIntent({ 
                intentText: `show notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-1',
                title: notebookName,
            });
        });

        it('should send chat_reply if notebook to open is not found', async () => {
            const notebookName = 'Gamma Book';
            await intentService.handleIntent({ 
                intentText: `open notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" not found.`,
            });
        });

        it('should send error if open/find notebook intent has no name', async () => {
            await intentService.handleIntent({ 
                intentText: 'open notebook ' ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).not.toHaveBeenCalled();
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please specify which notebook to open or find.',
            });
        });
    });

    describe('Notebook Deletion Intents', () => {
        const notebooks: NotebookRecord[] = [
            { id: 'nb-del-1', title: 'Delete Me', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-del1' },
            { id: 'nb-del-2', title: 'Also Delete', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-del2' },
        ];

        beforeEach(() => {
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue(notebooks);
            (mockNotebookService.deleteNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined); // Assume deleteNotebook resolves if successful
        });

        it('should handle "delete notebook <name>" and delete existing notebook', async () => {
            const notebookName = 'Delete Me';
            await intentService.handleIntent({ 
                intentText: `delete notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalled();
            expect(mockNotebookService.deleteNotebook).toHaveBeenCalledWith('nb-del-1');
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" has been deleted.`,
            });
        });

        it('should handle "rm notebook <name>" and delete existing notebook', async () => {
            const notebookName = 'Also Delete';
            await intentService.handleIntent({ 
                intentText: `rm notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.deleteNotebook).toHaveBeenCalledWith('nb-del-2');
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" has been deleted.`,
            });
        });

        it('should send chat_reply if notebook to delete is not found', async () => {
            const notebookName = 'NonExistent Book';
            await intentService.handleIntent({ 
                intentText: `delete notebook ${notebookName}`,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" not found. Cannot delete.`,
            });
        });

        it('should delegate to AgentService when delete notebook has no name', async () => {
            // Mock AgentService response - it could ask which notebook to delete
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

            await intentService.handleIntent({ 
                intentText: 'delete notebook ' ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            // Should check for direct title match
            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1);
            // Should not delete anything
            expect(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            // Should delegate to AgentService
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalledWith({
                intentText: 'delete notebook ',
                context: 'notebook',
                notebookId: 'test-notebook'
            }, "1", mockSender, expect.any(String));
        });
    });

    describe('Direct Notebook Title Match', () => {
        const notebooks: NotebookRecord[] = [
            { id: 'direct-nb-1', title: 'My Cool Notebook', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-direct1' },
        ];

        beforeEach(() => {
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue(notebooks);
        });

        it('should open notebook if intent text exactly matches a notebook title (case-insensitive)', async () => {
            const notebookTitle = 'my cool notebook'; // Test case-insensitivity
            await intentService.handleIntent({ 
                intentText: notebookTitle ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1); // Called once for direct match
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'direct-nb-1',
                title: 'My Cool Notebook',
            });
        });

        it('should not open notebook if intent text is a partial match but not exact for direct title', async () => {
            const notebookTitle = 'My Cool';
            // This should fall through to AgentService because no pattern matches and direct match fails
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

            await intentService.handleIntent({ 
                intentText: notebookTitle ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1);
            expect(mockSender.send).not.toHaveBeenCalledWith(ON_INTENT_RESULT, expect.objectContaining({ type: 'open_notebook' }));
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalled();
        });
    });

    describe('URL Intents', () => {
        it('should handle fully qualified http URL', async () => {
            const url = 'http://example.com/path?query=value#fragment';
            await intentService.handleIntent({ 
                intentText: url ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: url,
                notebookId: 'test-notebook',
                message: `Opening ${url}...`
            });
        });

        it('should handle fully qualified https URL', async () => {
            const url = 'https://sub.example.co.uk/another/path';
            await intentService.handleIntent({ 
                intentText: url ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: url,
                notebookId: 'test-notebook',
                message: `Opening ${url}...`
            });
        });

        it('should prepend http:// to schemeless domain.tld URLs', async () => {
            const inputUrl = 'google.com';
            const expectedUrl = 'http://google.com';
            await intentService.handleIntent({ 
                intentText: inputUrl ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: expectedUrl,
                notebookId: 'test-notebook',
                message: `Opening ${expectedUrl}...`
            });
        });

        it('should prepend http:// to schemeless domain.tld/path URLs', async () => {
            const inputUrl = 'news.ycombinator.com/news?p=2';
            const expectedUrl = 'http://news.ycombinator.com/news?p=2';
            await intentService.handleIntent({ 
                intentText: inputUrl ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: expectedUrl,
                notebookId: 'test-notebook',
                message: `Opening ${expectedUrl}...`
            });
        });

        it('should not match a malformed/incomplete "URL" like string with spaces, and fall through to AgentService', async () => {
            const intentText = 'example com not a url'; // Contains space, fails regex
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined); // Mock agent response

            await intentService.handleIntent({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            // Ensure open_url was NOT called
            expect(mockSender.send).not.toHaveBeenCalledWith(ON_INTENT_RESULT, expect.objectContaining({ type: 'open_url' }));
            // Ensure the specific error from handleOpenUrl was NOT called
            expect(mockSender.send).not.toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: `Input "${intentText}" looks like an incomplete URL.`,
            });
            // Ensure AgentService was called
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, "1", mockSender, expect.any(String));
        });

        it('should fall through to AgentService for schemeless input without a clear TLD pattern (e.g. lacking a dot)', async () => {
            const intentText = 'localhost:3000'; // common but regex might not catch without a scheme or TLD like .com
                                          // The current regex might handle this if it matches the domain.tld part broadly.
                                          // Let's test against the specific logic in handleOpenUrl if it doesn't get a scheme.
            await intentService.handleIntent({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);
             // Depending on how strictly the regex and scheme check are, this could either be an error 
            // or fall through. The current handleOpenUrl logic will error if http:// isn't prepended.
            // Our current regex: /^((?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[\/\w\.\-%~?&=#]*)*)/i
            // localhost:3000 does not match this because it lacks a `.[a-z]{2,}` part for a TLD.
            // So it should fall through to AgentService.
            expect(mockSender.send).not.toHaveBeenCalledWith(ON_INTENT_RESULT, expect.objectContaining({ type: 'open_url' }));
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined); // Mock agent response
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, "1", mockSender, expect.any(String));
        });

        it('should handle domain with hyphen and numbers', async () => {
            const inputUrl = 'my-awesome-site123.co.uk/path';
            const expectedUrl = 'http://my-awesome-site123.co.uk/path';
            await intentService.handleIntent({ 
                intentText: inputUrl ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: expectedUrl,
                notebookId: 'test-notebook',
                message: `Opening ${expectedUrl}...`
            });
        });

    });

    describe('Fallback to AgentService', () => {
        beforeEach(() => {
            // Ensure no notebooks match directly for these tests
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([]); 
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        });

        it('should delegate to AgentService if no patterns match and no direct notebook title match', async () => {
            const intentText = 'what is the weather today?';
            await intentService.handleIntent({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.createNotebook).not.toHaveBeenCalled();
            expect(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            // getAllNotebooks will be called for direct match attempt
            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1);
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, "1", mockSender, expect.any(String));
            // Assuming AgentService sends its own results now
            // expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, { type: 'chat_reply', message: 'Agent handled this.' });
        });

        it('should send error if AgentService fails', async () => {
            const intentText = 'some complex query';
            const errorMessage = 'Agent exploded!';
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(errorMessage));

            await intentService.handleIntent({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, "1", mockSender, expect.any(String));
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: `Error processing your request: ${errorMessage}`,
            });
        });
    });

    describe('Search Intent Patterns', () => {
        beforeEach(() => {
            // Reset mocks
            vi.clearAllMocks();
            // Ensure no notebooks match for search intents
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        });

        it('should handle "search perplexity for X" intent', async () => {
            const query = 'quantum computing';
            const intentText = `search perplexity for ${query}`;
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`,
                message: `Searching Perplexity for "${query}"...`
            });

            // Verify activity logging
            expect(mockActivityLogService.logActivity).toHaveBeenCalledWith({
                activityType: 'intent_selected',
                details: {
                    intentText: intentText,
                    context: 'welcome',
                    notebookId: undefined,
                    patternMatched: '/^search\\s+perplexity(?:\\s+for)?\\s+(.+)$/i'
                }
            });
        });

        it('should handle "search google for X" intent', async () => {
            const query = 'typescript generics';
            const intentText = `search google for ${query}`;
            
            await intentService.handleIntent({ 
                intentText,
                context: 'notebook',
                notebookId: 'test-notebook'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_in_classic_browser',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                notebookId: 'test-notebook',
                message: `Searching Google for "${query}"...`
            });

            // Verify activity logging
            expect(mockActivityLogService.logActivity).toHaveBeenCalledWith({
                activityType: 'intent_selected',
                details: {
                    intentText: intentText,
                    context: 'notebook',
                    notebookId: 'test-notebook',
                    patternMatched: '/^search\\s+google(?:\\s+for)?\\s+(.+)$/i'
                }
            });
        });

        it('should handle generic "search for X" intent', async () => {
            const query = 'best coffee shops';
            const intentText = `search for ${query}`;
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`,
                message: `Searching Perplexity for "${query}"...`
            });

            expect(mockActivityLogService.logActivity).toHaveBeenCalledWith({
                activityType: 'intent_selected',
                details: {
                    intentText: intentText,
                    context: 'welcome',
                    notebookId: undefined,
                    patternMatched: '/^search(?:\\s+for)?\\s+(.+)$/i'
                }
            });
        });

        it('should handle search intent with special characters', async () => {
            const query = 'C++ vs Rust & Go';
            const intentText = `search for ${query}`;
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`,
                message: `Searching Perplexity for "${query}"...`
            });
        });

        it('should not log activity if activity logging fails', async () => {
            const query = 'test query';
            const intentText = `search for ${query}`;
            
            // Make activity logging fail
            mockActivityLogService.logActivity.mockRejectedValueOnce(new Error('Logging failed'));
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            // Should still send the result even if logging fails
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'open_url',
                url: `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`,
                message: `Searching Perplexity for "${query}"...`
            });
            
            // Verify error was logged
            expect(logger.error).toHaveBeenCalledWith(
                '[IntentService] Failed to log activity:',
                expect.any(Error)
            );
        });
    });

    describe('ActionSuggestionService Integration', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        });

        it('should trigger ActionSuggestionService in welcome context', async () => {
            const intentText = 'help me learn about machine learning';
            const mockSuggestions: SuggestedAction[] = [
                {
                    type: 'search_web',
                    displayText: 'Search for machine learning tutorials',
                    payload: { searchQuery: 'machine learning tutorials', searchEngine: 'perplexity' }
                },
                {
                    type: 'compose_notebook',
                    displayText: 'Create a "Machine Learning Notes" notebook',
                    payload: { proposedTitle: 'Machine Learning Notes' }
                }
            ];
            
            mockActionSuggestionService.getSuggestions.mockResolvedValue(mockSuggestions);
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            // Verify ActionSuggestionService was called
            expect(mockActionSuggestionService.getSuggestions).toHaveBeenCalledWith(intentText);

            // Verify suggestions were sent
            expect(mockSender.send).toHaveBeenCalledWith(ON_SUGGESTED_ACTIONS, mockSuggestions);

            // Verify AgentService was still called
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalled();
        });

        it('should not trigger ActionSuggestionService in notebook context', async () => {
            const intentText = 'help me understand this';
            
            await intentService.handleIntent({ 
                intentText,
                context: 'notebook',
                notebookId: 'test-notebook'
            }, mockSender);

            // Should NOT call ActionSuggestionService in notebook context
            expect(mockActionSuggestionService.getSuggestions).not.toHaveBeenCalled();
            
            // Should NOT send suggested actions
            expect(mockSender.send).not.toHaveBeenCalledWith(
                ON_SUGGESTED_ACTIONS, 
                expect.anything()
            );
        });

        it('should handle ActionSuggestionService errors gracefully', async () => {
            const intentText = 'suggest something';
            
            mockActionSuggestionService.getSuggestions.mockRejectedValueOnce(
                new Error('Suggestion service failed')
            );
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            // Should log the error
            expect(logger.error).toHaveBeenCalledWith(
                '[IntentService] Error generating action suggestions:',
                expect.any(Error)
            );

            // Should still call AgentService
            expect(mockAgentService.processComplexIntentWithStreaming).toHaveBeenCalled();
            
            // Should NOT send any suggested actions
            expect(mockSender.send).not.toHaveBeenCalledWith(
                ON_SUGGESTED_ACTIONS,
                expect.anything()
            );
        });

        it('should not send suggestions when array is empty', async () => {
            const intentText = 'nothing to suggest';
            
            mockActionSuggestionService.getSuggestions.mockResolvedValue([]);
            
            await intentService.handleIntent({ 
                intentText,
                context: 'welcome'
            }, mockSender);

            // Should call ActionSuggestionService
            expect(mockActionSuggestionService.getSuggestions).toHaveBeenCalled();
            
            // Should NOT send empty array (no send call for suggestions)
            expect(mockSender.send).not.toHaveBeenCalledWith(ON_SUGGESTED_ACTIONS, []);
        });
    });

    describe('Performance Tracking', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            (mockNotebookService.getAllNotebooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        });

        it('should track performance for successful intent handling', async () => {
            const { performanceTracker } = await import('../../utils/performanceTracker');
            
            await intentService.handleIntent({ 
                intentText: 'search for test',
                context: 'welcome'
            }, mockSender);

            // Should record start event
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

            // Should record pattern matched event
            expect(performanceTracker.recordEvent).toHaveBeenCalledWith(
                expect.any(String), // correlationId
                'IntentService',
                'pattern_matched',
                {
                    pattern: expect.any(String)
                }
            );
        });

        it('should track performance for AgentService delegation', async () => {
            const { performanceTracker } = await import('../../utils/performanceTracker');
            (mockAgentService.processComplexIntentWithStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            
            await intentService.handleIntent({ 
                intentText: 'complex query',
                context: 'notebook',
                notebookId: 'test-notebook'
            }, mockSender);

            // Should record delegation to agent
            expect(performanceTracker.recordEvent).toHaveBeenCalledWith(
                expect.any(String), // correlationId
                'IntentService',
                'delegating_to_agent'
            );
        });
    });

    describe('Context-aware URL Handling', () => {
        it('should handle URLs differently in notebook vs welcome context', async () => {
            const url = 'https://example.com';
            
            // Test notebook context - should open in classic browser
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

            // Clear mocks
            vi.clearAllMocks();

            // Test welcome context - should open as regular URL
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
    });

    describe('Error Handling and Edge Cases', () => {

        it('should handle missing context gracefully', async () => {
            // Test with missing context - should default behavior
            await intentService.handleIntent({ 
                intentText: 'https://example.com',
                context: undefined as any // Force undefined context
            }, mockSender);

            // Should still handle the URL
            expect(mockSender.send).toHaveBeenCalled();
        });
    });
}); 