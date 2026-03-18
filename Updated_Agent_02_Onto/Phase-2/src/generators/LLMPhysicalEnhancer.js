/**
 * LLM-Enhanced Physical Model Generator (LangChain)
 * Uses LangChain to infer exact SQL types, constraints, defaults, and business rules
 */

import logger from '../utils/logger.js';
import { callLangChainWithSchema, initializeLangChain, isLangChainReady } from '../../../Phase-1/src/llm/azureLangChainService.js';
import { z } from 'zod';

/**
 * Build context prompt for LLM to analyze physical model requirements
 */
function buildPhysicalModelPrompt(metadata) {
    let prompt = `Database Schema for Physical Model Enhancement:\n\n`;
    
    const tablesArray = Array.from(metadata.tables.values());
    
    for (const table of tablesArray) {
        prompt += `Table: ${table.name}\n`;
        prompt += `Description: ${table.description || 'N/A'}\n`;
        prompt += `Columns:\n`;
        
        for (const col of table.columns) {
            prompt += `  - ${col.name}: ${col.dataType || 'VARCHAR'}`;
            if (col.isPrimaryKey) prompt += ` [PK]`;
            if (col.isForeignKey) prompt += ` [FK → ${col.referencesTable}.${col.referencesColumn}]`;
            if (col.isUnique) prompt += ` [UNIQUE]`;
            if (col.isNullable === false) prompt += ` [NOT NULL]`;
            if (col.description) prompt += ` - ${col.description}`;
            prompt += `\n`;
        }
        prompt += `\n`;
    }
    
    return prompt;
}

/**
 * Create Zod schema for physical model enhancement
 */
function createPhysicalModelSchema() {
    return z.object({
        tables: z.record(z.string(), z.object({
            columns: z.record(z.string(), z.object({
                exactType: z.string().describe("Exact SQL data type with precision (e.g., VARCHAR(255), INT)"),
                nullable: z.boolean().describe("Whether column allows NULL values"),
                unique: z.boolean().optional().describe("Whether column has UNIQUE constraint"),
                default: z.string().nullable().optional().describe("Default value (e.g., 'CURRENT_TIMESTAMP', 'active')"),
                checkConstraint: z.string().nullable().optional().describe("CHECK constraint expression (without CHECK keyword)"),
                autoIncrement: z.boolean().optional().describe("Whether column has AUTO_INCREMENT"),
                cleanName: z.string().optional().describe("Cleaned column name (remove leading underscores)"),
            })),
        })),
    });
}

/**
 * Analyze metadata with LangChain to infer physical model details
 */
export async function enhancePhysicalModelWithLLM(metadata) {
    if (!isLangChainReady()) {
        try {
            logger.info("LangChain not ready. Initializing...");
            await initializeLangChain();
        } catch (error) {
            logger.warn({ error: error.message }, "LangChain not available, using heuristics only");
            return metadata; // Return original metadata if LLM fails
        }
    }
    
    const contextPrompt = buildPhysicalModelPrompt(metadata);
    
    const promptTemplate = `{context}

TASK: Analyze this database schema and provide EXACT physical SQL implementation details.

CRITICAL RULES:
- Use MySQL syntax ONLY
- Use INT (not INTEGER) for integer types
- AUTO_INCREMENT is separate from type definition
- DEFAULT CURRENT_TIMESTAMP only for TIMESTAMP/DATETIME types, NOT for INT
- CHECK constraints must be valid SQL expressions

For EACH column in EACH table, determine:

1. EXACT SQL DATA TYPE with precision (MySQL syntax):
   - VARCHAR(255) not VARCHAR
   - DECIMAL(10,2) not DECIMAL
   - INT (not INTEGER) for integers
   - INT for integer PKs (AUTO_INCREMENT added separately)
   - TIMESTAMP for created_at/updated_at
   - Use appropriate precision based on business context

2. NULL/NOT NULL constraints:
   - Specify nullable: false for required fields (NOT NULL)
   - Specify nullable: true for optional fields (NULL)
   - PKs are ALWAYS NOT NULL (nullable: false)
   - FKs are USUALLY NOT NULL in physical models (nullable: false)
   - Only make FK nullable if it's truly optional (e.g., optional relationship)

3. UNIQUE constraints:
   - Email, username, code fields should be unique: true
   - Specify unique: true for columns that must be unique

4. DEFAULT values (ONLY valid defaults):
   - created_at/updated_at (TIMESTAMP) → "CURRENT_TIMESTAMP"
   - order_date (DATE) → "CURRENT_DATE"
   - status (VARCHAR) → "'active'" (with quotes for strings)
   - boolean fields → "FALSE" or "TRUE" (no quotes)
   - numeric fields → "0" (no quotes) if appropriate
   - DO NOT add CURRENT_TIMESTAMP to INT/INTEGER types
   - Foreign key columns should NOT have defaults

5. CHECK constraints (valid SQL expressions only):
   - price/amount/cost → "column >= 0" (expression only, no CHECK keyword)
   - quantity → "quantity > 0"
   - email → "email LIKE '%@%.%'"
   - percentage → "percentage >= 0 AND percentage <= 100"
   - age → "age >= 0 AND age <= 150"
   - Return ONLY the expression, NOT "CHECK (...)" wrapper

6. AUTO_INCREMENT:
   - Integer primary keys → autoIncrement: true
   - This is separate from the type definition

7. Column naming:
   - Remove leading underscores (_customer_id → customer_id)
   - Use standard SQL naming conventions

{formatInstructions}`;

    try {
        logger.info('Sending metadata to LangChain for physical model enhancement...');
        
        const schema = createPhysicalModelSchema();
        const result = await callLangChainWithSchema(
            schema,
            promptTemplate,
            { context: contextPrompt },
            { timeout: 45000, maxRetries: 3 }
        );
        
        if (!result || !result.tables) {
            logger.warn('No valid response from LangChain. Using heuristics only.');
            return metadata;
        }
        
        // Merge LLM enhancements into metadata
        return mergeLLMPhysicalEnhancements(metadata, result);
        
    } catch (error) {
        logger.warn({ error: error.message }, 'LangChain physical model enhancement failed, using heuristics only');
        return metadata; // Return original metadata if LLM fails
    }
}

/**
 * Merge LLM physical model enhancements into metadata
 */
function mergeLLMPhysicalEnhancements(metadata, llmResult) {
    const tablesArray = Array.from(metadata.tables.values());
    
    for (const table of tablesArray) {
        const tableEnhancement = llmResult.tables?.[table.name];
        if (!tableEnhancement) continue;
        
        for (const col of table.columns) {
            const colEnhancement = tableEnhancement.columns?.[col.name];
            if (!colEnhancement) continue;
            
            // Apply LLM enhancements
            if (colEnhancement.exactType) {
                col._llmExactType = colEnhancement.exactType;
            }
            
            if (colEnhancement.nullable !== undefined) {
                col.isNullable = colEnhancement.nullable;
            }
            
            if (colEnhancement.unique !== undefined) {
                // Only apply UNIQUE if it's not a foreign key (FKs should not be unique unless explicitly needed)
                if (!col.isForeignKey || colEnhancement.unique === false) {
                    col.isUnique = colEnhancement.unique;
                } else {
                    col.isUnique = false; // Override: FKs should not be unique by default
                }
            }
            
            if (colEnhancement.default !== undefined) {
                col.defaultValue = colEnhancement.default;
            }
            
            if (colEnhancement.checkConstraint) {
                col._llmCheckConstraint = colEnhancement.checkConstraint;
            }
            
            if (colEnhancement.autoIncrement !== undefined && colEnhancement.autoIncrement) {
                col._llmAutoIncrement = true;
            }
            
            if (colEnhancement.cleanName) {
                col._llmCleanName = colEnhancement.cleanName;
            }
            
            col._llmEnhanced = true;
        }
    }
    
    logger.info({ 
        enhancedTables: Object.keys(llmResult.tables || {}).length 
    }, 'LLM physical model enhancements applied');
    
    return metadata;
}

