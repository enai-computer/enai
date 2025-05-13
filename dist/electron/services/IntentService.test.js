"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const IntentService_1 = require("./IntentService");
const ipcChannels_1 = require("../shared/ipcChannels");
// Mock logger to prevent console output during tests and allow assertions
vitest_1.vi.mock('../utils/logger', () => ({
    logger: {
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
    },
}));
// Mock services
const mockNotebookService = {
    createNotebook: vitest_1.vi.fn(),
    getAllNotebooks: vitest_1.vi.fn(),
    deleteNotebook: vitest_1.vi.fn(),
};
const mockAgentService = {
    processComplexIntent: vitest_1.vi.fn(),
};
// Mock WebContents for sender
const mockSender = {
    send: vitest_1.vi.fn(),
    id: 1, // Mock sender ID
};
(0, vitest_1.describe)('IntentService', () => {
    let intentService;
    (0, vitest_1.beforeEach)(() => {
        // Reset mocks before each test
        vitest_1.vi.clearAllMocks();
        intentService = new IntentService_1.IntentService(mockNotebookService, mockAgentService);
    });
    (0, vitest_1.describe)('Notebook Creation Intents', () => {
        (0, vitest_1.it)('should handle "create notebook <title>" intent', async () => {
            const title = 'My New Notebook';
            const mockNewNotebook = { id: 'notebook-1', title, description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-1' };
            mockNotebookService.createNotebook.mockResolvedValue(mockNewNotebook);
            await intentService.handleIntent({ intentText: `create notebook ${title}` }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.createNotebook).toHaveBeenCalledWith(title);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: mockNewNotebook.id,
                title: mockNewNotebook.title,
            });
        });
        (0, vitest_1.it)('should handle "new notebook <title>" intent', async () => {
            const title = 'Another New Notebook';
            const mockNewNotebook = { id: 'notebook-2', title, description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-2' };
            mockNotebookService.createNotebook.mockResolvedValue(mockNewNotebook);
            await intentService.handleIntent({ intentText: `new notebook ${title}` }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.createNotebook).toHaveBeenCalledWith(title);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: mockNewNotebook.id,
                title: mockNewNotebook.title,
            });
        });
        (0, vitest_1.it)('should send error if create notebook intent has no title', async () => {
            await intentService.handleIntent({ intentText: 'create notebook ' }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.createNotebook).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please provide a title for the new notebook.',
            });
        });
    });
    (0, vitest_1.describe)('Notebook Open/Find Intents', () => {
        const notebooks = [
            { id: 'nb-1', title: 'Alpha Book', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-nb1' },
            { id: 'nb-2', title: 'Beta Book', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-nb2' },
        ];
        (0, vitest_1.beforeEach)(() => {
            mockNotebookService.getAllNotebooks.mockResolvedValue(notebooks);
        });
        (0, vitest_1.it)('should handle "open notebook <name>" and find existing notebook', async () => {
            const notebookName = 'Alpha Book';
            await intentService.handleIntent({ intentText: `open notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).toHaveBeenCalled();
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-1',
                title: notebookName,
            });
        });
        (0, vitest_1.it)('should handle "find notebook <name>" and find existing notebook', async () => {
            const notebookName = 'Beta Book';
            await intentService.handleIntent({ intentText: `find notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-2',
                title: notebookName,
            });
        });
        (0, vitest_1.it)('should handle "show notebook <name>" and find existing notebook', async () => {
            const notebookName = 'Alpha Book';
            await intentService.handleIntent({ intentText: `show notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'nb-1',
                title: notebookName,
            });
        });
        (0, vitest_1.it)('should send chat_reply if notebook to open is not found', async () => {
            const notebookName = 'Gamma Book';
            await intentService.handleIntent({ intentText: `open notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" not found.`,
            });
        });
        (0, vitest_1.it)('should send error if open/find notebook intent has no name', async () => {
            await intentService.handleIntent({ intentText: 'open notebook ' }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please specify which notebook to open or find.',
            });
        });
    });
    (0, vitest_1.describe)('Notebook Deletion Intents', () => {
        const notebooks = [
            { id: 'nb-del-1', title: 'Delete Me', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-del1' },
            { id: 'nb-del-2', title: 'Also Delete', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-del2' },
        ];
        (0, vitest_1.beforeEach)(() => {
            mockNotebookService.getAllNotebooks.mockResolvedValue(notebooks);
            mockNotebookService.deleteNotebook.mockResolvedValue(undefined); // Assume deleteNotebook resolves if successful
        });
        (0, vitest_1.it)('should handle "delete notebook <name>" and delete existing notebook', async () => {
            const notebookName = 'Delete Me';
            await intentService.handleIntent({ intentText: `delete notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).toHaveBeenCalled();
            (0, vitest_1.expect)(mockNotebookService.deleteNotebook).toHaveBeenCalledWith('nb-del-1');
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" has been deleted.`,
            });
        });
        (0, vitest_1.it)('should handle "rm notebook <name>" and delete existing notebook', async () => {
            const notebookName = 'Also Delete';
            await intentService.handleIntent({ intentText: `rm notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.deleteNotebook).toHaveBeenCalledWith('nb-del-2');
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" has been deleted.`,
            });
        });
        (0, vitest_1.it)('should send chat_reply if notebook to delete is not found', async () => {
            const notebookName = 'NonExistent Book';
            await intentService.handleIntent({ intentText: `delete notebook ${notebookName}` }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'chat_reply',
                message: `Notebook "${notebookName}" not found. Cannot delete.`,
            });
        });
        (0, vitest_1.it)('should send error if delete notebook intent has no name', async () => {
            await intentService.handleIntent({ intentText: 'delete notebook ' }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'error',
                message: 'Please specify which notebook to delete.',
            });
        });
    });
    (0, vitest_1.describe)('Direct Notebook Title Match', () => {
        const notebooks = [
            { id: 'direct-nb-1', title: 'My Cool Notebook', description: null, createdAt: Date.now(), updatedAt: Date.now(), objectId: 'obj-direct1' },
        ];
        (0, vitest_1.beforeEach)(() => {
            mockNotebookService.getAllNotebooks.mockResolvedValue(notebooks);
        });
        (0, vitest_1.it)('should open notebook if intent text exactly matches a notebook title (case-insensitive)', async () => {
            const notebookTitle = 'my cool notebook'; // Test case-insensitivity
            await intentService.handleIntent({ intentText: notebookTitle }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1); // Called once for direct match
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_notebook',
                notebookId: 'direct-nb-1',
                title: 'My Cool Notebook',
            });
        });
        (0, vitest_1.it)('should not open notebook if intent text is a partial match but not exact for direct title', async () => {
            const notebookTitle = 'My Cool';
            // This should fall through to AgentService because no pattern matches and direct match fails
            mockAgentService.processComplexIntent.mockResolvedValue({ type: 'chat_reply', message: 'Agent processed' });
            await intentService.handleIntent({ intentText: notebookTitle }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(mockSender.send).not.toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, vitest_1.expect.objectContaining({ type: 'open_notebook' }));
            (0, vitest_1.expect)(mockAgentService.processComplexIntent).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('URL Intents', () => {
        (0, vitest_1.it)('should handle fully qualified http URL', async () => {
            const url = 'http://example.com/path?query=value#fragment';
            await intentService.handleIntent({ intentText: url }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_url',
                url: url,
            });
        });
        (0, vitest_1.it)('should handle fully qualified https URL', async () => {
            const url = 'https://sub.example.co.uk/another/path';
            await intentService.handleIntent({ intentText: url }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_url',
                url: url,
            });
        });
        (0, vitest_1.it)('should prepend http:// to schemeless domain.tld URLs', async () => {
            const inputUrl = 'google.com';
            const expectedUrl = 'http://google.com';
            await intentService.handleIntent({ intentText: inputUrl }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_url',
                url: expectedUrl,
            });
        });
        (0, vitest_1.it)('should prepend http:// to schemeless domain.tld/path URLs', async () => {
            const inputUrl = 'news.ycombinator.com/news?p=2';
            const expectedUrl = 'http://news.ycombinator.com/news?p=2';
            await intentService.handleIntent({ intentText: inputUrl }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_url',
                url: expectedUrl,
            });
        });
        (0, vitest_1.it)('should not match a malformed/incomplete "URL" like string with spaces, and fall through to AgentService', async () => {
            const intentText = 'example com not a url'; // Contains space, fails regex
            mockAgentService.processComplexIntent.mockResolvedValue({ type: 'chat_reply', message: 'Agent handled' }); // Mock agent response
            await intentService.handleIntent({ intentText }, mockSender);
            // Ensure open_url was NOT called
            (0, vitest_1.expect)(mockSender.send).not.toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, vitest_1.expect.objectContaining({ type: 'open_url' }));
            // Ensure the specific error from handleOpenUrl was NOT called
            (0, vitest_1.expect)(mockSender.send).not.toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'error',
                message: `Input "${intentText}" looks like an incomplete URL.`,
            });
            // Ensure AgentService was called
            (0, vitest_1.expect)(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ intentText });
        });
        (0, vitest_1.it)('should fall through to AgentService for schemeless input without a clear TLD pattern (e.g. lacking a dot)', async () => {
            const intentText = 'localhost:3000'; // common but regex might not catch without a scheme or TLD like .com
            // The current regex might handle this if it matches the domain.tld part broadly.
            // Let's test against the specific logic in handleOpenUrl if it doesn't get a scheme.
            await intentService.handleIntent({ intentText }, mockSender);
            // Depending on how strictly the regex and scheme check are, this could either be an error 
            // or fall through. The current handleOpenUrl logic will error if http:// isn't prepended.
            // Our current regex: /^((?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[\/\w\.\-%~?&=#]*)*)/i
            // localhost:3000 does not match this because it lacks a `.[a-z]{2,}` part for a TLD.
            // So it should fall through to AgentService.
            (0, vitest_1.expect)(mockSender.send).not.toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, vitest_1.expect.objectContaining({ type: 'open_url' }));
            mockAgentService.processComplexIntent.mockResolvedValue({ type: 'chat_reply', message: 'Agent handled' }); // Mock agent response
            (0, vitest_1.expect)(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ intentText });
        });
        (0, vitest_1.it)('should handle domain with hyphen and numbers', async () => {
            const inputUrl = 'my-awesome-site123.co.uk/path';
            const expectedUrl = 'http://my-awesome-site123.co.uk/path';
            await intentService.handleIntent({ intentText: inputUrl }, mockSender);
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'open_url',
                url: expectedUrl,
            });
        });
    });
    (0, vitest_1.describe)('Fallback to AgentService', () => {
        (0, vitest_1.beforeEach)(() => {
            // Ensure no notebooks match directly for these tests
            mockNotebookService.getAllNotebooks.mockResolvedValue([]);
            mockAgentService.processComplexIntent.mockResolvedValue({ type: 'chat_reply', message: 'Agent handled this.' });
        });
        (0, vitest_1.it)('should delegate to AgentService if no patterns match and no direct notebook title match', async () => {
            const intentText = 'what is the weather today?';
            await intentService.handleIntent({ intentText }, mockSender);
            (0, vitest_1.expect)(mockNotebookService.createNotebook).not.toHaveBeenCalled();
            (0, vitest_1.expect)(mockNotebookService.deleteNotebook).not.toHaveBeenCalled();
            // getAllNotebooks will be called for direct match attempt
            (0, vitest_1.expect)(mockNotebookService.getAllNotebooks).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ intentText });
            // Assuming AgentService sends its own results now
            // expect(mockSender.send).toHaveBeenCalledWith(ON_INTENT_RESULT, { type: 'chat_reply', message: 'Agent handled this.' });
        });
        (0, vitest_1.it)('should send error if AgentService fails', async () => {
            const intentText = 'some complex query';
            const errorMessage = 'Agent exploded!';
            mockAgentService.processComplexIntent.mockRejectedValue(new Error(errorMessage));
            await intentService.handleIntent({ intentText }, mockSender);
            (0, vitest_1.expect)(mockAgentService.processComplexIntent).toHaveBeenCalledWith({ intentText });
            (0, vitest_1.expect)(mockSender.send).toHaveBeenCalledWith(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'error',
                message: `Error processing your request: ${errorMessage}`,
            });
        });
    });
});
//# sourceMappingURL=IntentService.test.js.map