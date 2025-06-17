import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ToDoService } from '../ToDoService';
import { ToDoModel } from '../../models/ToDoModel';
import { ToDo, ToDoUpdatePayload } from '../../shared/types';
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

    beforeEach(async () => {
        // Create in-memory database
        db = new Database(':memory:');
        await runMigrations(db);
        
        // Initialize model
        todoModel = new ToDoModel(db);
        
        // Create service with dependency injection
        todoService = new ToDoService({
            db,
            todoModel
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
            // Test that execute wrapper works
            const todos = await todoService.getAllToDos('test_user');
            
            // Should log the operation with execute wrapper format
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('[ToDoService] getAllToDos started')
            );
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('[ToDoService] getAllToDos completed')
            );
        });
    });

    describe('Lifecycle methods', () => {
        it('should support initialize method', async () => {
            // Already called in beforeEach, create a new instance to test
            const newService = new ToDoService({
                db,
                todoModel
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
            vi.spyOn(todoModel, 'getAllToDos').mockImplementation(() => {
                throw new Error('Database connection lost');
            });

            await expect(todoService.getAllToDos('test_user')).rejects.toThrow('Database connection lost');
            
            // Should log the error with proper context
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('[ToDoService] getAllToDos failed'),
                expect.any(Error)
            );
        });
    });

    describe('Dependency injection patterns', () => {
        it('should work with mocked dependencies', async () => {
            // Create a fully mocked ToDoModel
            const mockToDoModel = {
                createToDo: vi.fn().mockImplementation((todo: ToDo) => todo),
                updateToDo: vi.fn().mockImplementation((id: string, updates: Partial<ToDo>) => ({
                    id,
                    ...updates,
                    updatedAt: Date.now()
                })),
                getAllToDos: vi.fn().mockReturnValue([
                    {
                        id: 'mock-1',
                        userId: 'mock_user',
                        title: 'Mock Todo',
                        completed: false,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    }
                ]),
                deleteToDo: vi.fn()
            } as unknown as ToDoModel;

            // Create service with mocked dependencies
            const serviceWithMocks = new ToDoService({
                db,
                todoModel: mockToDoModel
            });

            const todos = await serviceWithMocks.getAllToDos('mock_user');
            
            expect(mockToDoModel.getAllToDos).toHaveBeenCalledWith('mock_user');
            expect(todos).toHaveLength(1);
            expect(todos[0].title).toBe('Mock Todo');
        });

        it('should allow testing without database', async () => {
            // Create a stub model that doesn't need a real database
            const stubModel = {
                createToDo: vi.fn().mockImplementation((todo: ToDo) => ({
                    ...todo,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                })),
                updateToDo: vi.fn(),
                getAllToDos: vi.fn().mockReturnValue([]),
                deleteToDo: vi.fn()
            } as unknown as ToDoModel;

            const serviceWithStub = new ToDoService({
                db: {} as Database.Database, // Dummy db object
                todoModel: stubModel
            });

            const newTodo = await serviceWithStub.createToDo({
                userId: 'stub_user',
                title: 'Test Todo',
                completed: false
            });
            
            expect(stubModel.createToDo).toHaveBeenCalled();
            expect(newTodo.title).toBe('Test Todo');
        });
    });

    describe('createToDo', () => {
        it('should create a new todo', async () => {
            const todo = await todoService.createToDo({
                userId: 'test_user',
                title: 'Test Todo',
                completed: false
            });

            expect(todo.id).toBeDefined();
            expect(todo.title).toBe('Test Todo');
            expect(todo.completed).toBe(false);
            expect(todo.userId).toBe('test_user');
            expect(todo.createdAt).toBeDefined();
            expect(todo.updatedAt).toBeDefined();
        });

        it('should handle optional fields', async () => {
            const todo = await todoService.createToDo({
                userId: 'test_user',
                title: 'Test Todo with Extras',
                completed: false,
                description: 'This is a description',
                priority: 'high',
                dueDate: Date.now() + 86400000 // Tomorrow
            });

            expect(todo.description).toBe('This is a description');
            expect(todo.priority).toBe('high');
            expect(todo.dueDate).toBeDefined();
        });
    });

    describe('updateToDo', () => {
        let existingTodo: ToDo;

        beforeEach(async () => {
            existingTodo = await todoService.createToDo({
                userId: 'test_user',
                title: 'Original Title',
                completed: false
            });
        });

        it('should update todo properties', async () => {
            const updated = await todoService.updateToDo({
                id: existingTodo.id,
                userId: 'test_user',
                title: 'Updated Title',
                completed: true
            });

            expect(updated.id).toBe(existingTodo.id);
            expect(updated.title).toBe('Updated Title');
            expect(updated.completed).toBe(true);
            expect(updated.updatedAt).toBeGreaterThan(existingTodo.updatedAt);
        });

        it('should throw error if todo not found', async () => {
            await expect(todoService.updateToDo({
                id: 'non-existent-id',
                userId: 'test_user',
                title: 'Should Fail'
            })).rejects.toThrow();
        });

        it('should throw error if user does not own todo', async () => {
            await expect(todoService.updateToDo({
                id: existingTodo.id,
                userId: 'different_user',
                title: 'Should Fail'
            })).rejects.toThrow();
        });
    });

    describe('deleteToDo', () => {
        let existingTodo: ToDo;

        beforeEach(async () => {
            existingTodo = await todoService.createToDo({
                userId: 'test_user',
                title: 'To Delete',
                completed: false
            });
        });

        it('should delete existing todo', async () => {
            await todoService.deleteToDo(existingTodo.id, 'test_user');

            const todos = await todoService.getAllToDos('test_user');
            expect(todos).toHaveLength(0);
        });

        it('should throw error if todo not found', async () => {
            await expect(
                todoService.deleteToDo('non-existent-id', 'test_user')
            ).rejects.toThrow();
        });

        it('should throw error if user does not own todo', async () => {
            await expect(
                todoService.deleteToDo(existingTodo.id, 'different_user')
            ).rejects.toThrow();
        });
    });

    describe('getAllToDos', () => {
        beforeEach(async () => {
            // Create multiple todos
            await todoService.createToDo({
                userId: 'test_user',
                title: 'Todo 1',
                completed: false,
                priority: 'high'
            });

            await todoService.createToDo({
                userId: 'test_user',
                title: 'Todo 2',
                completed: true,
                priority: 'medium'
            });

            await todoService.createToDo({
                userId: 'test_user',
                title: 'Todo 3',
                completed: false,
                priority: 'low'
            });

            // Create todo for different user
            await todoService.createToDo({
                userId: 'other_user',
                title: 'Other User Todo',
                completed: false
            });
        });

        it('should get all todos for user', async () => {
            const todos = await todoService.getAllToDos('test_user');

            expect(todos).toHaveLength(3);
            expect(todos.every(t => t.userId === 'test_user')).toBe(true);
        });

        it('should filter by completed status', async () => {
            const completedTodos = await todoService.getAllToDos('test_user', { completed: true });
            expect(completedTodos).toHaveLength(1);
            expect(completedTodos[0].title).toBe('Todo 2');

            const incompleteTodos = await todoService.getAllToDos('test_user', { completed: false });
            expect(incompleteTodos).toHaveLength(2);
        });

        it('should filter by priority', async () => {
            const highPriorityTodos = await todoService.getAllToDos('test_user', { priority: 'high' });
            expect(highPriorityTodos).toHaveLength(1);
            expect(highPriorityTodos[0].title).toBe('Todo 1');
        });

        it('should sort todos', async () => {
            const todosByPriority = await todoService.getAllToDos('test_user', {
                sortBy: 'priority',
                sortOrder: 'desc'
            });

            expect(todosByPriority[0].priority).toBe('high');
            expect(todosByPriority[2].priority).toBe('low');
        });

        it('should return empty array for user with no todos', async () => {
            const todos = await todoService.getAllToDos('new_user');
            expect(todos).toHaveLength(0);
        });
    });

    describe('getToDoById', () => {
        let existingTodo: ToDo;

        beforeEach(async () => {
            existingTodo = await todoService.createToDo({
                userId: 'test_user',
                title: 'Test Todo',
                completed: false
            });
        });

        it('should get todo by id', async () => {
            const todo = await todoService.getToDoById(existingTodo.id, 'test_user');

            expect(todo).toBeDefined();
            expect(todo?.id).toBe(existingTodo.id);
            expect(todo?.title).toBe('Test Todo');
        });

        it('should return null if todo not found', async () => {
            const todo = await todoService.getToDoById('non-existent-id', 'test_user');
            expect(todo).toBeNull();
        });

        it('should return null if user does not own todo', async () => {
            const todo = await todoService.getToDoById(existingTodo.id, 'different_user');
            expect(todo).toBeNull();
        });
    });

    describe('getToDoStats', () => {
        beforeEach(async () => {
            // Create todos with various states
            await todoService.createToDo({
                userId: 'test_user',
                title: 'Completed High Priority',
                completed: true,
                priority: 'high'
            });

            await todoService.createToDo({
                userId: 'test_user',
                title: 'Incomplete Medium Priority',
                completed: false,
                priority: 'medium'
            });

            await todoService.createToDo({
                userId: 'test_user',
                title: 'Completed Low Priority',
                completed: true,
                priority: 'low'
            });

            await todoService.createToDo({
                userId: 'test_user',
                title: 'Overdue Todo',
                completed: false,
                dueDate: Date.now() - 86400000 // Yesterday
            });
        });

        it('should calculate todo statistics', async () => {
            const stats = await todoService.getToDoStats('test_user');

            expect(stats.total).toBe(4);
            expect(stats.completed).toBe(2);
            expect(stats.incomplete).toBe(2);
            expect(stats.completionRate).toBe(0.5);
            expect(stats.overdue).toBe(1);
            expect(stats.byPriority.high).toBe(1);
            expect(stats.byPriority.medium).toBe(1);
            expect(stats.byPriority.low).toBe(1);
        });

        it('should handle user with no todos', async () => {
            const stats = await todoService.getToDoStats('new_user');

            expect(stats.total).toBe(0);
            expect(stats.completed).toBe(0);
            expect(stats.incomplete).toBe(0);
            expect(stats.completionRate).toBe(0);
            expect(stats.overdue).toBe(0);
        });
    });

    describe('Integration with real model', () => {
        it('should perform database operations through injected model', async () => {
            // This tests the real integration
            const todo = await todoService.createToDo({
                userId: 'integration_test_user',
                title: 'Integration Test Todo',
                description: 'Testing DI pattern',
                priority: 'high',
                completed: false
            });

            expect(todo.id).toBeDefined();
            expect(todo.title).toBe('Integration Test Todo');

            // Update the todo
            const updated = await todoService.updateToDo({
                id: todo.id,
                userId: 'integration_test_user',
                completed: true
            });

            expect(updated.completed).toBe(true);

            // Verify it's persisted
            const retrieved = await todoService.getToDoById(todo.id, 'integration_test_user');
            expect(retrieved?.completed).toBe(true);

            // Delete it
            await todoService.deleteToDo(todo.id, 'integration_test_user');

            // Verify it's deleted
            const deletedTodo = await todoService.getToDoById(todo.id, 'integration_test_user');
            expect(deletedTodo).toBeNull();
        });
    });
});