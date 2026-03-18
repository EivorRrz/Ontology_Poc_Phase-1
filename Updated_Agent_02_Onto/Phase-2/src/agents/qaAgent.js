/**
 * Q&A Agent (LangGraph with Memory)
 * Conversational Q&A agent with memory for physical model queries
 */

import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { AzureChatOpenAI } from "@langchain/openai";
import { initializeLangChain, isLangChainReady } from "../../../Phase-1/src/llm/azureLangChainService.js";
import logger from "../utils/logger.js";
import config from "../config.js";

/**
 * Agent State Schema for Q&A (Enhanced with Retry Logic)
 */
const qaStateSchema = Annotation.Root({
    question: Annotation({
        reducer: (x, y) => y || x || "",
        default: () => "",
    }),
    context: Annotation({
        reducer: (x, y) => y || x || {},
        default: () => ({}),
    }),
    conversationHistory: Annotation({
        reducer: (x, y) => {
            const existing = Array.isArray(x) ? x : [];
            if (!Array.isArray(y)) return existing;
            // If y is explicitly null, reset
            if (y === null) return [];
            return [...existing, ...y];
        },
        default: () => [],
    }),
    answer: Annotation({
        reducer: (x, y) => y || x || "",
        default: () => "",
    }),
    error: Annotation({
        reducer: (x, y) => y || x || null,
        default: () => null,
    }),
    retryCount: Annotation({
        reducer: (x, y) => {
            const current = x || 0;
            if (y === null || y === undefined) return current;
            return Math.max(0, y); // Absolute value
        },
        default: () => 0,
    }),
    shouldRetry: Annotation({
        reducer: (x, y) => y !== undefined ? y : (x || false),
        default: () => false,
    }),
    currentStep: Annotation({
        reducer: (x, y) => y || x || "start",
        default: () => "start",
    }),
    lastErrorTime: Annotation({
        reducer: (x, y) => y || x || null,
        default: () => null,
    }),
});

/**
 * Build context from artifacts
 */
function buildQaContext(lineage, impact, insights) {
    return {
        lineage: lineage || null,
        impact: impact || null,
        insights: insights || null,
    };
}

/**
 * Format conversation history for prompt
 */
function formatConversationHistory(history) {
    if (!history || history.length === 0) return "";
    
    let formatted = "\n\nPrevious conversation:\n";
    for (const msg of history.slice(-6)) { // Last 6 messages
        if (msg.role === "user") {
            formatted += `Q: ${msg.content}\n`;
        } else if (msg.role === "assistant") {
            formatted += `A: ${msg.content}\n`;
        }
    }
    return formatted;
}

/**
 * Initialize step
 */
async function initializeStep(state) {
    logger.debug("Q&A Agent: Initializing");
    return {
        ...state,
        currentStep: "initialized",
        retryCount: 0,
        error: null,
        shouldRetry: false,
    };
}

/**
 * Check if error is retryable (429 rate limit)
 */
function isRetryableError(error) {
    if (!error || !error.message) return false;
    const msg = error.message.toLowerCase();
    return msg.includes('429') || 
           msg.includes('rate limit') || 
           msg.includes('exceeded') ||
           msg.includes('quota');
}

/**
 * Extract retry delay from error (default 60s for rate limits)
 */
function getRetryDelay(error, retryCount) {
    if (isRetryableError(error)) {
        // For rate limits, use longer delay
        const baseDelay = 60000; // 60 seconds
        // Try to extract Retry-After header if available
        const retryAfter = error.response?.headers?.['retry-after'] || 
                          error.headers?.['retry-after'];
        if (retryAfter) {
            return parseInt(retryAfter) * 1000;
        }
        return baseDelay;
    }
    // Exponential backoff for other retryable errors
    return Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30s
}

/**
 * Wait step - handles rate limit delays (Pure Agentic)
 */
async function waitStep(state) {
    const { error, retryCount } = state;
    const delay = getRetryDelay(error, retryCount);
    
    logger.info({
        delay: `${delay / 1000}s`,
        retryCount,
        errorType: isRetryableError(error) ? 'rate_limit' : 'other'
    }, "Q&A Agent: Waiting before retry");
    
    // Show progress to user
    if (delay >= 10000) {
        console.log(`⏳ Rate limit detected. Waiting ${Math.round(delay / 1000)} seconds before retry...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Preserve retry count and error state for the retry
    return {
        ...state,
        currentStep: "waited",
        // Keep retryCount and error so generateAnswerStep knows it's a retry
    };
}

/**
 * Decision node - should we retry? (Returns next node name)
 */
function shouldRetryDecision(state) {
    const { error, retryCount } = state;
    const MAX_RETRIES = 3;
    
    // No error - continue to update memory
    if (!error) {
        return "updateMemory";
    }
    
    // Check if we should retry
    if (isRetryableError(error) && retryCount < MAX_RETRIES) {
        logger.info({
            retryCount,
            maxRetries: MAX_RETRIES,
            error: error.message?.substring(0, 100)
        }, "Q&A Agent: Decision - Will retry");
        return "wait"; // Wait before retrying
    }
    
    // Max retries reached or non-retryable error
    logger.warn({
        retryCount,
        maxRetries: MAX_RETRIES,
        error: error.message?.substring(0, 100)
    }, "Q&A Agent: Decision - Max retries reached or non-retryable error");
    
    return "handleError"; // Handle the error
}

/**
 * Generate answer step
 */
async function generateAnswerStep(state) {
    if (!isLangChainReady()) {
        await initializeLangChain();
    }

    const { question, context, conversationHistory, retryCount } = state;
    
    // Increment retry count if this is a retry
    const currentRetryCount = retryCount || 0;
    if (currentRetryCount > 0) {
        logger.info({ retryCount: currentRetryCount }, "Q&A Agent: Retrying after wait");
    }
    
    if (!question || question.trim() === "") {
        return {
            ...state,
            answer: "Please provide a question.",
            currentStep: "answered",
        };
    }

    const contextJson = JSON.stringify(context, null, 2);
    const historyText = formatConversationHistory(conversationHistory);

    // Build comprehensive context description
    const contextDescription = `You are talking DIRECTLY to a DATA MODEL. You have COMPLETE ACCESS to everything about this model.

AVAILABLE DATA:

1) LINEAGE → Complete source tracking
   - Where each table came from (file paths, upload dates, original names)
   - Where each column came from (row numbers, source data)
   - Data lineage and provenance tracking
   - Source file information

2) IMPACT ANALYSIS → Full dependency analysis
   - Which tables depend on which (via foreign keys)
   - What happens if a table/column is dropped (cascade effects)
   - Dependency chains and relationship graphs
   - Impact of changes on dependent tables
   - Referential integrity relationships

3) GRAPH INSIGHTS → Complete schema analysis
   - Primary key coverage and missing PKs
   - Foreign key coverage and missing FKs
   - Orphaned tables (isolated, no relationships)
   - Missing constraints and risks
   - Domain/subdomain distribution
   - Table and column statistics
   - Schema health metrics
   - Risk indicators

4) FULL METADATA → Complete model structure
   - ALL tables with ALL columns
   - Data types, descriptions, attributes
   - Primary keys, foreign keys, unique constraints
   - Relationships and referential integrity
   - Domain and subdomain information
   - Column descriptions and business rules
   - Table descriptions and entity information
   - Index recommendations
   - Optimization suggestions

YOU CAN ANSWER QUESTIONS ABOUT:
- ANY table: structure, columns, relationships, purpose
- ANY column: type, description, constraints, relationships
- Lineage: where anything came from
- Impact: what affects what, dependencies, cascades
- Graph: relationships, connections, paths
- Health: risks, issues, missing constraints
- Statistics: counts, coverage, distributions
- Domains: which tables belong to which domains
- Business logic: descriptions, rules, purposes
- Recommendations: optimizations, improvements
- Comparisons: between tables, columns, domains
- Patterns: naming conventions, structures
- ANYTHING about this data model!`;

    const systemPrompt = `You are an enterprise data architecture assistant for EY.

${contextDescription}

CRITICAL RULES:
- You can answer ANY question about this data model - be comprehensive and helpful.
- Use clear, professional English explanations (adjust technical level based on question).
- ONLY use facts present in the JSON context provided.
- If something is not in the JSON, say "The system does not have that information."
- Do NOT invent tables, columns, constraints, or risks.
- You CAN analyze, compare, explain, and provide insights based on the data.
- You CAN answer questions about:
  * Specific tables or columns (structure, purpose, relationships)
  * Lineage and source tracking
  * Impact and dependencies
  * Graph structure and relationships
  * Schema health and risks
  * Statistics and metrics
  * Domains and categorization
  * Business logic and descriptions
  * Patterns and conventions
  * Comparisons and analysis
  * Recommendations (based on the data)
- Use the conversation history to provide context-aware answers for follow-up questions.
- Be thorough - if asked about a table, provide comprehensive information about it.
- If asked "anything" or "everything", provide a comprehensive overview.`;

    const prompt = ChatPromptTemplate.fromMessages([
        ["system", systemPrompt],
        new MessagesPlaceholder("history"),
        ["human", `COMPLETE DATA MODEL INFORMATION:
{contextJson}
${historyText}

User's Question:
{question}

INSTRUCTIONS:
- Answer comprehensively based on ALL available data (lineage, impact, graph insights, metadata)
- If asked about a specific table/column, provide complete details
- If asked about relationships, show the full dependency graph
- If asked about health/risks, provide detailed analysis
- If asked "anything" or "everything", give a comprehensive overview
- Use the conversation history for context in follow-up questions
- Be thorough and helpful - you have access to everything about this model`],
    ]);

    try {
        // Get Azure config from Phase-1 config (env should already be loaded at module level)
        const phase1Config = (await import("../../../Phase-1/src/config/index.js")).default;
        const azureConfig = phase1Config.azure;

        if (!azureConfig || !azureConfig.apiKey || !azureConfig.endpoint) {
            throw new Error("Azure OpenAI configuration missing! Check your .env file.");
        }

        const endpointUrl = new URL(azureConfig.endpoint);
        const instanceName = endpointUrl.hostname.split('.')[0];

        const llm = new AzureChatOpenAI({
            azureOpenAIApiKey: azureConfig.apiKey,
            azureOpenAIApiInstanceName: instanceName,
            azureOpenAIApiDeploymentName: azureConfig.deploymentName,
            azureOpenAIApiVersion: azureConfig.apiVersion,
            temperature: 0.3,
            maxTokens: 2048,
            timeout: 30000,
            maxRetries: 0, // We handle retries ourselves
        });

        // Convert conversation history to LangChain messages
        const historyMessages = conversationHistory.map(msg => {
            if (msg.role === "user") {
                return { role: "human", content: msg.content };
            } else if (msg.role === "assistant") {
                return { role: "ai", content: msg.content };
            }
            return null;
        }).filter(Boolean);

        const chain = prompt.pipe(llm);
        const response = await chain.invoke({
            contextJson: contextJson,
            question: question,
            history: historyMessages,
        });

        const answer = response.content || "I couldn't generate an answer. Please try again.";

        // Update conversation history
        const updatedHistory = [
            ...conversationHistory,
            { role: "user", content: question },
            { role: "assistant", content: answer },
        ];

        logger.info({
            questionLength: question.length,
            answerLength: answer.length,
            historyLength: updatedHistory.length,
        }, "Q&A Agent: Answer generated");

        return {
            ...state,
            answer: answer,
            error: null, // Clear any previous errors
            retryCount: 0, // Reset retry count on success
            shouldRetry: false,
            currentStep: "answered",
        };

    } catch (error) {
        const isRetryable = isRetryableError(error);
        const currentRetryCount = state.retryCount || 0;
        
        logger.warn({
            error: error.message,
            isRetryable,
            retryCount: currentRetryCount,
            errorType: isRetryable ? 'rate_limit' : 'other'
        }, "Q&A Agent: Error occurred");
        
        return {
            ...state,
            error: {
                message: error.message,
                isRetryable: isRetryable,
                timestamp: Date.now(),
            },
            retryCount: currentRetryCount + 1, // Increment retry count
            lastErrorTime: Date.now(),
            currentStep: "error",
            shouldRetry: isRetryable && currentRetryCount < 3,
        };
    }
}

/**
 * Handle error step - provide user-friendly error message
 */
async function handleErrorStep(state) {
    const { error, retryCount } = state;
    
    if (!error) {
        return {
            ...state,
            answer: "An unknown error occurred.",
            currentStep: "failed",
        };
    }
    
    let errorMessage = "I encountered an error while processing your question.";
    
    if (isRetryableError(error)) {
        if (retryCount >= 3) {
            errorMessage = "I'm experiencing rate limit issues. Please wait a minute and try again, or ask a simpler question.";
        } else {
            errorMessage = `Rate limit reached. Retrying in a moment... (Attempt ${retryCount + 1}/3)`;
        }
    } else {
        errorMessage = `Error: ${error.message}. Please try rephrasing your question.`;
    }
    
    return {
        ...state,
        answer: errorMessage,
        currentStep: "failed",
    };
}

/**
 * Update memory step - store successful Q&A in history
 */
async function updateMemoryStep(state) {
    const { question, answer, conversationHistory } = state;
    
    if (answer && !answer.startsWith("Error:") && !answer.includes("rate limit")) {
        const updatedHistory = [
            ...conversationHistory,
            { role: "user", content: question },
            { role: "assistant", content: answer },
        ];
        
        logger.info({
            questionLength: question.length,
            answerLength: answer.length,
            historyLength: updatedHistory.length,
        }, "Q&A Agent: Memory updated");
        
        return {
            ...state,
            conversationHistory: updatedHistory,
            currentStep: "completed",
        };
    }
    
    return {
        ...state,
        currentStep: "completed",
    };
}

/**
 * Create Q&A Agent (Pure Agentic with Retry Logic)
 */
export function createQaAgent() {
    const workflow = new StateGraph(qaStateSchema)
        .addNode("initialize", initializeStep)
        .addNode("generateAnswer", generateAnswerStep)
        .addNode("wait", waitStep)
        .addNode("handleError", handleErrorStep)
        .addNode("updateMemory", updateMemoryStep)
        .setEntryPoint("initialize")
        .addEdge("initialize", "generateAnswer")
        // Decision: check if we should retry on error or continue
        .addConditionalEdges(
            "generateAnswer",
            shouldRetryDecision,
            {
                "updateMemory": "updateMemory",
                "wait": "wait",
                "handleError": "handleError",
            }
        )
        .addEdge("wait", "generateAnswer") // After waiting, retry generation
        .addEdge("updateMemory", END)
        .addEdge("handleError", END);

    return workflow.compile();
}

/**
 * Run Q&A Agent (Pure Agentic with Automatic Retries)
 */
export async function runQaAgent(question, context, conversationHistory = []) {
    const agent = createQaAgent();
    
    const initialState = {
        question: question,
        context: context,
        conversationHistory: conversationHistory,
        answer: "",
        error: null,
        retryCount: 0,
        shouldRetry: false,
        currentStep: "start",
        lastErrorTime: null,
    };

    try {
        const result = await agent.invoke(initialState);
        
        // If we got an answer, update memory
        let finalHistory = result.conversationHistory || conversationHistory;
        if (result.answer && !result.answer.startsWith("Error:") && !result.answer.includes("rate limit")) {
            // Memory was already updated in updateMemoryStep
            finalHistory = result.conversationHistory;
        }
        
        return {
            answer: result.answer,
            conversationHistory: finalHistory,
            retryCount: result.retryCount || 0,
            success: !result.error && result.answer && !result.answer.startsWith("Error:"),
        };
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack }, "Q&A Agent: Fatal error");
        return {
            answer: `Fatal error: ${error.message}. Please try again.`,
            conversationHistory: conversationHistory,
            retryCount: 0,
            success: false,
        };
    }
}
