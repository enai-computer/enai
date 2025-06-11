import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { updateUserGoals } from '../updateUserGoals';
import { ToolContext } from '../types';
import { logger } from '../../../../utils/logger';
import { getProfileService } from '../../../ProfileService';

// Mock the logger
vi.mock('../../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock getProfileService
vi.mock('../../../ProfileService', () => ({
  getProfileService: vi.fn(),
}));

describe('updateUserGoals', () => {
  let mockContext: ToolContext;
  let mockProfileService: {
    addTimeBoundGoals: Mock;
    removeTimeBoundGoals: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockProfileService = {
      addTimeBoundGoals: vi.fn(),
      removeTimeBoundGoals: vi.fn(),
    };
    
    (getProfileService as Mock).mockReturnValue(mockProfileService);
    
    mockContext = {
      services: {
        notebookService: {},
        hybridSearchService: {},
        exaService: {},
        sliceService: {},
        profileService: {},
      },
      sessionInfo: {
        senderId: 'test-sender',
        sessionId: 'test-session',
      },
      currentIntentSearchResults: [],
      formatter: {},
    } as unknown as ToolContext;
  });

  describe('tool properties', () => {
    it('should have correct name and description', () => {
      expect(updateUserGoals.name).toBe('update_user_goals');
      expect(updateUserGoals.description).toContain('Update the user\'s goals');
      expect(updateUserGoals.description).toContain('plans, objectives, or things they want to accomplish');
      expect(updateUserGoals.description).toContain('timeframes');
    });

    it('should have correct parameter schema', () => {
      expect(updateUserGoals.parameters).toEqual({
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'remove'],
            description: 'Whether to add new goals or remove existing ones',
          },
          goals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: 'The goal text as stated by the user',
                },
                timeframeType: {
                  type: 'string',
                  enum: ['day', 'week', 'month', 'quarter', 'year'],
                  description: 'The time horizon for this goal',
                },
              },
              required: ['text'],
            },
            description: 'Array of goals to add (for \'add\' action)',
          },
          goalIds: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Array of goal IDs to remove (for \'remove\' action)',
          },
        },
        required: ['action'],
      });
    });
  });

  describe('handle method - add goals', () => {
    it('should successfully add goals with timeframes', async () => {
      mockProfileService.addTimeBoundGoals.mockResolvedValue(undefined);

      const goals = [
        { text: 'Complete project documentation', timeframeType: 'week' },
        { text: 'Learn TypeScript', timeframeType: 'month' },
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      expect(getProfileService).toHaveBeenCalled();
      expect(mockProfileService.addTimeBoundGoals).toHaveBeenCalledWith(
        'default_user',
        goals
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[updateUserGoals] Adding 2 time-bound goals'
      );
      expect(result).toEqual({
        content: 'I\'ll keep this goal in mind: "Complete project documentation" (week), "Learn TypeScript" (month).',
      });
    });

    it('should add goal with default timeframe when not specified', async () => {
      mockProfileService.addTimeBoundGoals.mockResolvedValue(undefined);

      const goals = [
        { text: 'Read more books' }, // No timeframeType
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      expect(mockProfileService.addTimeBoundGoals).toHaveBeenCalledWith(
        'default_user',
        [{ text: 'Read more books', timeframeType: 'week' }]
      );
      expect(result.content).toContain('"Read more books" (week)');
    });

    it('should handle single goal', async () => {
      mockProfileService.addTimeBoundGoals.mockResolvedValue(undefined);

      const goals = [
        { text: 'Exercise daily', timeframeType: 'day' },
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      expect(result).toEqual({
        content: 'I\'ll keep this goal in mind: "Exercise daily" (day).',
      });
    });

    it('should handle multiple goals with various timeframes', async () => {
      mockProfileService.addTimeBoundGoals.mockResolvedValue(undefined);

      const goals = [
        { text: 'Morning meditation', timeframeType: 'day' },
        { text: 'Finish online course', timeframeType: 'week' },
        { text: 'Save $1000', timeframeType: 'month' },
        { text: 'Get promoted', timeframeType: 'quarter' },
        { text: 'Buy a house', timeframeType: 'year' },
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      expect(mockProfileService.addTimeBoundGoals).toHaveBeenCalledWith(
        'default_user',
        goals
      );
      expect(result.content).toContain('"Morning meditation" (day)');
      expect(result.content).toContain('"Finish online course" (week)');
      expect(result.content).toContain('"Save $1000" (month)');
      expect(result.content).toContain('"Get promoted" (quarter)');
      expect(result.content).toContain('"Buy a house" (year)');
    });

    it('should handle empty goals array', async () => {
      const result = await updateUserGoals.handle(
        { action: 'add', goals: [] },
        mockContext
      );

      expect(mockProfileService.addTimeBoundGoals).not.toHaveBeenCalled();
      expect(result).toEqual({
        content: 'Error: Invalid action or missing required parameters for updating goals.',
      });
    });

    it('should handle missing goals parameter for add action', async () => {
      const result = await updateUserGoals.handle(
        { action: 'add' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Error: Invalid action or missing required parameters for updating goals.',
      });
    });
  });

  describe('handle method - remove goals', () => {
    it('should successfully remove goals', async () => {
      mockProfileService.removeTimeBoundGoals.mockResolvedValue(undefined);

      const goalIds = ['goal-123', 'goal-456'];

      const result = await updateUserGoals.handle(
        { action: 'remove', goalIds },
        mockContext
      );

      expect(mockProfileService.removeTimeBoundGoals).toHaveBeenCalledWith(
        'default_user',
        goalIds
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[updateUserGoals] Removing 2 goals'
      );
      expect(result).toEqual({
        content: 'I\'ve removed that from your profile.',
      });
    });

    it('should handle removing single goal', async () => {
      mockProfileService.removeTimeBoundGoals.mockResolvedValue(undefined);

      const result = await updateUserGoals.handle(
        { action: 'remove', goalIds: ['goal-789'] },
        mockContext
      );

      expect(mockProfileService.removeTimeBoundGoals).toHaveBeenCalledWith(
        'default_user',
        ['goal-789']
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[updateUserGoals] Removing 1 goals'
      );
    });

    it('should handle empty goalIds array', async () => {
      const result = await updateUserGoals.handle(
        { action: 'remove', goalIds: [] },
        mockContext
      );

      expect(mockProfileService.removeTimeBoundGoals).not.toHaveBeenCalled();
      expect(result).toEqual({
        content: 'Error: Invalid action or missing required parameters for updating goals.',
      });
    });

    it('should handle missing goalIds parameter for remove action', async () => {
      const result = await updateUserGoals.handle(
        { action: 'remove' },
        mockContext
      );

      expect(result).toEqual({
        content: 'Error: Invalid action or missing required parameters for updating goals.',
      });
    });
  });

  describe('handle method - error cases', () => {
    it('should handle invalid action', async () => {
      const result = await updateUserGoals.handle(
        { action: 'update' }, // Invalid action
        mockContext
      );

      expect(result).toEqual({
        content: 'Error: Invalid action or missing required parameters for updating goals.',
      });
    });

    it('should handle missing action parameter', async () => {
      const result = await updateUserGoals.handle(
        { goals: [{ text: 'Some goal' }] },
        mockContext
      );

      expect(result).toEqual({
        content: 'Error: Invalid action or missing required parameters for updating goals.',
      });
    });

    it('should handle service errors when adding goals', async () => {
      const error = new Error('Database connection failed');
      mockProfileService.addTimeBoundGoals.mockRejectedValue(error);

      const result = await updateUserGoals.handle(
        { action: 'add', goals: [{ text: 'Test goal' }] },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[updateUserGoals] Error updating user goals:',
        error
      );
      expect(result).toEqual({
        content: 'Error updating goals: Database connection failed',
      });
    });

    it('should handle service errors when removing goals', async () => {
      const error = new Error('Goal not found');
      mockProfileService.removeTimeBoundGoals.mockRejectedValue(error);

      const result = await updateUserGoals.handle(
        { action: 'remove', goalIds: ['invalid-id'] },
        mockContext
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[updateUserGoals] Error updating user goals:',
        error
      );
      expect(result).toEqual({
        content: 'Error updating goals: Goal not found',
      });
    });

    it('should handle non-Error objects thrown by service', async () => {
      mockProfileService.addTimeBoundGoals.mockRejectedValue('String error');

      const result = await updateUserGoals.handle(
        { action: 'add', goals: [{ text: 'Test goal' }] },
        mockContext
      );

      expect(result).toEqual({
        content: 'Error updating goals: Unknown error',
      });
    });
  });

  describe('handle method - edge cases', () => {
    it('should handle goals with special characters', async () => {
      mockProfileService.addTimeBoundGoals.mockResolvedValue(undefined);

      const goals = [
        { text: 'Learn C++ & Python', timeframeType: 'month' },
        { text: 'Save $5,000 (50% of target)', timeframeType: 'quarter' },
        { text: 'Read "The Great Gatsby"', timeframeType: 'week' },
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      expect(result.content).toContain('"Learn C++ & Python" (month)');
      expect(result.content).toContain('"Save $5,000 (50% of target)" (quarter)');
      expect(result.content).toContain('"Read "The Great Gatsby"" (week)');
    });

    it('should handle very long goal text', async () => {
      mockProfileService.addTimeBoundGoals.mockResolvedValue(undefined);

      const longGoal = 'A'.repeat(200);
      const goals = [
        { text: longGoal, timeframeType: 'month' },
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      expect(mockProfileService.addTimeBoundGoals).toHaveBeenCalledWith(
        'default_user',
        [{ text: longGoal, timeframeType: 'month' }]
      );
      expect(result.content).toContain(longGoal);
    });

    it('should handle null values in goals array', async () => {
      const goals = [
        { text: 'Valid goal', timeframeType: 'week' },
        null as any,
        { text: 'Another valid goal', timeframeType: 'day' },
      ];

      const result = await updateUserGoals.handle(
        { action: 'add', goals },
        mockContext
      );

      // Service should be called with processed goals (nulls handled)
      expect(mockProfileService.addTimeBoundGoals).toHaveBeenCalled();
    });
  });
});