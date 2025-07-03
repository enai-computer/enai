import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDb, cleanTestDb } from './testUtils';
import { ChatModel } from '../ChatModel'; 
import { IChatMessage, IChatSession, ChatMessageRole } from '../../shared/types';
import { NotebookModel } from '../NotebookModel';
import { NotebookRecord } from '../../shared/types';
import { randomUUID } from 'crypto';
import { ChatMessageSourceMetadata } from '../../shared/types';

let db: Database.Database;
let chatModel: ChatModel;
let notebookModel: NotebookModel;
let testNotebook: NotebookRecord;

describe('ChatModel', () => {
    beforeAll(() => {
        db = setupTestDb();
    });

    afterAll(() => {
        db.close();
    });

    beforeEach(async () => {
        cleanTestDb(db);
        chatModel = new ChatModel(db);
        notebookModel = new NotebookModel(db);
        testNotebook = await notebookModel.create(randomUUID(), 'Test Default Notebook', null, 'For chat tests');
    });

    describe('createSession', () => {
        it('should create a new chat session', async () => {
            const title = 'My Test Session';
            const session = await chatModel.createSession(testNotebook.id, undefined, title);
            
            expect(session).toBeDefined();
            expect(session.notebookId).toBe(testNotebook.id);
            expect(session.title).toBe(title);
            expect(session.createdAt).toEqual(session.updatedAt);
        });
    
        it('should return existing session when creating with duplicate sessionId', async () => {
            const explicitSessionId = randomUUID();
            const firstSession = await chatModel.createSession(testNotebook.id, explicitSessionId, 'First');
            const secondAttempt = await chatModel.createSession(testNotebook.id, explicitSessionId, 'Second');
            
            expect(secondAttempt.sessionId).toBe(firstSession.sessionId);
            expect(secondAttempt.title).toBe('First');
        });
    
        it('should throw error for duplicate sessionId with different notebookId', async () => {
            const explicitSessionId = randomUUID();
            await chatModel.createSession(testNotebook.id, explicitSessionId, 'Original');
            const anotherNotebook = await notebookModel.create(randomUUID(), 'Another', null, 'Desc');
            
            await expect(chatModel.createSession(anotherNotebook.id, explicitSessionId, 'Conflict'))
                .rejects
                .toThrow(`Session ID ${explicitSessionId} conflict`);
        });
    
        it('should throw error for invalid notebookId', async () => {
            const nonExistentNotebookId = randomUUID();
            await expect(chatModel.createSession(nonExistentNotebookId, undefined, 'Invalid'))
                .rejects
                .toThrow(`Invalid notebook ID ${nonExistentNotebookId}`);
        });
    });

    describe('getSessionById', () => {
        it('should retrieve an existing session by its ID', async () => {
            const createdSession = await chatModel.createSession(testNotebook.id, undefined, 'SessionToGet');
            const fetchedSession = await chatModel.getSessionById(createdSession.sessionId);
            
            expect(fetchedSession?.sessionId).toBe(createdSession.sessionId);
            expect(fetchedSession?.title).toBe('SessionToGet');
        });

        it('should return null for non-existent session', async () => {
            const fetchedSession = await chatModel.getSessionById(randomUUID());
            expect(fetchedSession).toBeNull();
        });
    });

    describe('updateSessionTitle', () => {
        it('should update the title and updated_at timestamp', async () => {
            const session = await chatModel.createSession(testNotebook.id, undefined, 'Original Title');
            const originalUpdatedAt = session.updatedAt.getTime();
            
            await new Promise(resolve => setTimeout(resolve, 50));
            const updatedSession = await chatModel.updateSessionTitle(session.sessionId, 'New Title');
            
            expect(updatedSession?.title).toBe('New Title');
            expect(updatedSession!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt);
        });

        it('should return null for non-existent session', async () => {
            const result = await chatModel.updateSessionTitle(randomUUID(), 'No Session');
            expect(result).toBeNull();
        });
    });

    describe('listSessions', () => {
        it('should list sessions ordered by updated_at descending', async () => {
            const session1 = await chatModel.createSession(testNotebook.id);
            await new Promise(resolve => setTimeout(resolve, 10)); 
            const session2 = await chatModel.createSession(testNotebook.id);
            await new Promise(resolve => setTimeout(resolve, 10));
            await chatModel.addMessage({ sessionId: session1.sessionId, role: 'user', content: 'Update S1', metadata: null });

            const sessions = await chatModel.listSessions();
            expect(sessions[0].sessionId).toBe(session1.sessionId);
            expect(sessions[1].sessionId).toBe(session2.sessionId);
        });
    });

    describe('listSessionsForNotebook', () => {
        it('should list all sessions for a specific notebook', async () => {
            const notebook2 = await notebookModel.create(randomUUID(), 'Notebook Two', null, 'For listing');
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 1 NB1');
            await chatModel.createSession(notebook2.id, undefined, 'Chat 1 NB2');
            await chatModel.createSession(testNotebook.id, undefined, 'Chat 2 NB1');

            const sessionsForNb1 = await chatModel.listSessionsForNotebook(testNotebook.id);
            expect(sessionsForNb1.length).toBe(2);
            sessionsForNb1.forEach(s => expect(s.notebookId).toBe(testNotebook.id));

            const sessionsForNb2 = await chatModel.listSessionsForNotebook(notebook2.id);
            expect(sessionsForNb2.length).toBe(1);
            expect(sessionsForNb2[0].title).toBe('Chat 1 NB2');
        });
    });

    describe('updateChatNotebook', () => {
        it('should update the notebook_id and updated_at for a session', async () => {
            const sessionToMove = await chatModel.createSession(testNotebook.id, undefined, 'To Move');
            const targetNotebook = await notebookModel.create(randomUUID(), 'Target', null, 'For transfer');
            
            const result = await chatModel.updateChatNotebook(sessionToMove.sessionId, targetNotebook.id);
            expect(result).toBe(true);

            const updatedSession = await chatModel.getSessionById(sessionToMove.sessionId);
            expect(updatedSession?.notebookId).toBe(targetNotebook.id);
        });

        it('should throw error for invalid target notebook', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await expect(chatModel.updateChatNotebook(session.sessionId, randomUUID()))
                .rejects
                .toThrow();
        });
    });

    describe('addMessage', () => {
        let sessionId: string;
        beforeEach(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.sessionId;
        });

        it('should add messages with and without metadata', async () => {
            const metadata: ChatMessageSourceMetadata = { sourceChunkIds: [10, 20] };
            const withMeta = await chatModel.addMessage({ 
                sessionId, 
                role: 'user', 
                content: 'With metadata', 
                metadata 
            });
            const withoutMeta = await chatModel.addMessage({ 
                sessionId, 
                role: 'assistant', 
                content: 'No metadata', 
                metadata: null 
            });

            expect(withMeta.metadata).toBe(JSON.stringify(metadata));
            expect(withoutMeta.metadata).toBeNull();
        });

        it('should update session updated_at when adding message', async () => {
            const session = await chatModel.getSessionById(sessionId);
            const initialUpdate = session!.updatedAt.getTime();
            await new Promise(resolve => setTimeout(resolve, 50));

            const newMessage = await chatModel.addMessage({ sessionId, role: 'user', content: 'Test' });
            const updatedSession = await chatModel.getSessionById(sessionId);

            expect(updatedSession!.updatedAt.getTime()).toBeGreaterThan(initialUpdate);
            expect(updatedSession!.updatedAt.getTime()).toBeCloseTo(newMessage.timestamp.getTime(), 50);
        });

        it('should throw error for non-existent session', async () => {
            await expect(chatModel.addMessage({ 
                sessionId: randomUUID(), 
                role: 'user', 
                content: 'msg' 
            })).rejects.toThrow();
        });
    });

    describe('getMessagesBySessionId', () => {
        let sessionId: string;
        let messages: IChatMessage[];

        beforeEach(async () => {
            const session = await chatModel.createSession(testNotebook.id);
            sessionId = session.sessionId;
            
            messages = [];
            messages.push(await chatModel.addMessage({ sessionId, role: 'user', content: 'Message 1' }));
            await new Promise(resolve => setTimeout(resolve, 5));
            messages.push(await chatModel.addMessage({ 
                sessionId, 
                role: 'assistant', 
                content: 'Message 2', 
                metadata: { sourceChunkIds: [5] } 
            }));
            await new Promise(resolve => setTimeout(resolve, 5));
            messages.push(await chatModel.addMessage({ sessionId, role: 'user', content: 'Message 3' }));
        });

        it('should retrieve all messages in ascending order', async () => {
            const retrieved = await chatModel.getMessagesBySessionId(sessionId);
            expect(retrieved.length).toBe(3);
            expect(retrieved.map(m => m.messageId)).toEqual(messages.map(m => m.messageId));
        });

        it('should retrieve messages with limit', async () => {
            const retrieved = await chatModel.getMessagesBySessionId(sessionId, 2);
            expect(retrieved.length).toBe(2);
            expect(retrieved[0].messageId).toBe(messages[1].messageId);
        });

        it('should retrieve messages before timestamp', async () => {
            const retrieved = await chatModel.getMessagesBySessionId(sessionId, undefined, messages[1].timestamp);
            expect(retrieved).toHaveLength(1);
            expect(retrieved[0].messageId).toBe(messages[0].messageId);
        });
    });

    describe('deleteSession', () => {
        it('should delete a session and all its messages', async () => {
            const session = await chatModel.createSession(testNotebook.id);
            await chatModel.addMessage({ sessionId: session.sessionId, role: 'user', content: 'Delete me' });
            
            await chatModel.deleteSession(session.sessionId);
            
            expect(await chatModel.getSessionById(session.sessionId)).toBeNull();
            expect(await chatModel.getMessagesBySessionId(session.sessionId)).toHaveLength(0);
        });
    });

    describe('Core Chat Flow Integration', () => {
        it('should create session, add messages, and retrieve them', async () => {
            const newSession = await chatModel.createSession(testNotebook.id); 
            const sessionId = newSession.sessionId;
            
            const userMessage = await chatModel.addMessage({
                sessionId,
                role: 'user' as ChatMessageRole,
                content: 'Hello, assistant!',
                metadata: null
            });
            
            const assistantMessage = await chatModel.addMessage({
                sessionId,
                role: 'assistant' as ChatMessageRole,
                content: 'Hello, user! How can I help?',
            });

            const retrievedMessages = await chatModel.getMessagesBySessionId(sessionId);
            expect(retrievedMessages).toHaveLength(2);
            expect(retrievedMessages[0].messageId).toBe(userMessage.messageId);
            expect(retrievedMessages[1].messageId).toBe(assistantMessage.messageId);
        });
    });
});