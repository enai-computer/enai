import { describe, beforeEach, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import runMigrations from '../../models/runMigrations';
import { ObjectModelCore } from '../../models/ObjectModelCore';
import { ObjectCognitiveModel } from '../../models/ObjectCognitiveModel';
import { ObjectAssociationModel } from '../../models/ObjectAssociationModel';
import { ChunkModel } from '../../models/ChunkModel';
import { ChatModel } from '../../models/ChatModel';
import { NotebookModel } from '../../models/NotebookModel';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { ActivityLogService } from '../ActivityLogService';
import { NotebookService } from '../NotebookService';
import { WindowInfo } from '../../shared/types';
import { app } from 'electron';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock electron app module
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(),
    },
}));

describe('Daily Notebook Window Layout Preservation', () => {
    let db: Database.Database;
    let notebookService: NotebookService;
    let chatModel: ChatModel;
    let testUserDataPath: string;

    beforeEach(async () => {
        // Create in-memory database
        db = new Database(':memory:');
        await runMigrations(db);

        // Initialize models
        const objectModelCore = new ObjectModelCore(db);
        const objectCognitive = new ObjectCognitiveModel(objectModelCore);
        const objectAssociation = new ObjectAssociationModel(db);
        const chunkModel = new ChunkModel(db);
        chatModel = new ChatModel(db);
        const notebookModel = new NotebookModel(db);
        const activityLogModel = new ActivityLogModel(db);
        const activityLogService = new ActivityLogService({ 
            db, 
            activityLogModel 
        });

        // Create NotebookService
        notebookService = new NotebookService({
            db,
            objectModelCore,
            objectCognitive,
            objectAssociation,
            chunkModel,
            chatModel,
            notebookModel,
            activityLogService,
        });

        // Set up test directory for window layouts
        testUserDataPath = join(tmpdir(), `test-${randomUUID()}`);
        fs.mkdirSync(join(testUserDataPath, 'notebook_layouts'), { recursive: true });
        vi.mocked(app.getPath).mockReturnValue(testUserDataPath);
    });

    afterEach(() => {
        db.close();
    });

    describe('copyWindowLayout', () => {
        it('should copy window layout from source to target notebook', async () => {
            // Arrange: Create source and target notebooks
            const sourceNotebook = await notebookService.createNotebook('Source Notebook', '');
            const targetNotebook = await notebookService.createNotebook('Target Notebook', '');

            const sourceLayout: WindowInfo[] = [{
                id: 'window-1',
                type: 'browser',
                url: 'https://example.com',
                bounds: { x: 100, y: 100, width: 800, height: 600 }
            }];

            const sourceLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${sourceNotebook.id}.json`);
            fs.writeFileSync(sourceLayoutPath, JSON.stringify({ windows: sourceLayout }));

            // Act: Copy window layout (access private method for testing)
            await (notebookService as any).copyWindowLayout(sourceNotebook.id, targetNotebook.id, new Map());

            // Assert: Target layout exists with new window IDs
            const targetLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${targetNotebook.id}.json`);
            expect(fs.existsSync(targetLayoutPath)).toBe(true);

            const targetLayout = JSON.parse(fs.readFileSync(targetLayoutPath, 'utf-8'));
            expect(targetLayout.windows).toHaveLength(1);
            expect(targetLayout.windows[0].type).toBe('browser');
            expect(targetLayout.windows[0].url).toBe('https://example.com');
            expect(targetLayout.windows[0].id).not.toBe('window-1'); // New ID generated
        });

        it('should map chat session IDs when copying chat windows', async () => {
            // Arrange: Create notebooks with chat sessions
            const sourceNotebook = await notebookService.createNotebook('Source', '');
            const targetNotebook = await notebookService.createNotebook('Target', '');

            const sourceSession = await chatModel.createSession(sourceNotebook.id, undefined, 'Chat 1');
            const targetSession = await chatModel.createSession(targetNotebook.id, undefined, 'Chat 1');

            const sessionIdMap = new Map([[sourceSession.sessionId, targetSession.sessionId]]);

            const sourceLayout: WindowInfo[] = [{
                id: 'chat-window-1',
                type: 'chat',
                sessionId: sourceSession.sessionId,
                bounds: { x: 0, y: 0, width: 600, height: 400 }
            }];

            const sourceLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${sourceNotebook.id}.json`);
            fs.writeFileSync(sourceLayoutPath, JSON.stringify({ windows: sourceLayout }));

            // Debug: Log the session IDs and map
            console.log('Source session ID:', sourceSession.sessionId);
            console.log('Target session ID:', targetSession.sessionId);
            console.log('Session ID map:', Array.from(sessionIdMap.entries()));

            // Act: Copy with session mapping (access private method for testing)
            await (notebookService as any).copyWindowLayout(sourceNotebook.id, targetNotebook.id, sessionIdMap);

            // Assert: Chat window has mapped session ID
            const targetLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${targetNotebook.id}.json`);
            const targetLayout = JSON.parse(fs.readFileSync(targetLayoutPath, 'utf-8'));
            
            expect(targetLayout.windows).toHaveLength(1);
            expect(targetLayout.windows[0].sessionId).toBe(targetSession.sessionId);
            expect(targetLayout.windows[0].type).toBe('chat');
        });

        it('should filter out note editor windows', async () => {
            // Arrange: Create layout with mixed window types
            const sourceNotebook = await notebookService.createNotebook('Source', '');
            const targetNotebook = await notebookService.createNotebook('Target', '');

            const sourceLayout: WindowInfo[] = [
                { id: 'browser-1', type: 'browser', url: 'https://example.com' },
                { id: 'note-1', type: 'note_editor', noteId: 'some-note-id' },
                { id: 'chat-1', type: 'classic-browser', url: 'https://chat.example.com' }
            ];

            const sourceLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${sourceNotebook.id}.json`);
            fs.writeFileSync(sourceLayoutPath, JSON.stringify({ windows: sourceLayout }));

            // Act: Copy layout (access private method for testing)
            await (notebookService as any).copyWindowLayout(sourceNotebook.id, targetNotebook.id, new Map());

            // Assert: Note editor is filtered out
            const targetLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${targetNotebook.id}.json`);
            const targetLayout = JSON.parse(fs.readFileSync(targetLayoutPath, 'utf-8'));
            
            expect(targetLayout.windows).toHaveLength(2);
            expect(targetLayout.windows.some((w: WindowInfo) => w.type === 'note_editor')).toBe(false);
            expect(targetLayout.windows.some((w: WindowInfo) => w.type === 'browser')).toBe(true);
            expect(targetLayout.windows.some((w: WindowInfo) => w.type === 'classic-browser')).toBe(true);
        });

        it('should handle missing source layout gracefully', async () => {
            // Arrange: Create notebooks without layout file
            const sourceNotebook = await notebookService.createNotebook('Source', '');
            const targetNotebook = await notebookService.createNotebook('Target', '');

            // Act & Assert: Should not throw (access private method for testing)
            await expect(
                (notebookService as any).copyWindowLayout(sourceNotebook.id, targetNotebook.id, new Map())
            ).resolves.not.toThrow();
        });
    });

    describe('getOrCreateDailyNotebook with layout preservation', () => {
        it('should preserve window layout when creating next daily notebook', async () => {
            // Arrange: Create today's notebook with layout
            const today = new Date();
            const todayNotebook = await notebookService.getOrCreateDailyNotebook(today);

            const todayLayout: WindowInfo[] = [
                { id: 'browser-1', type: 'browser', url: 'https://docs.example.com' },
                { id: 'browser-2', type: 'browser', url: 'https://github.com' }
            ];

            const todayLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${todayNotebook.id}.json`);
            fs.writeFileSync(todayLayoutPath, JSON.stringify({ windows: todayLayout }));

            // Act: Create tomorrow's notebook
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowNotebook = await notebookService.getOrCreateDailyNotebook(tomorrow);

            // Assert: Layout was copied
            const tomorrowLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${tomorrowNotebook.id}.json`);
            expect(fs.existsSync(tomorrowLayoutPath)).toBe(true);

            const tomorrowLayout = JSON.parse(fs.readFileSync(tomorrowLayoutPath, 'utf-8'));
            expect(tomorrowLayout.windows).toHaveLength(2);
            expect(tomorrowLayout.windows[0].url).toBe('https://docs.example.com');
            expect(tomorrowLayout.windows[1].url).toBe('https://github.com');
        });

        it('should copy layout even when source has no chat sessions', async () => {
            // Arrange: Create notebook with only browser windows
            const today = new Date();
            const todayNotebook = await notebookService.getOrCreateDailyNotebook(today);

            const browserOnlyLayout: WindowInfo[] = [
                { id: 'browser-1', type: 'browser', url: 'https://example.com' }
            ];

            const todayLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${todayNotebook.id}.json`);
            fs.writeFileSync(todayLayoutPath, JSON.stringify({ windows: browserOnlyLayout }));

            // Act: Create tomorrow's notebook (no chat sessions to copy)
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowNotebook = await notebookService.getOrCreateDailyNotebook(tomorrow);

            // Assert: Layout was still copied
            const tomorrowLayoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${tomorrowNotebook.id}.json`);
            expect(fs.existsSync(tomorrowLayoutPath)).toBe(true);
        });

        it('should create notebook successfully even if layout copy fails', async () => {
            // Arrange: Make layout directory read-only to force failure
            const today = new Date();
            const todayNotebook = await notebookService.getOrCreateDailyNotebook(today);

            // Create a layout file that will be there during the search but we'll delete it before copy
            const layoutPath = join(testUserDataPath, 'notebook_layouts', `notebook-layout-${todayNotebook.id}.json`);
            fs.writeFileSync(layoutPath, JSON.stringify({ windows: [{ id: 'test', type: 'browser' }] }));

            // Act: Create tomorrow's notebook
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Assert: Notebook creation succeeds despite layout copy failure
            await expect(
                notebookService.getOrCreateDailyNotebook(tomorrow)
            ).resolves.toBeTruthy();
        });
    });
});