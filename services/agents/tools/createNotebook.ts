import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';

export const createNotebook: AgentTool = {
  name: 'create_notebook',
  description: 'Creates a new notebook. Use if the user explicitly asks to create or make a new notebook',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The title for the new notebook'
      }
    },
    required: ['title']
  },

  async handle(args: any, context: ToolContext): Promise<ToolCallResult> {
    const { title } = args;
    if (!title) {
      return { content: "Error: Notebook title was unclear." };
    }
    
    try {
      const notebook = await context.services.notebookService.createNotebook(title);
      return {
        content: `Created notebook: ${notebook.title}`,
        immediateReturn: {
          type: 'open_notebook',
          notebookId: notebook.id,
          title: notebook.title,
          message: `Right on, I've created "${notebook.title}" and I'll open it for you now.`
        }
      };
    } catch (error) {
      logger.error(`[createNotebook] Error creating notebook:`, error);
      return { content: `Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
};