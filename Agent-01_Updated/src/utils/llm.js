/**
 * LLM client - Azure OpenAI only (Full Ontology - aligned with Agent-02)
 */

import { OpenAI } from 'openai';
import { logger } from './logger.js';
import config from '../config/index.js';

let azureClient = null;

function getAzureClient() {
  if (!azureClient) {
    if (!config.azure?.apiKey || !config.azure?.endpoint) {
      throw new Error(
        'Azure OpenAI not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT in .env'
      );
    }

    logger.info({
      endpoint: config.azure.endpoint,
      deployment: config.azure.deploymentName,
    }, 'Initializing Azure OpenAI client');

    azureClient = new OpenAI({
      apiKey: config.azure.apiKey,
      baseURL: `${config.azure.endpoint}/openai/deployments/${config.azure.deploymentName}`,
      defaultQuery: { 'api-version': config.azure.apiVersion },
      defaultHeaders: { 'api-key': config.azure.apiKey },
    });
  }
  return azureClient;
}

/**
 * Call Azure OpenAI (ChatGPT)
 * @param {string} prompt - User prompt
 * @param {string} systemPrompt - Optional system prompt
 * @param {object} options - temperature, maxTokens
 * @returns {Promise<string>} - LLM response
 */
export async function callLLM(prompt, systemPrompt = null, options = {}) {
  const client = getAzureClient();
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    logger.info({
      promptLength: prompt.length,
      deployment: config.azure.deploymentName,
    }, 'Calling Azure OpenAI');

    const response = await client.chat.completions.create({
      model: config.azure.deploymentName,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4096,
    });

    const content = (response.choices[0]?.message?.content || '').trim();
    logger.debug({ responseLength: content.length }, 'Azure OpenAI response received');
    return content;
  } catch (error) {
    if (error.message?.includes('429')) {
      const waitMatch = error.message.match(/retry after (\d+) seconds/i);
      const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 60;
      logger.warn({ waitSeconds, error: error.message }, 'Azure OpenAI rate limit');
      throw new Error(`RATE_LIMIT:${waitSeconds}:${error.message}`);
    }
    logger.error({ error: error.message }, 'Azure OpenAI request failed');
    throw error;
  }
}

/**
 * Extract JSON from LLM response (handles markdown code blocks, etc.)
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid input: text must be a string');
  }

  let cleanedText = text.trim();

  // Method 1: Extract from markdown code blocks (```json ... ```)
  const codeBlockPatterns = [
    /```json\s*([\s\S]*?)\s*```/i,
    /```\s*([\s\S]*?)\s*```/,
  ];

  for (const pattern of codeBlockPatterns) {
    const match = cleanedText.match(pattern);
    if (match && match[1]) {
      try {
        const jsonText = match[1].trim();
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // Continue to next method
      }
    }
  }

  // Method 2: Find JSON object directly
  cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '');
  cleanedText = cleanedText.replace(/\s*```$/i, '');
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      let jsonStr = jsonMatch[0].replace(/,(\s*[}\]])/g, '$1');
      try {
        return JSON.parse(jsonStr);
      } catch (e2) {
        // Fall through
      }
    }
  }

  // Method 3: Try parsing the whole cleaned text
  try {
    return JSON.parse(cleanedText);
  } catch (e) {
    // Method 4: Extract and fix incomplete JSON
    const firstBrace = cleanedText.indexOf('{');
    if (firstBrace !== -1) {
      let braceCount = 0;
      let jsonEnd = firstBrace;
      for (let i = firstBrace; i < cleanedText.length; i++) {
        if (cleanedText[i] === '{') braceCount++;
        if (cleanedText[i] === '}') braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
      if (braceCount === 0) {
        try {
          const extractedJson = cleanedText.substring(firstBrace, jsonEnd).replace(/,(\s*[}\]])/g, '$1');
          return JSON.parse(extractedJson);
        } catch (e2) {
          // Give up
        }
      }
    }
    throw new Error(`Failed to extract JSON from LLM response: ${e.message}. Response preview: ${text.substring(0, 500)}`);
  }
}

/**
 * Extract Cypher from LLM response (removes markdown, explanations, etc.)
 */
export function extractCypher(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cypher = text.replace(/```(?:cypher)?\s*/g, '').replace(/```/g, '').trim();
  cypher = cypher.replace(/-&gt;/g, '->');
  cypher = cypher.replace(/-&lt;/g, '<-');
  cypher = cypher.replace(/&gt;/g, '>');
  cypher = cypher.replace(/&lt;/g, '<');
  cypher = cypher.replace(/^(Here's|Here is|The cypher|Cypher query|Query):\s*/i, '');
  cypher = cypher.replace(/\s*(This query|The query|This cypher).*$/is, '');

  const lines = cypher.split('\n');
  const cypherLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('--')) return false;
    return /^\s*(MERGE|CREATE|MATCH|SET|RETURN|WITH|WHERE|UNWIND|FOREACH)/i.test(trimmed) ||
           trimmed.includes('(') || trimmed.includes('[') || trimmed.includes('{');
  });

  const extracted = cypherLines.join('\n').trim();
  if (!extracted && cypher.length > 0 && cypher.length < 10000) {
    return cypher;
  }
  return extracted;
}
