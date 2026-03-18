/**
 * @Module PK/FK AI Assist
 * @Description AI-powered Primary Key and Foreign Key analysis
 * Uses local LLM to provide intelligent inference with confidence and rationale
 */

import { promptJSON, isLlmReady, Initializellm } from "./llmService.js";
import { getSchemaPrompt, batchColumnSchema } from "./schema.js";
import logger from "../utils/logger.js";

/**
 * Build context prompt from metadata
 * Describes all tables and columns to the LLM
 */
function buildContexPrompt(metadata) {
    const tables = {};
    for (const col of metadata) {
        const tableName = col.tableName || col.table_name || "unknown";
        if (!tables[tableName]) {
            tables[tableName] = [];
        }
        tables[tableName].push(col);
    }
    
    let context = 'DATABASE-SCHEMA:\n\n';
    for (const [tableName, columns] of Object.entries(tables)) {
        context += `Table: ${tableName}\n`;
        context += `Columns:\n`;
        for (const col of columns) {
            context += `-${col.columnName} (${col.dataType || "unknown"})`;
            if (col.description) context += ` - ${col.description}`;
            if (col.isPrimaryKey) context += ` [Current: PK]`;
            if (col.isForeignKey) context += ` [Current: FK → ${col.referencesTable || '?'}]`;
            context += `\n`;
        }
        context += `\n`;
    }
    
    return context;
}

/**
 * Analyze metadata with LLM to enhance PK/FK detection
 */
export async function analyzeMetadata(metadata) {
    if (!isLlmReady()) {
        return { error: "LLM not ready. Please initialize the LLM..!" };
    }
    
    const context = buildContexPrompt(metadata);
    const prompt = `${context}
    
Analyze this database schema and identify or confirm:
1. Primary Keys
2. Foreign Keys
3. Missing relationships

For each column, provide confidence scores and rationale.`;
    
    try {
        const llmResult = await promptJSON(prompt);
        logger.info("Metadata analysis completed");
        return llmResult;
    } catch (error) {
        logger.error({ error: error.message }, "Failed to analyze metadata with LLM");
        return { error: `Failed to analyze metadata: ${error.message}` };
    }
}

/**
 * Analyze a single column with LLM (for real-time queries)
 */
export async function analyzeColumnWithLLM(column, allTables) {
    if (!isLlmReady()) {
        return { error: "LLM not ready. Please initialize the LLM..!" };
    }
    
    const prompt = `Analyze This Database-Column:
Table: ${column.tableName}
Column: ${column.columnName}
Data Type: ${column.dataType || 'unknown'}
Description: ${column.description || 'none'}

Available tables in schema: ${allTables.join(", ")}

Is this column:
1. A Primary Key? (confidence 0-1 and why)
2. A Foreign Key? (confidence 0-1, references which table/column, and why)

Respond in JSON format:
{
  "isPrimaryKey": boolean,
  "pkConfidence": number,
  "pkRationale": "string",
  "isForeignKey": boolean,
  "fkConfidence": number,
  "referencesTable": "string or null",
  "referencesColumn": "string or null",
  "fkRationale": "string"
}`;
    
    try {
        return await promptJSON(prompt);
    } catch (error) {
        logger.error({ error: error.message }, "Failed to analyze column with LLM");
        return { error: `Failed to analyze column with LLM: ${error.message}` };
    }
}

/**
 * Get relationship suggestions from LLM
 */
export async function suggestionRelelationships(metadata) {
    if (!isLlmReady()) {
        return { error: "LLM not ready. Please initialize the LLM..!" };
    }
    
    const context = buildContexPrompt(metadata);
    const prompt = `${context}
    
Based on this schema, suggest any MISSING relationships (foreign keys) that should exist but aren't defined.

Look for:
1. Columns that follow FK naming patterns but aren't marked as FK
2. Potential self-references (e.g., parent_id, manager_id)
3. Junction/bridge tables for many-to-many relationships
4. Common relationship patterns (user→orders, product→category, etc.)

Respond in JSON:
{
  "suggestions": [
    {
      "fromTable": "string",
      "fromColumn": "string",
      "toTable": "string",
      "toColumn": "string",
      "confidence": number,
      "rationale": "string"
    }
  ]
}`;
    
    try {
        return await promptJSON(prompt);
    } catch (error) {
        logger.error({ error: error.message }, "Relationship suggestion failed");
        return { error: error.message, suggestions: [] };
    }
}

export { buildContexPrompt };