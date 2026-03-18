/**
 * @Module Schema Optimization Agent
 * @Description AI Agent that suggests performance optimizations, indexing strategies, and best practices
 */

import { AzureChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import logger from "../utils/logger.js";
import config from "../config/index.js";
import { initializeLangChain } from "../llm/azureLangChainService.js";
import { learnOptimization } from "./patternMemory.js";

/**
 * Optimization suggestion schema
 */
function createOptimizationSchema() {
    return z.object({
        optimizations: z.array(z.object({
            table: z.string().describe("Table name"),
            column: z.string().optional().describe("Column name (if applicable)"),
            type: z.enum([
                "index",
                "composite_index",
                "partitioning",
                "normalization",
                "denormalization",
                "data_type_optimization",
                "constraint",
                "default_value",
                "naming_convention"
            ]).describe("Type of optimization"),
            suggestion: z.string().describe("Specific optimization recommendation"),
            impact: z.enum(["high", "medium", "low"]).describe("Expected performance impact"),
            priority: z.number().min(1).max(10).describe("Priority (1=highest, 10=lowest)"),
            reasoning: z.string().describe("Why this optimization helps"),
            sqlExample: z.string().optional().describe("Example SQL if applicable"),
        })),
        summary: z.object({
            totalOptimizations: z.number(),
            highImpact: z.number(),
            mediumImpact: z.number(),
            lowImpact: z.number(),
        }),
    });
}

/**
 * Build optimization context
 */
function buildOptimizationContext(metadata) {
    const tables = {};
    
    // Group by table
    for (const col of metadata) {
        const tableName = col.tableName || "unknown";
        if (!tables[tableName]) {
            tables[tableName] = {
                columns: [],
                primaryKeys: [],
                foreignKeys: [],
                indexes: [],
                rowCount: col._estimatedRows || 0
            };
        }
        
        tables[tableName].columns.push({
            name: col.columnName,
            type: col.dataType,
            isPK: col.isPrimaryKey,
            isFK: col.isForeignKey,
            isUnique: col.isUnique,
            nullable: col.nullable,
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
    
    let context = "DATABASE SCHEMA FOR OPTIMIZATION ANALYSIS:\n\n";
    
    for (const [tableName, tableData] of Object.entries(tables)) {
        context += `TABLE: ${tableName}\n`;
        context += `Estimated Rows: ${tableData.rowCount || "Unknown"}\n`;
        context += `Primary Keys: ${tableData.primaryKeys.join(", ") || "None"}\n`;
        context += `Foreign Keys: ${tableData.foreignKeys.map(fk => fk.column).join(", ") || "None"}\n`;
        context += `Columns:\n`;
        
        for (const col of tableData.columns) {
            context += `  - ${col.name} (${col.type})`;
            if (col.isPK) context += " [PK]";
            if (col.isFK) context += " [FK]";
            if (col.isUnique) context += " [UNIQUE]";
            if (col.nullable === false) context += " [NOT NULL]";
            context += "\n";
        }
        context += "\n";
    }
    
    return context;
}

/**
 * Generate schema optimization suggestions
 */
export async function generateOptimizationSuggestions(metadata) {
    if (!metadata || !Array.isArray(metadata) || metadata.length === 0) {
        logger.warn("No metadata provided for optimization");
        return { optimizations: [], summary: { totalOptimizations: 0, highImpact: 0, mediumImpact: 0, lowImpact: 0 } };
    }
    
    try {
        await initializeLangChain();
        
        const schema = createOptimizationSchema();
        const parser = StructuredOutputParser.fromZodSchema(schema);
        const formatInstructions = parser.getFormatInstructions();
        
        const context = buildOptimizationContext(metadata);
        
        const promptTemplate = PromptTemplate.fromTemplate(`
{context}

TASK: Analyze this database schema and provide performance optimization suggestions.

OPTIMIZATION AREAS TO CONSIDER:

1. INDEXING STRATEGIES:
   - Add indexes on foreign keys (for JOIN performance)
   - Add indexes on frequently queried columns (email, username, status)
   - Create composite indexes for multi-column queries
   - Consider unique indexes for business keys

2. DATA TYPE OPTIMIZATION:
   - Use appropriate integer sizes (INT vs BIGINT)
   - Use VARCHAR with proper length (not VARCHAR(MAX))
   - Use DATE vs DATETIME appropriately
   - Use ENUM for fixed value sets

3. TABLE STRUCTURE:
   - Identify normalization opportunities
   - Identify denormalization opportunities (for read-heavy workloads)
   - Suggest partitioning for large tables
   - Recommend archiving strategies

4. CONSTRAINTS & DEFAULTS:
   - Add NOT NULL constraints where appropriate
   - Add CHECK constraints for data validation
   - Set appropriate default values
   - Add UNIQUE constraints for business keys

5. NAMING CONVENTIONS:
   - Ensure consistent naming
   - Suggest improvements for clarity

6. PERFORMANCE PATTERNS:
   - Identify missing indexes on FK columns
   - Find columns used in WHERE clauses without indexes
   - Suggest covering indexes for common queries
   - Recommend full-text indexes for text search

RETURN:
- Specific, actionable optimization suggestions
- Impact level (high/medium/low)
- Priority (1-10, 1=highest)
- Reasoning and SQL examples where applicable

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
            temperature: 0.3,
            maxTokens: 4096,
            timeout: 60000,
        });
        
        const chain = RunnableSequence.from([
            promptTemplate,
            llmClient,
            parser,
        ]);
        
        logger.info({
            tables: [...new Set(metadata.map(m => m.tableName))].length,
            columns: metadata.length
        }, '⚡ Analyzing schema for optimizations...');
        
        const result = await chain.invoke({
            context: context,
            formatInstructions: formatInstructions,
        });
        
        // Learn from optimizations
        for (const opt of result.optimizations) {
            if (opt.impact === "high" || opt.priority <= 3) {
                learnOptimization(opt.table, opt.column || "", opt.suggestion, opt.impact);
            }
        }
        
        logger.info({
            total: result.summary.totalOptimizations,
            highImpact: result.summary.highImpact,
            mediumImpact: result.summary.mediumImpact,
            lowImpact: result.summary.lowImpact
        }, '✅ Optimization analysis completed');
        
        return result;
        
    } catch (error) {
        logger.error({
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        }, '❌ Optimization analysis failed');
        
        return {
            optimizations: [],
            summary: {
                totalOptimizations: 0,
                highImpact: 0,
                mediumImpact: 0,
                lowImpact: 0
            }
        };
    }
}

/**
 * Apply high-priority optimizations to metadata
 */
export function applyOptimizations(metadata, optimizationResult) {
    if (!optimizationResult || !optimizationResult.optimizations) {
        return metadata;
    }
    
    const enhanced = [...metadata];
    let appliedCount = 0;
    
    // Apply high-priority optimizations
    const highPriority = optimizationResult.optimizations.filter(
        opt => opt.priority <= 3 && opt.type === "index"
    );
    
    for (const opt of highPriority) {
        if (!opt.column || !opt.table) continue;
        
        const colIndex = enhanced.findIndex(
            col => col.tableName === opt.table && col.columnName === opt.column
        );
        
        if (colIndex >= 0) {
            const col = enhanced[colIndex];
            
            // Mark for indexing
            if (!col._shouldIndex) {
                enhanced[colIndex] = {
                    ...col,
                    _shouldIndex: true,
                    _indexReason: opt.reasoning,
                    _indexPriority: opt.priority,
                    _indexImpact: opt.impact
                };
                appliedCount++;
            }
        }
    }
    
    if (appliedCount > 0) {
        logger.info({
            applied: appliedCount,
            total: highPriority.length
        }, '⚡ Applied high-priority optimizations');
    }
    
    return enhanced;
}
