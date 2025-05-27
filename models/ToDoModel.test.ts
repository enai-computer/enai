import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ToDoModel } from './ToDoModel';
import runMigrations from './runMigrations';
import { ToDoStatus } from '../shared/types';

describe('ToDoModel', () => {
  let db: Database.Database;
  let model: ToDoModel;

  beforeEach(async () => {
    // Create in-memory database
    db = new Database(':memory:');
    await runMigrations(db);
    model = new ToDoModel(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createToDo', () => {
    it('should create a new to-do', () => {
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
      expect(todo.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a subtask', () => {
      const parentTodo = model.createToDo('default_user', 'Parent Todo');
      const subtask = model.createToDo(
        'default_user',
        'Subtask',
        null,
        null,
        null,
        parentTodo.id
      );

      expect(subtask.parentTodoId).toBe(parentTodo.id);
    });

    it('should link to-do to a goal', () => {
      const goalId = 'goal-123';
      const todo = model.createToDo(
        'default_user',
        'Goal-related task',
        null,
        null,
        null,
        null,
        goalId
      );

      expect(todo.projectOrGoalId).toBe(goalId);
    });
  });

  describe('getToDoById', () => {
    it('should retrieve a to-do by ID', () => {
      const created = model.createToDo('default_user', 'Test Todo');
      const retrieved = model.getToDoById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe(created.title);
    });

    it('should return null for non-existent ID', () => {
      const result = model.getToDoById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getToDosForUser', () => {
    it('should get all to-dos for a user', () => {
      // First create the other_user in user_profiles
      const stmt = db.prepare(`
        INSERT INTO user_profiles (user_id, updated_at) 
        VALUES ('other_user', ?)
      `);
      stmt.run(Date.now());

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

      const completed = model.getToDosForUser('default_user', 'completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(todo3.id);
    });

    it('should sort by due date and priority', () => {
      const now = Date.now();
      
      // Create todos with different due dates and priorities
      const todo1 = model.createToDo('default_user', 'High priority tomorrow', null, now + 24 * 60 * 60 * 1000, 1);
      const todo2 = model.createToDo('default_user', 'Low priority tomorrow', null, now + 24 * 60 * 60 * 1000, 5);
      const todo3 = model.createToDo('default_user', 'Today', null, now + 1000, 3);
      const todo4 = model.createToDo('default_user', 'No due date', null, null, 2);

      const todos = model.getToDosForUser('default_user');

      // Should be ordered: Today, High priority tomorrow, Low priority tomorrow, No due date
      expect(todos[0].id).toBe(todo3.id); // Today
      expect(todos[1].id).toBe(todo1.id); // High priority tomorrow
      expect(todos[2].id).toBe(todo2.id); // Low priority tomorrow
      expect(todos[3].id).toBe(todo4.id); // No due date
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

      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('New description');
      expect(updated?.priority).toBe(1);
      expect(updated?.status).toBe('in_progress');
    });

    it('should set completedAt when marking as completed', () => {
      const todo = model.createToDo('default_user', 'Test Todo');
      expect(todo.completedAt).toBeNull();

      const updated = model.updateToDo(todo.id, { status: 'completed' });
      expect(updated?.completedAt).toBeInstanceOf(Date);
      expect(updated?.status).toBe('completed');
    });

    it('should clear completedAt when changing from completed', () => {
      const todo = model.createToDo('default_user', 'Test Todo');
      
      // First complete it
      model.updateToDo(todo.id, { status: 'completed' });
      
      // Then reopen it
      const reopened = model.updateToDo(todo.id, { status: 'pending' });
      expect(reopened?.completedAt).toBeNull();
      expect(reopened?.status).toBe('pending');
    });

    it('should return null for non-existent todo', () => {
      const result = model.updateToDo('non-existent', { title: 'New Title' });
      expect(result).toBeNull();
    });
  });

  describe('deleteToDo', () => {
    it('should delete a to-do', () => {
      const todo = model.createToDo('default_user', 'To Delete');
      
      const deleted = model.deleteToDo(todo.id);
      expect(deleted).toBe(true);

      const retrieved = model.getToDoById(todo.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent todo', () => {
      const deleted = model.deleteToDo('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getToDosDueBetween', () => {
    it('should get to-dos within time range', () => {
      const now = Date.now();
      const tomorrow = now + 24 * 60 * 60 * 1000;
      const nextWeek = now + 7 * 24 * 60 * 60 * 1000;

      model.createToDo('default_user', 'Due Today', null, now);
      model.createToDo('default_user', 'Due Tomorrow', null, tomorrow);
      model.createToDo('default_user', 'Due Next Week', null, nextWeek);
      model.createToDo('default_user', 'No Due Date');

      // Get todos due in next 3 days
      const todos = model.getToDosDueBetween(
        'default_user',
        now - 1000,
        now + 3 * 24 * 60 * 60 * 1000
      );

      expect(todos).toHaveLength(2);
      expect(todos.map(t => t.title)).toContain('Due Today');
      expect(todos.map(t => t.title)).toContain('Due Tomorrow');
    });

    it('should exclude completed and archived todos', () => {
      const now = Date.now();
      
      const todo1 = model.createToDo('default_user', 'Active', null, now);
      const todo2 = model.createToDo('default_user', 'Completed', null, now);
      const todo3 = model.createToDo('default_user', 'Archived', null, now);

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
      const yesterday = now - 24 * 60 * 60 * 1000;
      const tomorrow = now + 24 * 60 * 60 * 1000;

      model.createToDo('default_user', 'Overdue', null, yesterday);
      model.createToDo('default_user', 'Due Tomorrow', null, tomorrow);
      model.createToDo('default_user', 'No Due Date');

      const overdue = model.getOverdueToDos('default_user');

      expect(overdue).toHaveLength(1);
      expect(overdue[0].title).toBe('Overdue');
    });
  });

  describe('getToDosForGoal', () => {
    it('should get to-dos for a specific goal', () => {
      const goalId = 'goal-123';
      
      model.createToDo('default_user', 'Goal Task 1', null, null, null, null, goalId);
      model.createToDo('default_user', 'Goal Task 2', null, null, null, null, goalId);
      model.createToDo('default_user', 'Other Task', null, null, null, null, 'other-goal');
      model.createToDo('default_user', 'No Goal Task');

      const goalTodos = model.getToDosForGoal('default_user', goalId);

      expect(goalTodos).toHaveLength(2);
      expect(goalTodos.every(t => t.projectOrGoalId === goalId)).toBe(true);
    });

    it('should order by status and priority', () => {
      const goalId = 'goal-123';
      
      const todo1 = model.createToDo('default_user', 'Pending Low', null, null, 5, null, goalId);
      const todo2 = model.createToDo('default_user', 'In Progress', null, null, 3, null, goalId);
      const todo3 = model.createToDo('default_user', 'Pending High', null, null, 1, null, goalId);
      const todo4 = model.createToDo('default_user', 'Completed', null, null, 2, null, goalId);

      model.updateToDo(todo2.id, { status: 'in_progress' });
      model.updateToDo(todo4.id, { status: 'completed' });

      const todos = model.getToDosForGoal('default_user', goalId);

      // Should be ordered: In Progress, Pending High, Pending Low, Completed
      expect(todos[0].id).toBe(todo2.id);
      expect(todos[1].id).toBe(todo3.id);
      expect(todos[2].id).toBe(todo1.id);
      expect(todos[3].id).toBe(todo4.id);
    });
  });

  describe('getSubtasks', () => {
    it('should get subtasks for a parent todo', () => {
      const parent = model.createToDo('default_user', 'Parent Task');
      
      const sub1 = model.createToDo('default_user', 'Subtask 1', null, null, 2, parent.id);
      const sub2 = model.createToDo('default_user', 'Subtask 2', null, null, 1, parent.id);
      model.createToDo('default_user', 'Unrelated Task');

      const subtasks = model.getSubtasks(parent.id);

      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].id).toBe(sub2.id); // Higher priority first
      expect(subtasks[1].id).toBe(sub1.id);
    });
  });
});