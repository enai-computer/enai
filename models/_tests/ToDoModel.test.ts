import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ToDoModel } from '../ToDoModel';
import { setupTestDb, cleanTestDb } from './testUtils';

describe('ToDoModel', () => {
  let db: Database.Database;
  let model: ToDoModel;

  beforeAll(() => {
    db = setupTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    cleanTestDb(db);
    model = new ToDoModel(db);
  });

  describe('createToDo', () => {
    it('should create a new to-do with all fields', () => {
      const title = 'Test Todo';
      const description = 'Test description';
      const dueDate = Date.now() + 24 * 60 * 60 * 1000; // Tomorrow
      const priority = 2;

      const todo = model.createToDo(
        'default_user',
        title,
        description,
        dueDate,
        priority
      );

      expect(todo.id).toBeDefined();
      expect(todo.userId).toBe('default_user');
      expect(todo.title).toBe(title);
      expect(todo.description).toBe(description);
      expect(todo.dueDate?.getTime()).toBe(dueDate);
      expect(todo.priority).toBe(priority);
      expect(todo.status).toBe('pending');
      expect(todo.createdAt).toBeInstanceOf(Date);
    });

    it('should create subtasks and link to goals', () => {
      const parentTodo = model.createToDo('default_user', 'Parent Todo');
      const subtask = model.createToDo(
        'default_user',
        'Subtask',
        null,
        null,
        null,
        parentTodo.id
      );
      const goalTask = model.createToDo(
        'default_user',
        'Goal Task',
        null,
        null,
        null,
        null,
        'goal-123'
      );

      expect(subtask.parentTodoId).toBe(parentTodo.id);
      expect(goalTask.projectOrGoalId).toBe('goal-123');
    });
  });

  describe('getToDoById', () => {
    it('should retrieve a to-do by ID', () => {
      const created = model.createToDo('default_user', 'Test Todo');
      const retrieved = model.getToDoById(created.id);

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe(created.title);
    });

    it('should return null for non-existent ID', () => {
      expect(model.getToDoById('non-existent')).toBeNull();
    });
  });

  describe('getToDosForUser', () => {
    beforeEach(() => {
      // Create other_user in user_profiles
      db.prepare(`INSERT INTO user_profiles (user_id, updated_at) VALUES ('other_user', ?)`).run(Date.now());
    });

    it('should get all to-dos for a user', () => {
      model.createToDo('default_user', 'Todo 1');
      model.createToDo('default_user', 'Todo 2');
      model.createToDo('other_user', 'Other User Todo');

      const todos = model.getToDosForUser('default_user');
      expect(todos).toHaveLength(2);
      expect(todos.every(t => t.userId === 'default_user')).toBe(true);
    });

    it('should filter by status', () => {
      const todo1 = model.createToDo('default_user', 'Pending');
      const todo2 = model.createToDo('default_user', 'In Progress');
      const todo3 = model.createToDo('default_user', 'Completed');

      model.updateToDo(todo2.id, { status: 'in_progress' });
      model.updateToDo(todo3.id, { status: 'completed' });

      const pending = model.getToDosForUser('default_user', 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(todo1.id);
    });

    it('should sort by due date and priority', () => {
      const now = Date.now();
      
      const todo1 = model.createToDo('default_user', 'High priority tomorrow', null, now + 24 * 60 * 60 * 1000, 1);
      const todo2 = model.createToDo('default_user', 'Low priority tomorrow', null, now + 24 * 60 * 60 * 1000, 5);
      const todo3 = model.createToDo('default_user', 'Today', null, now + 1000, 3);
      const todo4 = model.createToDo('default_user', 'No due date', null, null, 2);

      const todos = model.getToDosForUser('default_user');

      // Should be ordered: Today, High priority tomorrow, Low priority tomorrow, No due date
      expect(todos.map(t => t.id)).toEqual([todo3.id, todo1.id, todo2.id, todo4.id]);
    });
  });

  describe('updateToDo', () => {
    it('should update to-do fields', () => {
      const todo = model.createToDo('default_user', 'Original Title');
      
      const updated = model.updateToDo(todo.id, {
        title: 'Updated Title',
        description: 'New description',
        priority: 1,
        status: 'in_progress',
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('New description');
      expect(updated?.priority).toBe(1);
      expect(updated?.status).toBe('in_progress');
    });

    it('should handle completedAt correctly', () => {
      const todo = model.createToDo('default_user', 'Test Todo');
      
      // Complete it
      const completed = model.updateToDo(todo.id, { status: 'completed' });
      expect(completed?.completedAt).toBeInstanceOf(Date);
      
      // Reopen it
      const reopened = model.updateToDo(todo.id, { status: 'pending' });
      expect(reopened?.completedAt).toBeNull();
    });
  });

  describe('deleteToDo', () => {
    it('should delete a to-do', () => {
      const todo = model.createToDo('default_user', 'To Delete');
      
      expect(model.deleteToDo(todo.id)).toBe(true);
      expect(model.getToDoById(todo.id)).toBeNull();
    });

    it('should return false for non-existent todo', () => {
      expect(model.deleteToDo('non-existent')).toBe(false);
    });
  });

  describe('getToDosDueBetween', () => {
    it('should get to-dos within time range excluding completed/archived', () => {
      const now = Date.now();
      
      const todo1 = model.createToDo('default_user', 'Active', null, now);
      const todo2 = model.createToDo('default_user', 'Completed', null, now);
      const todo3 = model.createToDo('default_user', 'Archived', null, now);
      model.createToDo('default_user', 'Future', null, now + 7 * 24 * 60 * 60 * 1000);

      model.updateToDo(todo2.id, { status: 'completed' });
      model.updateToDo(todo3.id, { status: 'archived' });

      const todos = model.getToDosDueBetween('default_user', now - 1000, now + 1000);
      
      expect(todos).toHaveLength(1);
      expect(todos[0].id).toBe(todo1.id);
    });
  });

  describe('getOverdueToDos', () => {
    it('should get overdue to-dos', () => {
      const now = Date.now();
      
      model.createToDo('default_user', 'Overdue', null, now - 24 * 60 * 60 * 1000);
      model.createToDo('default_user', 'Future', null, now + 24 * 60 * 60 * 1000);
      model.createToDo('default_user', 'No Due Date');

      const overdue = model.getOverdueToDos('default_user');
      expect(overdue).toHaveLength(1);
      expect(overdue[0].title).toBe('Overdue');
    });
  });

  describe('getToDosForGoal', () => {
    it('should get and order to-dos for a specific goal', () => {
      const goalId = 'goal-123';
      
      const todo1 = model.createToDo('default_user', 'Pending Low', null, null, 5, null, goalId);
      const todo2 = model.createToDo('default_user', 'In Progress', null, null, 3, null, goalId);
      const todo3 = model.createToDo('default_user', 'Pending High', null, null, 1, null, goalId);
      const todo4 = model.createToDo('default_user', 'Completed', null, null, 2, null, goalId);

      model.updateToDo(todo2.id, { status: 'in_progress' });
      model.updateToDo(todo4.id, { status: 'completed' });

      const todos = model.getToDosForGoal('default_user', goalId);

      // Should be ordered: In Progress, Pending High, Pending Low, Completed
      expect(todos.map(t => t.id)).toEqual([todo2.id, todo3.id, todo1.id, todo4.id]);
    });
  });

  describe('getSubtasks', () => {
    it('should get subtasks ordered by priority', () => {
      const parent = model.createToDo('default_user', 'Parent Task');
      
      const sub1 = model.createToDo('default_user', 'Subtask 1', null, null, 2, parent.id);
      const sub2 = model.createToDo('default_user', 'Subtask 2', null, null, 1, parent.id);

      const subtasks = model.getSubtasks(parent.id);

      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].id).toBe(sub2.id); // Higher priority first
      expect(subtasks[1].id).toBe(sub1.id);
    });
  });
});