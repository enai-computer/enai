import { AgentTool } from './types';
import { searchKnowledgeBase } from './searchKnowledgeBase';
import { searchWeb } from './searchWeb';
import { openNotebook } from './openNotebook';
import { createNotebook } from './createNotebook';
import { deleteNotebook } from './deleteNotebook';
import { openUrl } from './openUrl';
import { updateUserGoals } from './updateUserGoals';

// Tool registry
export const AGENT_TOOLS: Record<string, AgentTool> = {
  search_knowledge_base: searchKnowledgeBase,
  search_web: searchWeb,
  open_notebook: openNotebook,
  create_notebook: createNotebook,
  delete_notebook: deleteNotebook,
  open_url: openUrl,
  update_user_goals: updateUserGoals,
};

// Export all tools for easy access
export * from './types';
export { searchKnowledgeBase } from './searchKnowledgeBase';
export { searchWeb } from './searchWeb';
export { openNotebook } from './openNotebook';
export { createNotebook } from './createNotebook';
export { deleteNotebook } from './deleteNotebook';
export { openUrl } from './openUrl';
export { updateUserGoals } from './updateUserGoals';