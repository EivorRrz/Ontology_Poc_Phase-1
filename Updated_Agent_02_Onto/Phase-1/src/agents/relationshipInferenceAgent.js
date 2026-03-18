/**
 * @Module Cross-Table Relationship Inference Agent
 * @Description AI Agent that analyzes ALL tables together to find missing foreign keys and relationships
 */

import { AzureChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import logger from "../utils/logger.js";
import config from "../config/index.js";
import { initializeLangChain } from "../llm/azureLangChainService.js";

/**
 * Relationship inference schema
 */
function createRelationshipSchema() {
    return z.object({
        relationships: z.array(z.object({
            fromTable: z.string().describe("Source table name"),
            fromColumn: z.string().describe("Source column name"),
            toTable: z.string().describe("Target table name"),
            toColumn: z.string().describe("Target column name"),
            relationshipType: z.enum(["one-to-many", "many-to-one", "many-to-many", "one-to-one"]).describe("Relationship cardinality"),
            confidence: z.number().min(0).max(1).describe("Confidence score"),
            reasoning: z.string().describe("Why this relationship exists"),
            isMissing: z.boolean().describe("True if this FK was not in original metadata"),
        })),
        manyToManyJunctions: z.array(z.object({
            junctionTable: z.string().describe("Junction table name"),
            table1: z.string().describe("First table"),
            table2: z.string().describe("Second table"),
            confidence: z.number().min(0).max(1),
            reasoning: z.string(),
        })).optional(),
        selfReferences: z.array(z.object({
            table: z.string(),
            column: z.string(),
            referencesColumn: z.string(),
            relationshipType: z.string(),
            confidence: z.number().min(0).max(1),
            reasoning: z.string(),
        })).optional(),
        summary: z.object({
            totalRelationships: z.number(),
            missingFKs: z.number(),
            manyToMany: z.number(),
            selfReferences: z.number(),
        }),
    });
}

/**
 * Build context from all tables
 */
function buildRelationshipContext(metadata) {
    const tables = {};
    
    // Group by table
    for (const col of metadata) {
        const tableName = col.tableName || "unknown";
        if (!tables[tableName]) {
            tables[tableName] = {
                columns: [],
                primaryKeys: [],
                foreignKeys: []
            };
        }
        
        tables[tableName].columns.push({
            name: col.columnName,
            type: col.dataType,
            isPK: col.isPrimaryKey,
            isFK: col.isForeignKey,
            referencesTable: col.referencesTable,
            referencesColumn: col.referencesColumn,
            description: col.description
        });
        
        if (col.isPrimaryKey) {
            tables[tableName].primaryKeys.push(col.columnName);
        }
        
        if (col.isForeignKey) {
            tables[tableName].foreignKeys.push({
                column: col.columnName,
                references: `${col.referencesTable}.${col.referencesColumn}`
            });
        }
    }
    
    let context = "COMPLETE DATABASE SCHEMA FOR RELATIONSHIP ANALYSIS:\n\n";
    
    for (const [tableName, tableData] of Object.entries(tables)) {
        context += `TABLE: ${tableName}\n`;
        context += `Primary Keys: ${tableData.primaryKeys.join(", ") || "None"}\n`;
        context += `Foreign Keys: ${tableData.foreignKeys.map(fk => `${fk.column} → ${fk.references}`).join(", ") || "None"}\n`;
        context += `Columns:\n`;
        
        for (const col of tableData.columns) {
            context += `  - ${col.name} (${col.type})`;
            if (col.isPK) context += " [PK]";
            if (col.isFK) context += ` [FK → ${col.referencesTable}.${col.referencesColumn}]`;
            if (col.description) context += ` - ${col.description}`;
            context += "\n";
        }
        context += "\n";
    }
    
    return context;
}

/**
 * Infer cross-table relationships using AI
 */
export async function inferCrossTableRelationships(metadata) {
    if (!metadata || !Array.isArray(metadata) || metadata.length === 0) {
        logger.warn("No metadata provided for relationship inference");
        return { relationships: [], summary: { totalRelationships: 0, missingFKs: 0 } };
    }
    
    try {
        await initializeLangChain();
        
        const schema = createRelationshipSchema();
        const parser = StructuredOutputParser.fromZodSchema(schema);
        const formatInstructions = parser.getFormatInstructions();
        
        const context = buildRelationshipContext(metadata);
        
        const promptTemplate = PromptTemplate.fromTemplate(`
{context}

TASK: Analyze this COMPLETE database schema and identify ALL relationships between tables.

CRITICAL: You must analyze ALL tables together to find:
1. MISSING FOREIGN KEYS: Columns that reference other tables but aren't marked as FK
2. MANY-TO-MANY relationships: Need junction tables
3. SELF-REFERENCES: Tables that reference themselves (e.g., manager_id → employee.id)
4. IMPLICIT relationships: Based on naming patterns and business logic

ANALYSIS RULES:
- Look for naming patterns: *_id columns often reference other tables
- Match column names to table names: "customer_id" likely references "customer.id"
- Identify missing relationships that should exist
- Find many-to-many patterns (e.g., user ↔ role needs user_role junction)
- Detect self-references (e.g., employee.manager_id → employee.id)
- Consider business logic: orders must have customers, order_items must have orders

RETURN:
- All relationships (including missing ones)
- Confidence scores (0-1)
- Reasoning for each relationship
- Mark which FKs were missing in original metadata

{formatInstructions}
        `);
        
        const azureConfig = config.azure;
        const endpointUrl = new URL(azureConfig.endpoint);
        const instanceName = endpointUrl.hostname.split('.')[0];
        
        const llmClient = new AzureChatOpenAI({
            azureOpenAIApiKey: azureConfig.apiKey,
            azureOpenAIApiInstanceName: instanceName,
            azureOpenAIApiDeploymentName: azureConfig.deploymentName,
            azureOpenAIApiVersion: azureConfig.apiVersion,
            temperature: 0.2, // Lower temperature for more consistent relationship detection
            maxTokens: 4096,
            timeout: 60000, // 60 seconds for complex analysis
        });
        
        const chain = RunnableSequence.from([
            promptTemplate,
            llmClient,
            parser,
        ]);
        
        logger.info({
            tables: [...new Set(metadata.map(m => m.tableName))].length,
            columns: metadata.length
        }, '🔗 Analyzing cross-table relationships...');
        
        const result = await chain.invoke({
            context: context,
            formatInstructions: formatInstructions,
        });
        
        logger.info({
            totalRelationships: result.summary.totalRelationships,
            missingFKs: result.summary.missingFKs,
            manyToMany: result.summary.manyToMany || 0,
            selfReferences: result.summary.selfReferences || 0
        }, '✅ Relationship inference completed');
        
        return result;
        
    } catch (error) {
        logger.error({
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        }, '❌ Relationship inference failed');
        
        return {
            relationships: [],
            summary: {
                totalRelationships: 0,
                missingFKs: 0,
                manyToMany: 0,
                selfReferences: 0
            }
        };
    }
}

/**
 * Apply inferred relationships to metadata
 */
export function applyInferredRelationships(metadata, relationshipResult) {
    if (!relationshipResult || !relationshipResult.relationships) {
        return metadata;
    }
    
    const enhanced = [...metadata];
    const minConfidence = 0.7;
    let appliedCount = 0;
    
    for (const rel of relationshipResult.relationships) {
        if (rel.confidence < minConfidence || !rel.isMissing) {
            continue;
        }
        
        // Find the column in metadata
        const colIndex = enhanced.findIndex(
            col => col.tableName === rel.fromTable && col.columnName === rel.fromColumn
        );
        
        if (colIndex >= 0) {
            const col = enhanced[colIndex];
            
            // Apply missing FK
            if (!col.isForeignKey) {
                enhanced[colIndex] = {
                    ...col,
                    isForeignKey: true,
                    referencesTable: rel.toTable,
                    referencesColumn: rel.toColumn,
                    _fkSource: 'relationship_inference',
                    _fkConfidence: rel.confidence,
                    _fkReasoning: rel.reasoning,
                    _fkInferred: true
                };
                appliedCount++;
            }
        }
    }
    
    if (appliedCount > 0) {
        logger.info({
            applied: appliedCount,
            total: relationshipResult.relationships.length
        }, '🔗 Applied inferred relationships to metadata');
    }
    
    return enhanced;
}
