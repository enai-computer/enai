import { ChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import type { RunnableConfig } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { formatDocumentsAsString } from "langchain/util/document";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
// Import DocumentInterface for callback typing
import type { DocumentInterface } from "@langchain/core/documents";

import { chromaVectorModel, IVectorStoreModel } from "../../models/ChromaVectorModel"; // Adjust path as needed
import { ChatModel } from "../../models/ChatModel"; // Import ChatModel CLASS
import { IChatMessage, ChatMessageSourceMetadata } from '../../shared/types.d'; // Import IChatMessage & ChatMessageSourceMetadata
import { logger } from '../../utils/logger'; // Adjust path as needed

// Helper function to format chat history messages using instanceof
const formatChatHistory = (chatHistory: BaseMessage[]): string => {
    const formattedDialogueTurns = chatHistory.map((message) => {
        if (message instanceof HumanMessage) {
            return `Human: ${message.content}`;
        } else if (message instanceof AIMessage) {
            return `Assistant: ${message.content}`;
        } else {
             // Fallback for other potential message types
            return `${message.constructor.name}: ${message.content}`;
        }
    });
    return formattedDialogueTurns.join("\n");
};

// --- Prompt Templates ---
const REPHRASE_QUESTION_SYSTEM_TEMPLATE = 
  `Given the following conversation and a follow up question, rephrase the 
follow up question to be a standalone question, in its original language.`;

const rephraseQuestionPrompt = ChatPromptTemplate.fromMessages([
  ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
  new MessagesPlaceholder("chat_history"),
  ["human", "{question}"],
]);

const ANSWER_SYSTEM_TEMPLATE = 
  `You are a helpful assistant for answering questions based on provided context.
   What information do the documents suggest? What might be missing? Do you need to look at the rest of the documents?
   If the context doesn't cover it, rely on your own knowledge to craft a response.
   If the context doesn't cover it, but you can find an insightful connection somewhere else, you can gently work that into your response..
   Do not make up information.

Context:
--------
{context}
--------`;

const answerPrompt = ChatPromptTemplate.fromMessages([
  ["system", ANSWER_SYSTEM_TEMPLATE],
  new MessagesPlaceholder("chat_history"),
  ["human", "{question}"],
]);


class LangchainAgent {
    private vectorModel: IVectorStoreModel;
    private llm: ChatOpenAI;
    private chatModel: ChatModel; // Add member variable for ChatModel

    constructor(vectorModelInstance: IVectorStoreModel, chatModelInstance: ChatModel) { // Add ChatModel parameter
        this.vectorModel = vectorModelInstance;
        this.chatModel = chatModelInstance; // Store the instance
        
        // Check and fetch the API key HERE, inside the constructor
        const apiKey = process.env.OPENAI_API_KEY;
        // Read the desired model name from env, fallback to "gpt-4o"
        const modelName = process.env.OPENAI_DEFAULT_MODEL || "gpt-4o"; 

        logger.info(`[LangchainAgent Constructor] Checking for OpenAI API Key: ${apiKey ? 'Found' : 'MISSING!'}`);
        if (!apiKey) {
             logger.error('[LangchainAgent Constructor] CRITICAL: OpenAI API Key is MISSING in environment variables!');
             // Throw an error immediately if the key is missing
             throw new Error("OpenAI API Key is missing, cannot initialize LangchainAgent LLM.");
        }
        
        logger.info(`[LangchainAgent Constructor] Using OpenAI Model: ${modelName}`); // Log the model being used

        // Now instantiate the LLM, explicitly passing the fetched key
        this.llm = new ChatOpenAI({
            modelName: modelName, // Use the variable here
            temperature: 1,
            streaming: true,
            openAIApiKey: apiKey, // Explicitly pass the fetched key
        });
        logger.info(`[LangchainAgent] Initialized with OpenAI model ${modelName}.`); // Update log
    }

    /** Converts DB message format to LangChain message format. */
    private mapDbMessagesToLangchain(messages: IChatMessage[]): BaseMessage[] {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return new HumanMessage(msg.content);
            } else if (msg.role === 'assistant') {
                return new AIMessage(msg.content);
            } else {
                // Handle system messages or other roles if necessary
                // For now, maybe treat system as AIMessage or filter out?
                 logger.warn(`[LangchainAgent] Unsupported role '{msg.role}' found in DB history, treating as AI.`);
                 return new AIMessage(msg.content); 
            }
        });
    }

    /**
     * Processes a question using conversational retrieval QA with streaming.
     *
     * @param sessionId The ID of the chat session.
     * @param question The user's question.
     * @param onChunk Callback for each received token chunk.
     * @param onEnd Callback when the stream ends successfully.
     * @param onError Callback if an error occurs during streaming.
     * @param signal Optional AbortSignal for cancelling the stream
     * @param k Number of relevant documents to retrieve
     */
    async queryStream(
        sessionId: string,
        question: string,
        onChunk: (chunk: string) => void,
        onEnd: (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => void,
        onError: (error: Error) => void,
        signal?: AbortSignal,
        k: number = 6
    ): Promise<void> {
        let fullResponse = ""; // To accumulate the response for memory
        let retrievedChunkIds: number[] = []; // Variable to store captured chunk IDs

        try {
            logger.debug(`[LangchainAgent] queryStream started for session ${sessionId}, question: "${question.substring(0, 50)}...", k=${k}`);
            const retriever = await this.vectorModel.getRetriever(k); // Use parameter k

            // Define callback handler for retriever
            const retrieverCallbacks = {
                handleRetrieverEnd: (documents: DocumentInterface[]) => {
                     // Safely extract chunk_id, assuming it exists and is a number in metadata
                     // *** CORRECTED to use sqlChunkId based on ChunkingService ***
                    retrievedChunkIds = documents
                        .map(doc => doc.metadata?.sqlChunkId) // Access metadata safely using the correct key
                        .filter((id): id is number => typeof id === 'number'); // Filter out non-numbers and ensure type is number
                    logger.debug(`[LangchainAgent Callback] Captured ${retrievedChunkIds.length} chunk IDs from retriever: [${retrievedChunkIds.join(', ')}]`);
                }
            };

            // *** RESTORE ORIGINAL CONVERSATIONAL CHAIN ***
            logger.info("[LangchainAgent] Using original conversational retrieval chain.");

            // 1. Create a chain to generate a standalone question
            const standaloneQuestionChain = RunnableSequence.from([
                {
                    // Pass chat history and the current question
                    question: (input: { question: string; chat_history: BaseMessage[] }) => input.question,
                    chat_history: (input: { question: string; chat_history: BaseMessage[] }) => input.chat_history,
                },
                rephraseQuestionPrompt,
                this.llm,
                new StringOutputParser(),
            ]);

            // 2. Create a chain to retrieve documents based on the standalone question
            // This seems redundant now that we have retriever.pipe() directly
            // const retrieverChain = RunnableSequence.from([
            //     (prevResult) => prevResult.standalone_question, // Input is the output of standaloneQuestionChain
            //     retriever, // Retrieve documents
            //     formatDocumentsAsString, // Format documents into a single string
            // ]);

            // 3. Load chat history from the database
            const loadHistory = RunnablePassthrough.assign({
                chat_history: async (_input: { question: string }) => {
                    try {
                        const dbMessages = await this.chatModel.getMessages(sessionId, 10);
                        logger.debug(`[LangchainAgent] Loaded ${dbMessages.length} messages from DB for session ${sessionId}`);
                        return this.mapDbMessagesToLangchain(dbMessages);
                    } catch (dbError) {
                        logger.error(`[LangchainAgent] Failed to load history for session ${sessionId}:`, dbError);
                        throw new Error(`Failed to load chat history: ${dbError instanceof Error ? dbError.message : dbError}`);
                    }
                },
            });

            // 4. Create the main conversational chain 
            const conversationalRetrievalChain = loadHistory.pipe(
                RunnableSequence.from([
                    // Step 1: Generate standalone question 
                    RunnablePassthrough.assign({
                        standalone_question: standaloneQuestionChain
                    }),
                    // Step 2: Retrieve documents based on standalone question and format them
                    RunnablePassthrough.assign({
                        context: RunnableSequence.from([
                            (input) => input.standalone_question,
                            // Add the callback config to the retriever step
                            retriever.withConfig({ callbacks: [retrieverCallbacks] }),
                            formatDocumentsAsString,
                        ])
                    }),
                    // Step 3: Prepare input for the final answer prompt
                    (input: { question: string, chat_history: BaseMessage[], context: string, standalone_question: string }) => ({
                        question: input.question, // Use original question for the final answer
                        chat_history: input.chat_history,
                        context: input.context,
                    }),
                    // Step 4: Generate the final answer
                    answerPrompt,
                    this.llm,
                    new StringOutputParser(),
                ])
            );
            // *** END RESTORED CHAIN ***

            // Prepare RunnableConfig with the AbortSignal
            const config: RunnableConfig = { callbacks: [] }; 
            if (signal) {
                config.signal = signal;
            }

            logger.debug('[LangchainAgent] Invoking conversational retrieval stream...');
            const stream = await conversationalRetrievalChain.stream({ question }, config);

            for await (const chunk of stream) {
                fullResponse += chunk;
                onChunk(chunk ?? ''); 
            }
            logger.debug('[LangchainAgent] Stream ended.');

            // Save user message and AI response to the database
            try {
                await this.chatModel.addMessage({ session_id: sessionId, role: 'user', content: question });
                // Prepare metadata object
                const metadataToSave: ChatMessageSourceMetadata = { sourceChunkIds: retrievedChunkIds };
                // Save the assistant message AND get the returned object which includes the ID
                const savedAssistantMessage = await this.chatModel.addMessage({
                    session_id: sessionId,
                    role: 'assistant',
                    content: fullResponse,
                    metadata: metadataToSave // Pass the structured metadata object
                });
                logger.info(`[LangchainAgent] Saved user message and assistant message ${savedAssistantMessage.message_id} with ${retrievedChunkIds.length} source chunk IDs to DB for session ${sessionId}`);
                
                // Call onEnd with the required data
                onEnd({ 
                    messageId: savedAssistantMessage.message_id, // Pass the actual ID
                    metadata: metadataToSave // Pass the structured metadata
                }); 

                // Reset captured IDs for the next potential call
                retrievedChunkIds = [];
            } catch (memError) {
                logger.error(`[LangchainAgent] Failed to save messages to database for session ${sessionId}:`, memError);
                 // Re-throw or handle as needed - the FOREIGN KEY error will likely happen here
                 throw memError; 
            }

        } catch (error: any) {
            logger.error('[LangchainAgent] Error during queryStream:', error);
            onError(error instanceof Error ? error : new Error('An unexpected error occurred in LangchainAgent'));
        }
    }
}

// EXPORT the class itself for main.ts to import and instantiate
export { LangchainAgent };
