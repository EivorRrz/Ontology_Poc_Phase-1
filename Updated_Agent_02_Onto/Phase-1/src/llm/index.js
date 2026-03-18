/**
 * @Module LLM Index
 * @Description Export all LLM functions for easy import
 */

// LLM Service functions
export {
    Initializellm,
    Initializellm as initializeLLM,  // Alias for compatibility
    createChatSession,
    prompt,
    promptJSON,
    isLlmReady,
    isLlmReady as isLLMReady,  // Alias for compatibility
    getLLMStatus,
    disposeLLM,
} from "./llmService.js";

// PK/FK AI Analysis functions
export {
    analyzeMetadata,
    analyzeMetadata as analyzePKFKWithLLM,  // Alias for compatibility
    analyzeColumnWithLLM,
    suggestionRelelationships,
    suggestionRelelationships as suggestRelationships,  // Alias for compatibility
} from "./pkfkAssist.js";

// Production-Ready Metadata Enhancement
export {
    enhanceMetadataWithLLM,
    enhanceSingleColumn,
} from "./metadataEnhancer.js";

// Schemas
export {
    primaryKeySchema,
    foreignKeySchema,
    batchColumnSchema,
    getSchemaPrompt,
} from "./schema.js";

// LangChain Azure OpenAI Service
export {
    initializeLangChain,
    enhanceMetadataBatchWithLangChain,
    isLangChainReady,
    getLangChainStatus,
} from "./azureLangChainService.js";

// Pure Agentic Workflow (LangGraph)
export {
    createMetadataEnhancementAgent,
    runAgenticEnhancement,
} from "../agents/metadataEnhancementAgent.js";

