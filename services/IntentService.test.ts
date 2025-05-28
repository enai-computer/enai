import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentService } from './IntentService';
import { NotebookService } from './NotebookService';
import { AgentService } from './AgentService';
import { WebContents } from 'electron';
import { SetIntentPayload, IntentResultPayload, NotebookRecord } from '../shared/types';
import { ON_INTENT_RESULT } from '../shared/ipcChannels';
import { logger } from '../utils/logger';

// Mock logger to prevent console output during tests and allow assertions
vi.mock('../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock services
const mockNotebookService = {
    createNotebook: vi.fn(),
    getAllNotebooks: vi.fn(),
    deleteNotebook: vi.fn(),
} as unknown as NotebookService;

const mockAgentService = {
    processComplexIntent: vi.fn(),
} as unknown as AgentService;

// Mock WebContents for sender
const mockSender = {
    send: vi.fn(),
    id: 1, // Mock sender ID
} as unknown as WebContents;

describe('IntentService', () => {
    let intentService: IntentService;

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        intentService = new IntentService(mockNotebookService, mockAgentService);
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

        it('should send error if delete notebook intent has no name', async () => {
            await intentService.handleIntent({ 
                intentText: 'delete notebook ' ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).not.toHaveBeenCalled();
            expect(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please specify which notebook to delete.',
            });
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
            (mockAgentService.processComplexIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'chat_reply', message: 'Agent processed' });

            await intentService.handleIntent({ 
                intentText: notebookTitle ,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1);
            expect(mockSender.send).not.toHaveBeenCalledWith(ON_INTENT_RESULT, expect.objectContaining({ type: 'open_notebook' }));
            expect(mockAgentService.processComplexIntent).toHaveBeenCalled();
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
            (mockAgentService.processComplexIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'chat_reply', message: 'Agent handled' }); // Mock agent response

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
            expect(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender.id);
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
            (mockAgentService.processComplexIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'chat_reply', message: 'Agent handled' }); // Mock agent response
            expect(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender.id);
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
            (mockAgentService.processComplexIntent as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'chat_reply', message: 'Agent handled this.' });
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
            expect(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender.id);
            // Assuming AgentService sends its own results now
            // expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, { type: 'chat_reply', message: 'Agent handled this.' });
        });

        it('should send error if AgentService fails', async () => {
            const intentText = 'some complex query';
            const errorMessage = 'Agent exploded!';
            (mockAgentService.processComplexIntent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(errorMessage));

            await intentService.handleIntent({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender);

            expect(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ 
                intentText,
                context: 'notebook', notebookId: 'test-notebook'
            }, mockSender.id);
            expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, {
                type: 'error',
                message: `Error processing your request: ${errorMessage}`,
            });
        });
    });
}); 