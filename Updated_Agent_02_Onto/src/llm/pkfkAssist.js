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
    //we will be making the prompt for the llm to understand the data model..!
    //so here we will be describing the all tables and columns to the llm..!

    //group the table..!
    const tables = {};
    for (const col of metadata) {
        //as metadata is the array of columns and we have to group the columns by the table..!
        //we are getting the tableName from the each col in the array of columns..!
        const tableName = col.tableName || col.table_name || "unknown";
        if (!tables[tableName]) {
            tables[tableName] = [];//empty array..!
        };
        //if not present we can push it and save it in the object..!
        tables[tableName].push(col);
    };
    //build the description..!
    let context = 'DATABASE-SCHEMA:\n\n' //the string with the new-Line Character..!
    for (const [tableName, columns] of Object.entries(tables)) {
        //means we are iteration over the tableName and columns...!
        context += ` Table: ${tableName}\n`;
        context += `Columns:\n`;
        //that was for the table now we can iterate for the column
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
 * Analyze metadata using LLM for PK/FK inference
 * @param {Array} metadata - Parsed metadata from files
 * @returns {Promise<Array>} - Enhanced metadata with AI analysis
 */

export async function analyzeMetadata(metadata) {
    //check if llm is ready..!
    /**
     * @description first we have to check the llm is available or not..!
     */
    if (!isLlmReady()) {
        try {
            logger.info("LLM not ready. Initializing...");
            await Initializellm();
            logger.info("LLM initialized successfully..!");
        } catch (error) {
            logger.error({ error }, "Failed to initialize LLM..!");
            throw new Error(`Failed to initialize LLM: ${error.message}`);
        }
    }
    const contextPrompt = buildContexPrompt(metadata);//describe the data model to the llm..!
    const analysisPrompt = `Analysis of ${contextPrompt};

    //we will send the prompt..!
    TASK: Analyze this database schema and identify Primary Keys and Foreign Keys.

For each column, determine:
1. Is it a Primary Key? (unique identifier for the table)
2. Is it a Foreign Key? (references another table)
3. If FK, which table and column does it reference?
4. Confidence score (0.0 to 1.0)
5. Brief rationale for your decision

Consider these patterns:
- Primary Keys: Usually named 'id', '{table}_id', '{table}Id', 'pk_{table}'
- Foreign Keys: Usually named '{other_table}_id', 'fk_{table}', or reference another table
- Self-references: A column might reference the same table (e.g., manager_id → employee.id)
- Composite keys: Multiple columns might form a primary key together
${getSchemaPrompt(batchColumnSchema)}`;

    try {
        logger.info('Sending MetaData to LLM for Analysis..!');
        const result = await promptJSON(analysisPrompt);//extract the json from the response..!
        if (!result || !result.columns) {
            logger.warn('No valid JSON response from LLM. Returning original metadata..!');
            return metadata;
        }
        //Merge LLM result with Original MetaData..!
        return mergeLLMResult(metadata, result)
    } catch (error) {
        logger.info({
            error: error.message,
        }, 'LLM Analysis Failed..!');
        throw new Error(`LLM Analysis Failed: ${error.message}`);
    }


}
/**
 * Merge LLM analysis results with original metadata
 * @param {Array} metadata - Original metadata array
 * @param {Object} llmResult - LLM analysis result
 * @returns {Array} - Enhanced metadata with LLM analysis
 */
function mergeLLMResult(metadata, llmResult) {
    const enhanced = [...metadata];
    
    for (const col of enhanced) {
        // Find matching LLM result
        const llmCol = llmResult.columns.find(
            c => c.columnName === col.columnName && c.tableName === col.tableName
        );

        if (llmCol) {
            // Add LLM analysis
            col._llmAnalysis = {
                isPrimaryKey: llmCol.isPrimaryKey,
                pkConfidence: llmCol.pkConfidence || 0,
                pkRationale: llmCol.pkRationale || "",
                isForeignKey: llmCol.isForeignKey,
                fkConfidence: llmCol.fkConfidence || 0,
                referencesTable: llmCol.referenceTable || null,
                referencesColumn: llmCol.referencesColumn || null,
                fkRationale: llmCol.fkRationals || "",
            };

            // Compare confidence with heuristics (assume 0.7 for heuristics)
            const heuristicPKConfidence = col.isPrimaryKey ? 0.7 : 0;
            const heuristicFKConfidence = col.isForeignKey ? 0.7 : 0;

            // Use LLM result if higher confidence
            if ((llmCol.pkConfidence || 0) > heuristicPKConfidence) {
                col.isPrimaryKey = llmCol.isPrimaryKey;
                col._pkSource = "llm_enhanced";
                col._pkConfidence = llmCol.pkConfidence;
                col._pkRationale = llmCol.pkRationale;
            }

            if ((llmCol.fkConfidence || 0) > heuristicFKConfidence) {
                col.isForeignKey = llmCol.isForeignKey;
                col._fkSource = "llm_enhanced";
                col._fkConfidence = llmCol.fkConfidence;
                col._fkRationale = llmCol.fkRationals;
                if (llmCol.referenceTable) {
                    col.referencesTable = llmCol.referenceTable;
                    col.referencesColumn = llmCol.referencesColumn;
                }
            }
        }
    }

    // Add overall analysis if present
    if (llmResult.overallAnalysis) {
        enhanced._overallAnalysis = llmResult.overallAnalysis;
    }

    return enhanced;
}

/**
 * Analyze a single column with LLM (for real-time queries)
 */
export async function analyzeColumnWithLLM(column, allTables) {
    //so here we will be analyzing the single column with the llm..!
    if (!isLlmReady()) {
        return { error: "LLM not ready. Please initialize the LLM..!" }
    }
    const prompt = `Analyze This Database-Column..:
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
        logger.error({ error: error.message }, "Failed to analyze column with LLM..!");
        return { error: `Failed to analyze column with LLM: ${error.message}` }
    } finally {
        logger.info("Column analysis completed..!");
    }
}

/**
 * Get relationship suggestions from LLM
 */
export async function suggestionRelelationships(metadata) {
    if (!isLlmReady()) {
        return { error: "LLM not ready. Please initialize the LLM..!" }
    }
    //if ready ..!
    const context = buildContexPrompt(metadata);
    /**
     * we will run the batch with the metaData and try send it to llm for any suggestion..!
     */
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
    //so after we can extract the json from the response..!
    try {
        return await promptJSON(prompt);
    } catch (error) {
        logger.error({ error: error.message }, "Relationship suggestion failed");
        return { error: error.message, suggestions: [] };
    }
}