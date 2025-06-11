import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';

export const deleteNotebook: AgentTool = {
  name: 'delete_notebook',
  description: 'Deletes an existing notebook. Use if the user explicitly asks to delete, remove, or get rid of a notebook. Always confirm the notebook name before deletion',
  parameters: {
    type: 'object',
    properties: {
      notebook_name: {
        type: 'string',
        description: 'The exact name or title of the notebook to delete'
      }
    },
    required: ['notebook_name']
  },

  async handle(args: any, context: ToolContext): Promise<ToolCallResult> {
    const { notebook_name } = args;
    if (!notebook_name) {
      return { content: "Error: Notebook name was unclear." };
    }
    
    const notebooks = await context.services.notebookService.getAllRegularNotebooks();
    const found = notebooks.find((nb: any) => 
      nb.title.toLowerCase() === notebook_name.toLowerCase()
    );
    
    if (!found) {
      return { content: `Notebook "${notebook_name}" not found.` };
    }
    
    try {
      await context.services.notebookService.deleteNotebook(found.id);
      logger.info(`[deleteNotebook] Deleted notebook "${notebook_name}" (ID: ${found.id})`);
      return {
        content: `Deleted notebook: ${found.title}`,
        immediateReturn: {
          type: 'chat_reply',
          message: `I've deleted "${found.title}" for you.`
        }
      };
    } catch (error) {
      logger.error(`[deleteNotebook] Error deleting notebook:`, error);
      return { content: `Failed to delete notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
};