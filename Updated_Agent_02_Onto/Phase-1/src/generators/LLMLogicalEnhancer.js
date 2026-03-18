/**
 * LLM-Enhanced Logical Model Generator (LangChain)
 * Uses LangChain to infer logical model details: relationships, cardinalities, optionality, business rules
 * Ensures logical model follows industry standards (no physical implementation details)
 */

import logger from '../utils/logger.js';
import { callLangChainWithSchema, initializeLangChain, isLangChainReady } from '../llm/azureLangChainService.js';
import { z } from 'zod';

/**
 * Build context prompt for LLM to analyze logical model requirements
 */
function buildLogicalModelPrompt(metadata) {
    let prompt = `Database Schema for Logical Model Enhancement:\n\n`;
    
    const tables = metadata.metadata?.tables || {};
    
    for (const [tableName, tableData] of Object.entries(tables)) {
        prompt += `Entity: ${tableName}\n`;
        prompt += `Description: ${tableData.description || 'N/A'}\n`;
        prompt += `Attributes:\n`;
        
        for (const col of tableData.columns || []) {
            prompt += `  - ${col.columnName}: ${col.dataType || 'TEXT'}`;
            if (col.isPrimaryKey) prompt += ` [PK]`;
            if (col.isForeignKey) prompt += ` [FK → ${col.referencesTable}.${col.referencesColumn}]`;
            if (col.isUnique) prompt += ` [UNIQUE]`;
            if (col.nullable === false) prompt += ` [REQUIRED]`;
            if (col.description) prompt += ` - ${col.description}`;
            prompt += `\n`;
        }
        prompt += `\n`;
    }
    
    return prompt;
}

/**
 * Create Zod schema for logical model enhancement
 */
function createLogicalModelSchema() {
    return z.object({
        entities: z.record(z.string(), z.object({
            description: z.string().describe("Human-readable entity description"),
            attributes: z.record(z.string(), z.object({
                logicalType: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN"]).describe("Logical data type"),
                description: z.string().describe("Human-readable attribute meaning"),
                isPrimaryKey: z.boolean().optional().describe("Is this a primary key"),
                isDerived: z.boolean().optional().describe("Is this a derived/computed attribute"),
                businessRule: z.string().nullable().optional().describe("Business rule description if any"),
            })),
            relationships: z.array(z.object({
                targetEntity: z.string().describe("Related entity name"),
                cardinality: z.enum(["1-N", "N-1", "1-1"]).describe("Relationship cardinality"),
                optionality: z.enum(["mandatory", "optional"]).describe("Is relationship mandatory or optional"),
                relationshipName: z.string().describe("Relationship name (e.g., 'places', 'contains')"),
                description: z.string().describe("Relationship description"),
            })).optional(),
        })),
    });
}

/**
 * Analyze metadata with LangChain to infer logical model details
 */
export async function enhanceLogicalModelWithLLM(metadata) {
    if (!isLangChainReady()) {
        try {
            logger.info("LangChain not ready. Initializing...");
            await initializeLangChain();
        } catch (error) {
            logger.warn({ error: error.message }, "LangChain not available, using heuristics only");
            return metadata; // Return original metadata if LLM fails
        }
    }
    
    const contextPrompt = buildLogicalModelPrompt(metadata);
    
    const promptTemplate = `{context}

TASK: Analyze this database schema and provide LOGICAL DATA MODEL (LDM) details.

CRITICAL RULES FOR LOGICAL MODEL:
- Use LOGICAL types ONLY: TEXT, NUMBER, DATE, BOOLEAN (NOT INT, VARCHAR, DECIMAL)
- NO physical implementation details (no indexes, ON DELETE, AUTO_INCREMENT, defaults)
- Relationships are CONCEPTUAL (not physical FK columns)
- Focus on business meaning, not SQL implementation

For EACH entity (table), determine:

1. ENTITY NAME (clean, business-focused):
   - Use singular form (customer, order, product)
   - Remove technical prefixes/suffixes
   - Use lowercase with underscores if needed

2. ATTRIBUTES (domain-level):
   - Map to logical types: TEXT, NUMBER, DATE, BOOLEAN
   - Remove physical types (INT → NUMBER, VARCHAR → TEXT)
   - Add meaningful descriptions for each attribute
   - Identify derived attributes (computed, not stored)

3. PRIMARY KEYS (conceptual level):
   - Identify primary identifier (usually "id")
   - Mark as primary key at conceptual level

4. RELATIONSHIPS (conceptual, not physical):
   - Identify relationships between entities
   - Determine cardinality:
     * 1-N (one-to-many): customer → order
     * N-1 (many-to-one): order → customer
     * 1-1 (one-to-one): rare, but possible
   - Determine optionality:
     * Mandatory: Order MUST have a customer
     * Optional: Customer MAY have zero orders
   - Add relationship names:
     * "places" (customer places order)
     * "contains" (order contains order_item)
     * "belongs to" (order_item belongs to product)

5. BUSINESS RULES (logical-level constraints):
   - Email must be unique (business rule, not SQL constraint)
   - Quantity must be positive (business rule)
   - Order total = derived value (sum of items, not stored)
   - Product price must be non-negative (business rule)
   - Order date must be <= today (business rule)
   - NO SQL-level constraints (no CHECK, UNIQUE as SQL syntax)

6. ATTRIBUTE DESCRIPTIONS:
   - Each attribute should have human-readable meaning
   - Example: "email = customer contact address"
   - Example: "order_date = date when order was placed"

{formatInstructions}`;

    try {
        logger.info('Sending metadata to LangChain for logical model enhancement...');
        
        const schema = createLogicalModelSchema();
        const result = await callLangChainWithSchema(
            schema,
            promptTemplate,
            { context: contextPrompt },
            { timeout: 45000, maxRetries: 3 }
        );
        
        if (!result || !result.entities) {
            logger.warn('No valid response from LangChain. Using heuristics only.');
            return metadata;
        }
        
        // Merge LLM enhancements into metadata
        return mergeLLMLogicalEnhancements(metadata, result);
        
    } catch (error) {
        logger.warn({ error: error.message }, 'LangChain logical model enhancement failed, using heuristics only');
        return metadata; // Return original metadata if LLM fails
    }
}

/**
 * Merge LLM logical model enhancements into metadata
 */
function mergeLLMLogicalEnhancements(metadata, llmResult) {
    const tables = metadata.metadata?.tables || {};
    
    for (const [entityName, entityEnhancement] of Object.entries(llmResult.entities || {})) {
        // Find matching table (case-insensitive)
        const tableName = Object.keys(tables).find(t => 
            t.toLowerCase() === entityName.toLowerCase()
        );
        
        if (!tableName) continue;
        
        const table = tables[tableName];
        
        // Update entity description
        if (entityEnhancement.description) {
            table.description = entityEnhancement.description;
        }
        
        // Update attributes
        for (const col of table.columns || []) {
            const attrEnhancement = entityEnhancement.attributes?.[col.columnName];
            if (!attrEnhancement) continue;
            
            // Apply LLM enhancements
            if (attrEnhancement.logicalType) {
                col._llmLogicalType = attrEnhancement.logicalType;
            }
            
            if (attrEnhancement.description) {
                col._llmDescription = attrEnhancement.description;
            }
            
            if (attrEnhancement.isDerived !== undefined) {
                col._llmIsDerived = attrEnhancement.isDerived;
            }
            
            if (attrEnhancement.businessRule) {
                col._llmBusinessRule = attrEnhancement.businessRule;
            }
            
            col._llmEnhanced = true;
        }
        
        // Store relationships
        if (entityEnhancement.relationships) {
            table._llmRelationships = entityEnhancement.relationships;
        }
    }
    
    logger.info({ 
        enhancedEntities: Object.keys(llmResult.entities || {}).length 
    }, 'LLM logical model enhancements applied');
    
    return metadata;
}

