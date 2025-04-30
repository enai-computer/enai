"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangchainAgent = void 0;
const openai_1 = require("@langchain/openai");
const prompts_1 = require("@langchain/core/prompts");
const runnables_1 = require("@langchain/core/runnables");
const output_parsers_1 = require("@langchain/core/output_parsers");
const document_1 = require("langchain/util/document");
const messages_1 = require("@langchain/core/messages");
const logger_1 = require("../../utils/logger"); // Adjust path as needed
// Helper function to format chat history messages using instanceof
const formatChatHistory = (chatHistory) => {
    const formattedDialogueTurns = chatHistory.map((message) => {
        if (message instanceof messages_1.HumanMessage) {
            return `Human: ${message.content}`;
        }
        else if (message instanceof messages_1.AIMessage) {
            return `Assistant: ${message.content}`;
        }
        else {
            // Fallback for other potential message types
            return `${message.constructor.name}: ${message.content}`;
        }
    });
    return formattedDialogueTurns.join("\n");
};
// --- Prompt Templates ---
const REPHRASE_QUESTION_SYSTEM_TEMPLATE = `Given the following conversation and a follow up question, rephrase the 
follow up question to be a standalone question, in its original language.`;
const rephraseQuestionPrompt = prompts_1.ChatPromptTemplate.fromMessages([
    ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
    new prompts_1.MessagesPlaceholder("chat_history"),
    ["human", "{question}"],
]);
const ANSWER_SYSTEM_TEMPLATE = `You are a helpful assistant for answering questions based on provided context.
Answer the user's question based only on the following context. 
If the context doesn't contain the answer, state clearly that the context does not provide an answer.
Do not make up information or answer questions not related to the context.

Context:
--------
{context}
--------`;
const answerPrompt = prompts_1.ChatPromptTemplate.fromMessages([
    ["system", ANSWER_SYSTEM_TEMPLATE],
    new prompts_1.MessagesPlaceholder("chat_history"),
    ["human", "{question}"],
]);
class LangchainAgent {
    constructor(vectorModelInstance, chatModelInstance) {
        this.vectorModel = vectorModelInstance;
        this.chatModel = chatModelInstance; // Store the instance
        // Ensure OPENAI_API_KEY is available in the environment
        this.llm = new openai_1.ChatOpenAI({
            modelName: "gpt-4o", // Or your preferred model
            temperature: 0.2,
            streaming: true,
        });
        logger_1.logger.info("[LangchainAgent] Initialized with OpenAI model.");
    }
    /** Converts DB message format to LangChain message format. */
    mapDbMessagesToLangchain(messages) {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return new messages_1.HumanMessage(msg.content);
            }
            else if (msg.role === 'assistant') {
                return new messages_1.AIMessage(msg.content);
            }
            else {
                // Handle system messages or other roles if necessary
                // For now, maybe treat system as AIMessage or filter out?
                logger_1.logger.warn(`[LangchainAgent] Unsupported role '{msg.role}' found in DB history, treating as AI.`);
                return new messages_1.AIMessage(msg.content);
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
    async queryStream(sessionId, question, onChunk, onEnd, onError, signal, k = 4) {
        let fullResponse = ""; // To accumulate the response for memory
        try {
            logger_1.logger.debug(`[LangchainAgent] queryStream started for session ${sessionId}, question: "${question.substring(0, 50)}...", k=${k}`);
            const retriever = await this.vectorModel.getRetriever(k); // Use parameter k
            // 1. Create a chain to generate a standalone question
            const standaloneQuestionChain = runnables_1.RunnableSequence.from([
                {
                    // Pass chat history and the current question
                    question: (input) => input.question,
                    chat_history: (input) => input.chat_history,
                },
                rephraseQuestionPrompt,
                this.llm,
                new output_parsers_1.StringOutputParser(),
            ]);
            // 2. Create a chain to retrieve documents based on the standalone question
            const retrieverChain = runnables_1.RunnableSequence.from([
                (prevResult) => prevResult.standalone_question, // Input is the output of standaloneQuestionChain
                retriever, // Retrieve documents
                document_1.formatDocumentsAsString, // Format documents into a single string
            ]);
            // 3. Load chat history from the database
            const loadHistory = runnables_1.RunnablePassthrough.assign({
                chat_history: async (_input) => {
                    try {
                        // Fetch history, limit if needed (e.g., last 10 messages)
                        // Use the injected chatModel instance
                        const dbMessages = await this.chatModel.getMessages(sessionId, 10);
                        logger_1.logger.debug(`[LangchainAgent] Loaded ${dbMessages.length} messages from DB for session ${sessionId}`);
                        return this.mapDbMessagesToLangchain(dbMessages);
                    }
                    catch (dbError) {
                        logger_1.logger.error(`[LangchainAgent] Failed to load history for session ${sessionId}:`, dbError);
                        // Decide how to handle: proceed with empty history or throw?
                        // Throwing might be safer to prevent unexpected behavior.
                        throw new Error(`Failed to load chat history: ${dbError instanceof Error ? dbError.message : dbError}`);
                    }
                },
            });
            // 4. Create the main conversational chain (Simplified Structure)
            const conversationalRetrievalChain = loadHistory.pipe(runnables_1.RunnableSequence.from([
                // Step 1: Generate standalone question OR pass original if no history
                runnables_1.RunnablePassthrough.assign({
                    standalone_question: runnables_1.RunnableSequence.from([
                        (input) => ({ question: input.question, chat_history: input.chat_history }),
                        standaloneQuestionChain,
                        this.llm,
                        new output_parsers_1.StringOutputParser(),
                    ])
                    // TODO: Add branching logic here if needed - e.g., skip rephrase if history is empty
                }),
                // Step 2: Retrieve documents based on standalone question
                runnables_1.RunnablePassthrough.assign({
                    context: runnables_1.RunnableSequence.from([
                        (input) => input.standalone_question,
                        retrieverChain,
                        document_1.formatDocumentsAsString,
                    ])
                }),
                // Step 3: Prepare input for the final answer prompt
                (input) => ({
                    question: input.question, // Use original question for the final answer
                    chat_history: input.chat_history,
                    context: input.context,
                }),
                // Step 4: Generate the final answer
                answerPrompt,
                this.llm,
                new output_parsers_1.StringOutputParser(),
            ]));
            // Prepare RunnableConfig with the AbortSignal
            const config = { callbacks: [] }; // Add other configs like tags if needed
            if (signal) {
                config.signal = signal;
            }
            logger_1.logger.debug('[LangchainAgent] Invoking conversational retrieval stream...');
            const stream = await conversationalRetrievalChain.stream({ question }, config);
            for await (const chunk of stream) {
                fullResponse += chunk;
                // NOTE: Throttling/batching this callback should be handled by the caller (ChatService)
                //       to optimize UI performance.
                onChunk(chunk ?? ''); // Safeguard against undefined/null chunks
            }
            logger_1.logger.debug('[LangchainAgent] Stream ended.');
            // Save user message and AI response to the database
            try {
                // Save user message using the injected chatModel
                await this.chatModel.addMessage({ session_id: sessionId, role: 'user', content: question });
                // Save AI response using the injected chatModel
                await this.chatModel.addMessage({ session_id: sessionId, role: 'assistant', content: fullResponse });
                logger_1.logger.info(`[LangchainAgent] Saved user and AI messages to DB for session ${sessionId}`);
            }
            catch (memError) {
                logger_1.logger.error('[LangchainAgent] Failed to save messages to database for session ${sessionId}:', memError);
                // Decide if this should trigger onError or just be logged
                // Depending on requirements, might want to call onError here too.
            }
            onEnd(); // Signal successful completion
        }
        catch (error) {
            logger_1.logger.error('[LangchainAgent] Error during queryStream:', error);
            onError(error instanceof Error ? error : new Error('An unexpected error occurred in LangchainAgent'));
        }
    }
}
exports.LangchainAgent = LangchainAgent;
//# sourceMappingURL=LangchainAgent.js.map