/**
 * @module Azure langChain Service(Production-Ready..!)
 * @description Production Ready langchain integrations with Azure OpenAI
 * Features: Structured Outputs,Circuit Breaker ,Rate-Limiting & error Logging..
 * 
 */

import { AzureChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts"
import { RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import logger from "../utils/logger.js";
import config from "../config/index.js";


//Lets Init..!
let langChainClient = null;
let isInitialized = false;


//Circuit-Breaker Pattern..!
const circuitBreaker = {
    failures: 0,
    lastFailureTime: null,
    state: "CLOSED", // CLOSED, OPEN, HALF_OPEN
    failureThreshold: 5,
    resetTimeout: 60000, // 60 seconds
    halfOpenTimeout: 30000,
};

//Rate-limiting..!
const rateLimiter = {
    requests: [],
    maxRequestsPerMinute: 50,
    windowMs: 60000, // 60 seconds
};

/**
 * Check Circuit Breaker State..!
 */
function checkCircuitBreaker() {
    const now = Date.now(); // Fixed: Use Date.now() instead of new Date()

    if (circuitBreaker.state === "OPEN") {
        if (now - circuitBreaker.lastFailureTime > circuitBreaker.resetTimeout) {
            circuitBreaker.state = "HALF_OPEN";
            logger.info("Circuit Breaker: Moving to HALF_OPEN state");
            return true;
        }
        return false; // Block Request
    }
    return true; // CLOSED or HALF_OPEN - Allow Request
}

/**
 * Record success - reset circuit breaker
 */
function recordSuccess() {
    if (circuitBreaker.state === "HALF_OPEN") {
        circuitBreaker.state = "CLOSED";
        circuitBreaker.failures = 0;
        logger.info("Circuit Breaker: Reset to CLOSED state");
    }
}

/**
 * Record failure - update circuit breaker
 */
function recordFailure() {
    circuitBreaker.failures++;
    circuitBreaker.lastFailureTime = Date.now();

    if (circuitBreaker.failures >= circuitBreaker.failureThreshold) {
        circuitBreaker.state = "OPEN";
        logger.warn({
            failures: circuitBreaker.failures,
            threshold: circuitBreaker.failureThreshold
        }, "Circuit Breaker: OPEN - blocking requests");
    }
}

/**
 * Check rate limit
 */
function checkRateLimit() {
    const now = Date.now();

    // Remove old requests outside window
    rateLimiter.requests = rateLimiter.requests.filter(
        time => now - time < rateLimiter.windowMs
    );

    if (rateLimiter.requests.length >= rateLimiter.maxRequestsPerMinute) {
        const oldestRequest = rateLimiter.requests[0];
        const waitTime = rateLimiter.windowMs - (now - oldestRequest);
        logger.warn({
            currentRequests: rateLimiter.requests.length,
            maxRequests: rateLimiter.maxRequestsPerMinute,
            waitTime: `${Math.round(waitTime / 1000)}s`
        }, "Rate limit exceeded, waiting...");
        return waitTime;
    }

    rateLimiter.requests.push(now);
    return 0;
}

/**
 * Initialize LangChain Azure OpenAI client
 */
export async function initializeLangChain() {
    if (isInitialized && langChainClient) {
        return langChainClient;
    }

    const azureConfig = config.azure;

    if (!azureConfig || !azureConfig.apiKey || !azureConfig.endpoint) {
        const error = new Error("Azure OpenAI configuration missing! Check your .env file.");
        logger.error({
            hasApiKey: !!azureConfig?.apiKey,
            hasEndpoint: !!azureConfig?.endpoint
        }, error.message);
        throw error;
    }

    try {
        // Extract instance name from endpoint (e.g., "https://ontology-poc.openai.azure.com" -> "ontology-poc")
        const endpointUrl = new URL(azureConfig.endpoint);
        const instanceName = endpointUrl.hostname.split('.')[0];

        logger.debug({
            endpoint: azureConfig.endpoint,
            instanceName: instanceName,
            deployment: azureConfig.deploymentName,
            apiVersion: azureConfig.apiVersion,
        }, "🔧 Configuring LangChain AzureChatOpenAI");

        // Use AzureChatOpenAI which handles Azure-specific URL construction automatically
        langChainClient = new AzureChatOpenAI({
            azureOpenAIApiKey: azureConfig.apiKey,
            azureOpenAIApiInstanceName: instanceName,
            azureOpenAIApiDeploymentName: azureConfig.deploymentName,
            azureOpenAIApiVersion: azureConfig.apiVersion,
            temperature: 0.3,
            maxTokens: 4096,
            timeout: config.llm.metadataEnhancement.timeout || 30000,
            maxRetries: 0, // We handle retries ourselves
        });

        isInitialized = true;
        logger.info({
            endpoint: azureConfig.endpoint,
            instanceName: instanceName,
            deployment: azureConfig.deploymentName,
            version: azureConfig.apiVersion,
        }, "✅ LangChain AzureChatOpenAI initialized successfully");

        return langChainClient;
    } catch (error) {
        isInitialized = false;
        logger.error({
            error: error.message,
            stack: error.stack
        }, "Failed to initialize LangChain");
        throw error;
    }
}

/**
 * Create Zod schema for metadata enhancement
 */
function createMetadataEnhancementSchema() {
    return z.object({
        columns: z.array(z.object({
            columnName: z.string().describe("Original column name"),
            tableName: z.string().describe("Table name"),
            normalizedColumnName: z.string().describe("Cleaned and normalized column name"),
            correctedDataType: z.string().describe("Corrected data type"),
            dataTypeConfidence: z.number().min(0).max(1).describe("Confidence in data type correction"),
            enhancedDescription: z.string().nullable().optional().describe("Improved description"),
            descriptionQuality: z.enum(["excellent", "good", "needs_improvement", "missing"]).optional(),
            isPrimaryKey: z.boolean().optional(),
            pkConfidence: z.number().min(0).max(1).optional(),
            isForeignKey: z.boolean().optional(),
            fkConfidence: z.number().min(0).max(1).optional(),
            referenceTable: z.string().nullable().optional(),
            referencesColumn: z.string().nullable().optional(),
            issues: z.array(z.string()).optional(),
            suggestions: z.array(z.string()).optional(),
        })),
        overallQuality: z.object({
            score: z.number().min(0).max(1),
            issuesFound: z.number(),
            improvementsMade: z.number(),
            summary: z.string(),
        }).optional(),
    });
}

/**
 * Build enhancement context from metadata
 */
function buildEnhancementContext(metadata) {
    if (!metadata || !Array.isArray(metadata) || metadata.length === 0) {
        return "No metadata provided.";
    }

    const tables = {};
    for (const col of metadata) {
        if (!col || typeof col !== 'object') continue;

        const tableName = col.tableName || col.table_name || "unknown";
        if (!tables[tableName]) {
            tables[tableName] = [];
        }
        tables[tableName].push(col);
    }

    let context = 'DATABASE METADATA FOR ENHANCEMENT:\n\n';

    for (const [tableName, columns] of Object.entries(tables)) {
        context += `TABLE: ${tableName}\n`;
        if (columns[0]?.entityDescription) {
            context += `Description: ${columns[0].entityDescription}\n`;
        }
        context += `Columns:\n`;

        for (const col of columns) {
            if (!col || !col.columnName) continue;

            context += `  - ${col.columnName}`;
            if (col.dataType) context += ` (${col.dataType})`;
            if (col.description) context += ` - "${col.description}"`;
            if (col.isPrimaryKey) context += ` [PK]`;
            if (col.isForeignKey) context += ` [FK → ${col.referencesTable || '?'}]`;
            context += `\n`;
        }
        context += `\n`;
    }

    return context;
}

/**
 * Enhance metadata batch using LangChain
 */
export async function enhanceMetadataBatchWithLangChain(metadata, batch, retryCount = 0) {
    // Input validation
    if (!metadata || !Array.isArray(metadata) || metadata.length === 0) {
        throw new Error("Invalid metadata: must be a non-empty array");
    }

    if (!batch || !Array.isArray(batch) || batch.length === 0) {
        throw new Error("Invalid batch: must be a non-empty array");
    }

    // Check circuit breaker
    if (!checkCircuitBreaker()) {
        const error = new Error("Circuit breaker is OPEN - service temporarily unavailable");
        logger.warn({
            state: circuitBreaker.state,
            failures: circuitBreaker.failures
        }, error.message);
        throw error;
    }

    // Check rate limit
    const waitTime = checkRateLimit();
    if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    if (!isInitialized) {
        await initializeLangChain();
    }

    const MAX_RETRIES = config.llm.metadataEnhancement.maxRetries || 3;
    const RETRY_DELAY = config.llm.metadataEnhancement.retryDelay || 1000;
    const TIMEOUT = config.llm.metadataEnhancement.timeout || 30000;

    try {
        const schema = createMetadataEnhancementSchema();
        const parser = StructuredOutputParser.fromZodSchema(schema);
        const formatInstructions = parser.getFormatInstructions();

        const context = buildEnhancementContext(metadata);

        const promptTemplate = PromptTemplate.fromTemplate(`
{context}

TASK: Enhance and validate this metadata batch for production use.

For EACH column, perform these checks and improvements:

1. COLUMN NAME NORMALIZATION:
   - Remove leading/trailing quotes
   - Normalize to valid SQL identifier format

2. DATA TYPE CORRECTION:
   - ID columns (*_id, *id) should be VARCHAR or INTEGER, NEVER DATE/TIMESTAMP
   - Date/time columns should be TIMESTAMP
   - Boolean flags should be BOOLEAN
   - Numeric columns should be DECIMAL or INTEGER
   - Provide confidence score (0-1)

3. DESCRIPTION ENHANCEMENT:
   - Generate professional descriptions if missing
   - Rate quality: "excellent", "good", "needs_improvement", or "missing"

4. PRIMARY KEY / FOREIGN KEY VALIDATION:
   - Verify PK/FK assignments
   - Provide confidence scores

5. QUALITY ISSUES:
   - Identify problems
   - Provide suggestions

BATCH TO PROCESS:
{jsonBatch}

{formatInstructions}

IMPORTANT RULES:
- Only change data types if confidence > 0.7
- Preserve original values if already correct
        `);

        const chain = RunnableSequence.from([
            promptTemplate,
            langChainClient,
            parser,
        ]);

        logger.debug({
            batchSize: batch.length,
            retry: retryCount
        }, 'Processing metadata batch with LangChain');

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Request timeout after ${TIMEOUT}ms`)), TIMEOUT);
        });

        const result = await Promise.race([
            chain.invoke({
                context: context,
                jsonBatch: JSON.stringify(batch, null, 2),
                formatInstructions: formatInstructions,
            }),
            timeoutPromise
        ]);

        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response structure from LangChain');
        }

        if (!result.columns || !Array.isArray(result.columns) || result.columns.length === 0) {
            throw new Error('Empty or invalid columns array in response');
        }

        recordSuccess();

        logger.info({
            columnsProcessed: result.columns.length,
            qualityScore: result.overallQuality?.score || 0
        }, "LangChain batch enhancement completed");

        return result;

    } catch (error) {
        recordFailure();

        // Log detailed error information
        const errorDetails = {
            message: error.message,
            name: error.name,
            code: error.code,
            cause: error.cause?.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
        };

        const isRetryable = error.message.includes('timeout') ||
            error.message.includes('network') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('Connection error') ||
            (error.response?.status >= 500 && error.response?.status < 600);

        if (isRetryable && retryCount < MAX_RETRIES) {
            logger.warn({
                ...errorDetails,
                retry: retryCount + 1,
                maxRetries: MAX_RETRIES,
                errorType: 'retryable'
            }, 'LangChain batch processing failed, retrying...');

            const delay = RETRY_DELAY * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));

            return enhanceMetadataBatchWithLangChain(metadata, batch, retryCount + 1);
        }

        logger.error({
            ...errorDetails,
            retryCount,
            isRetryable,
            circuitBreakerState: circuitBreaker.state
        }, 'LangChain enhancement failed after retries');

        throw error;
    }
}

/**
 * Check if LangChain is ready
 */
export function isLangChainReady() {
    return isInitialized && langChainClient !== null;
}

/**
 * Get LangChain status
 */
export function getLangChainStatus() {
    return {
        initialized: isInitialized,
        provider: "Azure OpenAI",
        model: config.azure.deploymentName,
        endpoint: config.azure.endpoint,
        circuitBreaker: {
            state: circuitBreaker.state,
            failures: circuitBreaker.failures,
            lastFailureTime: circuitBreaker.lastFailureTime,
        },
        rateLimiter: {
            currentRequests: rateLimiter.requests.length,
            maxRequests: rateLimiter.maxRequestsPerMinute,
        },
    };
}

/**
 * Unified helper function for LangChain structured output calls
 * Can be reused across all components (logical model, physical model, Q&A, etc.)
 * 
 * @param {z.ZodSchema} schema - Zod schema for structured output
 * @param {string} promptTemplate - Prompt template string with {variables}
 * @param {Object} variables - Variables to inject into prompt template
 * @param {Object} options - Optional configuration (timeout, retries, etc.)
 * @returns {Promise<Object>} - Parsed structured output
 */
export async function callLangChainWithSchema(schema, promptTemplate, variables = {}, options = {}) {
    // Check circuit breaker
    if (!checkCircuitBreaker()) {
        const error = new Error("Circuit breaker is OPEN - service temporarily unavailable");
        logger.warn({
            state: circuitBreaker.state,
            failures: circuitBreaker.failures
        }, error.message);
        throw error;
    }

    // Check rate limit
    const waitTime = checkRateLimit();
    if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    if (!isInitialized) {
        await initializeLangChain();
    }

    const MAX_RETRIES = options.maxRetries || 3;
    const RETRY_DELAY = options.retryDelay || 1000;
    const TIMEOUT = options.timeout || 30000;

    try {
        const parser = StructuredOutputParser.fromZodSchema(schema);
        const formatInstructions = parser.getFormatInstructions();

        const prompt = PromptTemplate.fromTemplate(promptTemplate);
        const chain = RunnableSequence.from([
            prompt,
            langChainClient,
            parser,
        ]);

        logger.debug({
            schemaType: schema._def?.typeName || 'unknown',
            variables: Object.keys(variables),
        }, 'Calling LangChain with structured schema');

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Request timeout after ${TIMEOUT}ms`)), TIMEOUT);
        });

        const result = await Promise.race([
            chain.invoke({
                ...variables,
                formatInstructions: formatInstructions,
            }),
            timeoutPromise
        ]);

        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response structure from LangChain');
        }

        recordSuccess();

        logger.info({
            schemaType: schema._def?.typeName || 'unknown',
        }, "LangChain structured call completed successfully");

        return result;

    } catch (error) {
        recordFailure();

        const errorDetails = {
            message: error.message,
            name: error.name,
            code: error.code,
            cause: error.cause?.message,
        };

        const isRetryable = error.message.includes('timeout') ||
            error.message.includes('network') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('Connection error') ||
            error.message.includes('429') ||
            error.message.includes('rate limit') ||
            (error.response?.status >= 500 && error.response?.status < 600);

        if (isRetryable && (options.retryCount || 0) < MAX_RETRIES) {
            const retryCount = (options.retryCount || 0) + 1;
            logger.warn({
                ...errorDetails,
                retry: retryCount,
                maxRetries: MAX_RETRIES,
                errorType: 'retryable'
            }, 'LangChain call failed, retrying...');

            // Use longer delay for rate limits
            const isRateLimit = error.message.includes('429') || error.message.includes('rate limit');
            const delay = isRateLimit ? 60000 : RETRY_DELAY * Math.pow(2, retryCount - 1);
            await new Promise(resolve => setTimeout(resolve, delay));

            return callLangChainWithSchema(schema, promptTemplate, variables, {
                ...options,
                retryCount: retryCount
            });
        }

        logger.error({
            ...errorDetails,
            retryCount: options.retryCount || 0,
            isRetryable,
            circuitBreakerState: circuitBreaker.state
        }, 'LangChain call failed after retries');

        throw error;
    }
}
