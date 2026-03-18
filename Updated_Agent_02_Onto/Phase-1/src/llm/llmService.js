/**
 * @Module LLM Service
 * @Description Azure OpenAI LLM Service
 * Uses Azure OpenAI for all LLM operations
 */

import { OpenAI } from "openai";
import logger from "../utils/logger.js";
import config from "../config/index.js";

// Azure OpenAI client
let azureClient = null;

// Connection status
let isConnected = false;

/**
 * Initialize Azure OpenAI connection
 */
export async function Initializellm() {
    try {
        if (!config.azure.apiKey || !config.azure.endpoint) {
            throw new Error("Azure OpenAI credentials not configured. Please set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT in .env");
        }

        logger.info({ 
            endpoint: config.azure.endpoint,
            deploymentName: config.azure.deploymentName 
        }, "Connecting to Azure OpenAI...");

        azureClient = new OpenAI({
            apiKey: config.azure.apiKey,
            baseURL: `${config.azure.endpoint}/openai/deployments/${config.azure.deploymentName}`,
            defaultQuery: { 'api-version': config.azure.apiVersion },
            defaultHeaders: { 'api-key': config.azure.apiKey }
        });

        // Test connection with a simple request
        const testResponse = await azureClient.chat.completions.create({
            model: config.azure.deploymentName,
            messages: [{ role: "user", content: "test" }],
            max_tokens: 5
        });

        isConnected = true;
        
        logger.info({ 
            provider: "Azure OpenAI",
            model: config.azure.deploymentName,
            endpoint: config.azure.endpoint
        }, "🧠 Connected to Azure OpenAI successfully!");

        return { connected: true, model: config.azure.deploymentName, provider: "azure" };
    } catch (error) {
        isConnected = false;
        logger.error({ error: error.message }, "Failed to connect to Azure OpenAI");
        throw new Error(`Azure OpenAI connection failed: ${error.message}`);
    }
}

/**
 * Send a prompt to Azure OpenAI
 * @param {string} promptText - The prompt to send
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - The LLM response
 */
export async function prompt(promptText, options = {}) {
    if (!azureClient) {
        await Initializellm();
    }

    try {
        logger.debug({ promptLength: promptText.length }, "Sending prompt to Azure OpenAI...");
        
        const response = await azureClient.chat.completions.create({
            model: config.azure.deploymentName,
            messages: [{ role: "user", content: promptText }],
            temperature: options.temperature || 0.3,
            max_tokens: options.maxTokens || 2048
        });

        const result = response.choices[0]?.message?.content || "";
        logger.debug({ responseLength: result.length }, "Received Azure OpenAI response");
        return result;
    } catch (error) {
        // Check for rate limit errors (429)
        if (error.message && error.message.includes('429')) {
            // Extract wait time from error message if available
            const waitMatch = error.message.match(/retry after (\d+) seconds/i);
            const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 60;
            logger.warn({ 
                waitSeconds,
                error: error.message 
            }, "Azure OpenAI rate limit hit, need to wait");
            throw new Error(`RATE_LIMIT:${waitSeconds}:${error.message}`);
        }
        logger.error({ error: error.message }, "Azure OpenAI prompt failed");
        throw error;
    }
}

/**
 * Send a chat message to Azure OpenAI
 * Better for conversational/instruction following
 * @param {string} userMessage - The user message
 * @param {string} systemPrompt - Optional system prompt
 * @returns {Promise<string>} - The LLM response
 */
export async function chat(userMessage, systemPrompt = "") {
    if (!azureClient) {
        await Initializellm();
    }

    const messages = [];
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });

    try {
        const response = await azureClient.chat.completions.create({
            model: config.azure.deploymentName,
            messages: messages,
            temperature: 0.3,
            max_tokens: 2048
        });

        return response.choices[0]?.message?.content || "";
    } catch (error) {
        logger.error({ error: error.message }, "Azure OpenAI chat failed");
        throw error;
    }
}

/**
 * Send a prompt and parse JSON response
 * Azure OpenAI is excellent at structured JSON output
 * @param {string} promptText - The prompt
 * @returns {Promise<Object>} - Parsed JSON response
 */
export async function promptJSON(promptText) {
    // Add JSON instruction for Azure OpenAI with stronger emphasis
    const jsonPrompt = `${promptText}

CRITICAL: You MUST respond with ONLY valid JSON. No markdown code blocks, no explanations, no extra text before or after. Start with { and end with }. Return complete JSON only.`;

    // Use higher max_tokens for JSON responses to avoid truncation
    const response = await prompt(jsonPrompt, { maxTokens: 4096 });

    try {
        // Clean up response
        let jsonStr = response.trim();
        
        // Remove markdown code blocks if present (handle both ```json and ```)
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }
        
        // Remove any leading text before first {
        const firstBrace = jsonStr.indexOf('{');
        if (firstBrace > 0) {
            jsonStr = jsonStr.substring(firstBrace);
        }
        
        // Try to fix incomplete JSON by closing brackets/arrays
        let fixedJsonStr = jsonStr;
        
        // Count open/close braces and brackets
        const openBraces = (jsonStr.match(/\{/g) || []).length;
        const closeBraces = (jsonStr.match(/\}/g) || []).length;
        const openBrackets = (jsonStr.match(/\[/g) || []).length;
        const closeBrackets = (jsonStr.match(/\]/g) || []).length;
        
        // If JSON appears incomplete, try to close it
        if (openBraces > closeBraces) {
            // Find the last incomplete object/array
            let lastOpenIndex = jsonStr.lastIndexOf('{');
            if (lastOpenIndex >= 0) {
                // Try to find if we're in an array context
                const beforeLastOpen = jsonStr.substring(0, lastOpenIndex);
                const openArraysBefore = (beforeLastOpen.match(/\[/g) || []).length;
                const closeArraysBefore = (beforeLastOpen.match(/\]/g) || []).length;
                
                // Close arrays first if needed
                if (openArraysBefore > closeArraysBefore) {
                    fixedJsonStr += ']'.repeat(openArraysBefore - closeArraysBefore);
                }
                // Then close objects
                fixedJsonStr += '}'.repeat(openBraces - closeBraces);
            }
        }
        
        // Try to find JSON object
        const jsonMatch = fixedJsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                // If fixed version fails, try original
                logger.debug({ error: parseError.message }, "Fixed JSON parse failed, trying original");
            }
        }
        
        // Try parsing entire response
        return JSON.parse(fixedJsonStr);
    } catch (error) {
        logger.warn({ 
            response: response.substring(0, 1000),
            error: error.message 
        }, "Failed to parse JSON from Azure OpenAI response");
        throw new Error(`Failed to parse JSON: ${error.message}`);
    }
}

/**
 * Check if Azure OpenAI is available and ready
 */
export function isLlmReady() {
    return isConnected;
}

/**
 * Get LLM status info
 */
export function getLLMStatus() {
    return {
        initialized: isConnected,
        provider: "Azure OpenAI",
        modelName: config.azure.deploymentName,
        endpoint: config.azure.endpoint,
    };
}

/**
 * Create chat session (compatibility function)
 */
export async function createChatSession() {
    if (!isConnected) {
        await Initializellm();
    }
    return { prompt, chat };
}

/**
 * Cleanup
 */
export async function disposeLLM() {
    isConnected = false;
    azureClient = null;
    logger.info("Azure OpenAI service disconnected");
}
