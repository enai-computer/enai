import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';

export const openNotebook: AgentTool = {
  name: 'open_notebook',
  description: 'Opens an existing notebook. Use if the user explicitly asks to open, find, or show a specific notebook',
  parameters: {
    type: 'object',
    properties: {
      notebook_name: {
        type: 'string',
        description: 'The exact name or title of the notebook to open'
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
    logger.info(`[openNotebook] Looking for "${notebook_name}" among ${notebooks.length} regular notebooks:`, notebooks.map((n: any) => n.title));
    
    const found = notebooks.find((nb: any) => 
      nb.title.toLowerCase() === notebook_name.toLowerCase()
    );
    
    if (found) {
      logger.info(`[openNotebook] Found notebook: "${found.title}" (ID: ${found.id})`);
      return {
        content: `Opened notebook: ${found.title}`,
        immediateReturn: {
          type: 'open_notebook',
          notebookId: found.id,
          title: found.title,
          message: `Right on, I'll open "${found.title}" for you.`
        }
      };
    }
    
    logger.warn(`[openNotebook] Notebook "${notebook_name}" not found among available notebooks`);
    return { content: `Notebook "${notebook_name}" not found.` };
  }
};