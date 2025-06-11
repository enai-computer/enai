import { AgentTool, ToolCallResult, ToolContext } from './types';

export const openUrl: AgentTool = {
  name: 'open_url',
  description: 'Opens a URL in the WebLayer browser overlay for the user to interact with',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to open in the browser. Protocol (https://) will be added automatically if missing'
      }
    },
    required: ['url']
  },

  async handle(args: any, context: ToolContext): Promise<ToolCallResult> {
    const { url } = args;
    if (!url) {
      return { content: "Error: URL was unclear." };
    }
    
    const formattedUrl = url.startsWith('http') ? url : `https://${url}`;
    
    return {
      content: `Opened URL: ${formattedUrl}`,
      immediateReturn: {
        type: 'open_url',
        url: formattedUrl,
        message: `Right on, I'll open that for you.`
      }
    };
  }
};