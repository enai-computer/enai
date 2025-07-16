import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ToDoService } from '../ToDoService';
import { ToDoModel } from '../../models/ToDoModel';
import { ToDoItem, ToDoCreatePayload, ToDoUpdatePayload, ToDoStatus } from '../../shared/types';
import { ActivityLogService } from '../ActivityLogService';
import { ActivityLogModel } from '../../models/ActivityLogModel';
import { UserProfileModel } from '../../models/UserProfileModel';
import { ProfileService } from '../ProfileService';
import runMigrations from '../../models/runMigrations';
import { logger } from '../../utils/logger';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ToDoService with BaseService', () => {
    let db: Database.Database;
    let todoModel: ToDoModel;
    let todoService: ToDoService;
    let activityLogService: ActivityLogService;
    let profileService: ProfileService;

    beforeEach(async () => {
        // Create in-memory database
        db = new Database(':memory:');
        await runMigrations(db);
        
        // Initialize models
        todoModel = new ToDoModel(db);
        const activityLogModel = new ActivityLogModel(db);
        const userProfileModel = new UserProfileModel(db);
        
        // Initialize services
        profileService = new ProfileService({
            db,
            userProfileModel
        });
        
        activityLogService = new ActivityLogService({
            db,
            activityLogModel,
            profileService
        });
        
        // Create service with dependency injection
        todoService = new ToDoService({
            db,
            toDoModel: todoModel,
            activityLogService
        });
        
        // Initialize service
        await todoService.initialize();
    });

    afterEach(async () => {
        // Cleanup service
        await todoService.cleanup();
        
        if (db && db.open) {
            db.close();
        }
        
        vi.clearAllMocks();
    });

    describe('Constructor and BaseService integration', () => {
        it('should initialize with proper dependencies', () => {
            expect(todoService).toBeDefined();
            expect(logger.info).toHaveBeenCalledWith('[ToDoService] Initialized.');
        });

        it('should inherit BaseService functionality', async () => {
            // Test that getToDos works
            const todos = await todoService.getToDos('test_user');
            
            // Should log the operation
            expect(logger.debug).toHaveBeenCalledWith(
                '[ToDoService] Getting todos:',
                { userId: 'test_user', status: undefined, parentTodoId: undefined }
            );
        });
    });

    describe('Lifecycle methods', () => {
        it('should support initialize method', async () => {
            // Already called in beforeEach, create a new instance to test
            const newService = new ToDoService({
                db,
                toDoModel: todoModel,
                activityLogService
            });
            await expect(newService.initialize()).resolves.toBeUndefined();
        });

        it('should support cleanup method', async () => {
            // ToDoService doesn't have resources to clean up, so it should be a no-op
            await expect(todoService.cleanup()).resolves.toBeUndefined();
        });

        it('should support health check', async () => {
            const isHealthy = await todoService.healthCheck();
            expect(isHealthy).toBe(true);
        });
    });

    describe('Error handling with BaseService', () => {
        it('should use execute wrapper for error handling', async () => {
            // Mock the model to throw an error
            vi.spyOn(todoModel, 'getToDosForUser').mockImplementation(() => {
                throw new Error('Database connection lost');
            });

            await expect(todoService.getToDos('test_user')).rejects.toThrow('Database connection lost');
            
            // Should log the error with proper context
            expect(logger.error).toHaveBeenCalledWith(
                '[ToDoService] Error getting todos:',
                expect.any(Error)
            );
        });
    });

    describe('Dependency injection patterns', () => {
        it('should work with mocked dependencies', async () => {
            // Create a fully mocked ToDoModel
            const mockToDoModel = {
                createToDo: vi.fn().mockImplementation(() => ({
                    id: 'mock-1',
                    userId: 'mock_user',
                    title: 'Mock Todo',
                    status: 'pending' as ToDoStatus,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                })),
                updateToDo: vi.fn().mockImplementation((id: string, updates: any) => ({
                    id,
                    ...updates,
                    updatedAt: new Date().toISOString()
                })),
                getToDosForUser: vi.fn().mockReturnValue([
                    {
                        id: 'mock-1',
                        userId: 'mock_user',
                        title: 'Mock Todo',
                        status: 'pending' as ToDoStatus,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }
                ]),
                deleteToDo: vi.fn(),
                getToDoById: vi.fn()
            } as unknown as ToDoModel;

            // Create service with mocked dependencies
            const serviceWithMocks = new ToDoService({
                db,
                toDoModel: mockToDoModel,
                activityLogService
            });

            const todos = await serviceWithMocks.getToDos('mock_user');
            
            expect(mockToDoModel.getToDosForUser).toHaveBeenCalledWith('mock_user', undefined, undefined);
            expect(todos).toHaveLength(1);
            expect(todos[0].title).toBe('Mock Todo');
        });

        it('should allow testing without database', async () => {
            // Create a stub model that doesn't need a real database
            const stubModel = {
                createToDo: vi.fn().mockImplementation(() => ({
                    id: 'stub-1',
                    userId: 'stub_user',
                    title: 'Test Todo',
                    status: 'pending' as ToDoStatus,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                })),
                updateToDo: vi.fn(),
                getToDosForUser: vi.fn().mockReturnValue([]),
                deleteToDo: vi.fn(),
                getToDoById: vi.fn()
            } as unknown as ToDoModel;

            const serviceWithStub = new ToDoService({
                db: {} as Database.Database, // Dummy db object
                toDoModel: stubModel,
                activityLogService
            });

            const newTodo = await serviceWithStub.createToDo('stub_user', {
                title: 'Test Todo'
            });
            
            expect(stubModel.createToDo).toHaveBeenCalled();
            expect(newTodo.title).toBe('Test Todo');
        });
    });

    describe('createToDo', () => {
        it('should create a new todo', async () => {
            const todo = await todoService.createToDo('test_user', {
                title: 'Test Todo'
            });

            expect(todo.id).toBeDefined();
            expect(todo.title).toBe('Test Todo');
            expect(todo.status).toBe('pending');
            expect(todo.userId).toBe('test_user');
            expect(todo.createdAt).toBeDefined();
            expect(todo.updatedAt).toBeDefined();
        });

        it('should handle optional fields', async () => {
            const todo = await todoService.createToDo('test_user', {
                title: 'Test Todo with Extras',
                description: 'This is a description',
                priority: 1,
                dueDate: new Date(Date.now() + 86400000).toISOString() // Tomorrow
            });

            expect(todo.description).toBe('This is a description');
            expect(todo.priority).toBe(1);
            expect(todo.dueDate).toBeDefined();
        });
    });

    describe('updateToDo', () => {
        let existingTodo: ToDoItem;

        beforeEach(async () => {
            existingTodo = await todoService.createToDo('test_user', {
                title: 'Original Title'
            });
        });

        it('should update todo properties', async () => {
            const updated = await todoService.updateToDo(existingTodo.id, {
                title: 'Updated Title',
                status: 'completed'
            }, 'test_user');

            expect(updated).not.toBeNull();
            expect(updated?.id).toBe(existingTodo.id);
            expect(updated?.title).toBe('Updated Title');
            expect(updated?.status).toBe('completed');
            expect(updated?.completedAt).toBeDefined();
            expect(new Date(updated?.updatedAt).getTime()).toBeGreaterThan(new Date(existingTodo.updatedAt).getTime());
        });

        it('should return null if todo not found', async () => {
            const updated = await todoService.updateToDo('non-existent-id', {
                title: 'Should Fail'
            }, 'test_user');
            
            expect(updated).toBeNull();
        });

        it('should update without error even if different user', async () => {
            const updated = await todoService.updateToDo(existingTodo.id, {
                title: 'Should Work'
            }, 'different_user');
            
            // Since ToDoService doesn't check ownership, this should work
            expect(updated).not.toBeNull();
        });
    });

    describe('deleteToDo', () => {
        let existingTodo: ToDoItem;

        beforeEach(async () => {
            existingTodo = await todoService.createToDo('test_user', {
                title: 'To Delete'
            });
        });

        it('should delete existing todo', async () => {
            const deleted = await todoService.deleteToDo(existingTodo.id, 'test_user');
            expect(deleted).toBe(true);

            const todos = await todoService.getToDos('test_user');
            expect(todos).toHaveLength(0);
        });

        it('should return false if todo not found', async () => {
            const deleted = await todoService.deleteToDo('non-existent-id', 'test_user');
            expect(deleted).toBe(false);
        });

        it('should delete even if different user', async () => {
            const deleted = await todoService.deleteToDo(existingTodo.id, 'different_user');
            // Since ToDoService doesn't check ownership, this should work
            expect(deleted).toBe(true);
        });
    });

    describe('getToDos', () => {
        beforeEach(async () => {
            // Create multiple todos
            await todoService.createToDo('test_user', {
                title: 'Todo 1',
                priority: 1
            });

            await todoService.createToDo('test_user', {
                title: 'Todo 2',
                priority: 2
            });
            
            // Mark the second todo as completed
            const todos = await todoService.getToDos('test_user');
            const todo2 = todos.find(t => t.title === 'Todo 2');
            if (todo2) {
                await todoService.updateToDo(todo2.id, { status: 'completed' }, 'test_user');
            }

            await todoService.createToDo('test_user', {
                title: 'Todo 3',
                priority: 3
            });

            // Create todo for different user
            await todoService.createToDo('other_user', {
                title: 'Other User Todo'
            });
        });

        it('should get all todos for user', async () => {
            const todos = await todoService.getToDos('test_user');

            expect(todos).toHaveLength(3);
            expect(todos.every(t => t.userId === 'test_user')).toBe(true);
        });

        it('should filter by status', async () => {
            const completedTodos = await todoService.getToDos('test_user', 'completed');
            expect(completedTodos).toHaveLength(1);
            expect(completedTodos[0].title).toBe('Todo 2');

            const pendingTodos = await todoService.getToDos('test_user', 'pending');
            expect(pendingTodos).toHaveLength(2);
        });

        it('should get root todos only when parentTodoId is null', async () => {
            const rootTodos = await todoService.getToDos('test_user', undefined, null);
            expect(rootTodos).toHaveLength(3);
        });

        it('should sort todos by due date and priority', async () => {
            const todos = await todoService.getToDos('test_user');
            
            // Should be sorted by priority (1, 2, 3)
            expect(todos[0].priority).toBe(1);
            expect(todos[1].priority).toBe(2);
            expect(todos[2].priority).toBe(3);
        });

        it('should return empty array for user with no todos', async () => {
            const todos = await todoService.getToDos('new_user');
            expect(todos).toHaveLength(0);
        });
    });

    describe('getToDoById', () => {
        let existingTodo: ToDoItem;

        beforeEach(async () => {
            existingTodo = await todoService.createToDo('test_user', {
                title: 'Test Todo'
            });
        });

        it('should get todo by id', async () => {
            const todo = await todoService.getToDoById(existingTodo.id);

            expect(todo).toBeDefined();
            expect(todo?.id).toBe(existingTodo.id);
            expect(todo?.title).toBe('Test Todo');
        });

        it('should return null if todo not found', async () => {
            const todo = await todoService.getToDoById('non-existent-id');
            expect(todo).toBeNull();
        });

        it('should get todo regardless of user', async () => {
            // ToDoService.getToDoById doesn't take userId parameter
            const todo = await todoService.getToDoById(existingTodo.id);
            expect(todo).toBeDefined();
        });
    });

    describe('getToDoStats', () => {
        beforeEach(async () => {
            // Create todos with various states
            const todo1 = await todoService.createToDo('test_user', {
                title: 'Completed High Priority',
                priority: 1
            });
            await todoService.updateToDo(todo1.id, { status: 'completed' }, 'test_user');

            await todoService.createToDo('test_user', {
                title: 'Incomplete Medium Priority',
                priority: 2
            });

            const todo3 = await todoService.createToDo('test_user', {
                title: 'Completed Low Priority',
                priority: 3
            });
            await todoService.updateToDo(todo3.id, { status: 'completed' }, 'test_user');

            await todoService.createToDo('test_user', {
                title: 'Overdue Todo',
                dueDate: new Date(Date.now() - 86400000).toISOString() // Yesterday
            });
        });

        it('should calculate todo statistics', async () => {
            const stats = await todoService.getToDoStats('test_user');

            expect(stats.total).toBe(4);
            expect(stats.completed).toBe(2);
            expect(stats.pending).toBe(2);
            expect(stats.inProgress).toBe(0);
            expect(stats.overdue).toBe(1);
            // getToDoStats doesn't include byPriority or completionRate
        });

        it('should handle user with no todos', async () => {
            const stats = await todoService.getToDoStats('new_user');

            expect(stats.total).toBe(0);
            expect(stats.completed).toBe(0);
            expect(stats.pending).toBe(0);
            expect(stats.inProgress).toBe(0);
            expect(stats.overdue).toBe(0);
        });
    });

    describe('Integration with real model', () => {
        it('should perform database operations through injected model', async () => {
            // This tests the real integration
            const todo = await todoService.createToDo('integration_test_user', {
                title: 'Integration Test Todo',
                description: 'Testing DI pattern',
                priority: 1
            });

            expect(todo.id).toBeDefined();
            expect(todo.title).toBe('Integration Test Todo');

            // Update the todo
            const updated = await todoService.updateToDo(todo.id, {
                status: 'completed'
            }, 'integration_test_user');

            expect(updated?.status).toBe('completed');
            expect(updated?.completedAt).toBeDefined();

            // Verify it's persisted
            const retrieved = await todoService.getToDoById(todo.id);
            expect(retrieved?.status).toBe('completed');

            // Delete it
            const deleted = await todoService.deleteToDo(todo.id, 'integration_test_user');
            expect(deleted).toBe(true);

            // Verify it's deleted
            const deletedTodo = await todoService.getToDoById(todo.id);
            expect(deletedTodo).toBeNull();
        });
    });
});