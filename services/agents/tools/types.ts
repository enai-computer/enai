import { HybridSearchResult, IntentResultPayload } from '../../../shared/types';

export interface ToolCallResult {
  content: string;
  immediateReturn?: IntentResultPayload;
}

export interface ToolContext {
  services: {
    notebookService: any; // Will be typed properly when we import services
    hybridSearchService: any;
    exaService: any;
    sliceService: any;
    profileService: any;
    searchService: any; // SearchService
  };
  sessionInfo: {
    senderId: string;
    sessionId: string;
  };
  currentIntentSearchResults: HybridSearchResult[];
  formatter: any; // SearchResultFormatter
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema for the tool parameters
  handle(args: unknown, context: ToolContext): Promise<ToolCallResult>;
}