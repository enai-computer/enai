import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';

export const updateUserGoals: AgentTool = {
  name: 'update_user_goals',
  description: 'Update the user\'s goals when they mention plans, objectives, or things they want to accomplish. Capture goals with their timeframes (e.g., \'this week\', \'this month\'). Always use this when users express intentions with time context',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove'],
        description: 'Whether to add new goals or remove existing ones'
      },
      goals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The goal text as stated by the user'
            },
            timeframeType: {
              type: 'string',
              enum: ['day', 'week', 'month', 'quarter', 'year'],
              description: 'The time horizon for this goal'
            }
          },
          required: ['text']
        },
        description: 'Array of goals to add (for \'add\' action)'
      },
      goalIds: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Array of goal IDs to remove (for \'remove\' action)'
      }
    },
    required: ['action']
  },

  async handle(args: any, context: ToolContext): Promise<ToolCallResult> {
    const { action, goals, goalIds } = args;
    
    try {
      const profileService = context.services.profileService;
      
      if (action === 'add' && goals && goals.length > 0) {
        // Parse timeframe from natural language if needed
        const processedGoals = goals.map((goal: any) => {
          // Default to 'week' if no timeframe specified
          const timeframeType = goal.timeframeType || 'week';
          
          return {
            text: goal.text,
            timeframeType: timeframeType
          };
        });
        
        logger.info(`[updateUserGoals] Adding ${processedGoals.length} time-bound goals`);
        await profileService.addTimeBoundGoals('default_user', processedGoals);
        
        const goalTexts = processedGoals.map((g: any) => `"${g.text}" (${g.timeframeType})`).join(', ');
        return { 
          content: `I'll keep this goal in mind: ${goalTexts}.` 
        };
      } else if (action === 'remove' && goalIds && goalIds.length > 0) {
        logger.info(`[updateUserGoals] Removing ${goalIds.length} goals`);
        await profileService.removeTimeBoundGoals('default_user', goalIds);
        
        return { 
          content: `I've removed that from your profile.` 
        };
      } else {
        return { 
          content: "Error: Invalid action or missing required parameters for updating goals." 
        };
      }
    } catch (error) {
      logger.error(`[updateUserGoals] Error updating user goals:`, error);
      return { 
        content: `Error updating goals: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
};