/**
 * @Module LLM Service
 * @Description Connect to Ollama running DeepSeek-R1:7B locally
 * Ollama runs at http://localhost:11434
 */

import logger from "../utils/logger.js";
import config from "../config/index.js";

// Ollama API endpoint
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "deepseek-r1:7b";

// Connection status
let isConnected = false;

/**
 * Initialize/Check Ollama connection
 * Verifies Ollama is running and model is available
 */
export async function Initializellm() {
    try {
        logger.info({ url: OLLAMA_BASE_URL, model: OLLAMA_MODEL }, "Connecting to Ollama...");
        
        // Check if Ollama is running
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        
        if (!response.ok) {
            throw new Error(`Ollama not responding: ${response.status}`);
        }
        
        const data = await response.json();
        const models = data.models || [];
        
        // Check if DeepSeek model is available
        const hasModel = models.some(m => m.name.includes("deepseek-r1"));
        
        if (!hasModel) {
            logger.warn({ availableModels: models.map(m => m.name) }, 
                "DeepSeek-R1 not found. Run: ollama pull deepseek-r1:7b");
        }
        
        isConnected = true;
        logger.info({ 
            model: OLLAMA_MODEL,
            availableModels: models.map(m => m.name).slice(0, 5)
        }, "🧠 Connected to Ollama successfully!");
        
        return { connected: true, model: OLLAMA_MODEL };
        
    } catch (error) {
        isConnected = false;
        logger.error({ error: error.message }, "Failed to connect to Ollama");
        throw new Error(`Ollama connection failed: ${error.message}. Is Ollama running?`);
    }
}

/**
 * Send a prompt to DeepSeek-R1 via Ollama
 * @param {string} promptText - The prompt to send
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - The LLM response
 */
export async function prompt(promptText, options = {}) {
    const requestBody = {
        model: OLLAMA_MODEL,
        prompt: promptText,
        stream: false,
        options: {
            temperature: options.temperature || 0.3,
            num_predict: options.maxTokens || 2048,
        }
    };

    try {
        logger.debug({ promptLength: promptText.length }, "Sending prompt to DeepSeek-R1...");
        
        const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const data = await response.json();
        const result = data.response || "";
        
        logger.debug({ responseLength: result.length }, "Received DeepSeek-R1 response");
        
        return result;
    } catch (error) {
        logger.error({ error: error.message }, "Ollama prompt failed");
        throw error;
    }
}

/**
 * Send a chat message to DeepSeek-R1 via Ollama
 * Better for conversational/instruction following
 * @param {string} userMessage - The user message
 * @param {string} systemPrompt - Optional system prompt
 * @returns {Promise<string>} - The LLM response
 */
export async function chat(userMessage, systemPrompt = "") {
    const messages = [];
    
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });

    const requestBody = {
        model: OLLAMA_MODEL,
        messages: messages,
        stream: false,
        options: {
            temperature: 0.3,
            num_predict: 2048,
        }
    };

    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw new Error(`Ollama chat API error: ${response.status}`);
        }

        const data = await response.json();
        return data.message?.content || "";
    } catch (error) {
        logger.error({ error: error.message }, "Ollama chat failed");
        throw error;
    }
}

/**
 * Send a prompt and parse JSON response
 * DeepSeek-R1 is excellent at structured JSON output
 * @param {string} promptText - The prompt
 * @returns {Promise<Object>} - Parsed JSON response
 */
export async function promptJSON(promptText) {
    // Add JSON instruction for DeepSeek-R1
    const jsonPrompt = `${promptText}

IMPORTANT: Respond ONLY with valid JSON. No explanation, no markdown code blocks, no extra text. Just the raw JSON object.`;

    const response = await prompt(jsonPrompt);

    try {
        // Clean up response
        let jsonStr = response.trim();
        
        // Remove markdown code blocks if present
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }
        
        // Remove <think> tags if DeepSeek includes reasoning
        jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        
        // Try to find JSON object
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        // Try parsing entire response
        return JSON.parse(jsonStr);
    } catch (error) {
        logger.warn({ response: response.substring(0, 500) }, "Failed to parse JSON from DeepSeek response");
        throw new Error(`Failed to parse JSON: ${error.message}`);
    }
}

/**
 * Check if Ollama/LLM is available and ready
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
        provider: "Ollama",
        modelName: OLLAMA_MODEL,
        endpoint: OLLAMA_BASE_URL,
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
 * Cleanup (no-op for Ollama, but kept for API compatibility)
 */
export async function disposeLLM() {
    isConnected = false;
    logger.info("LLM service disconnected");
}
