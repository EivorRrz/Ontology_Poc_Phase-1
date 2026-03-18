/**
 * @Module Production-Ready Metadata Enhancer
 * @Description Comprehensive LLM-powered metadata quality improvement
 * Enhances: data types, column names, descriptions, validation, and overall quality
 */

import { promptJSON, isLlmReady, Initializellm } from "./llmService.js";
import logger from "../utils/logger.js";
import config from "../config/index.js";

// Configuration from environment/config
const ENHANCEMENT_CONFIG = config.llm.metadataEnhancement || {};
const BATCH_SIZE = ENHANCEMENT_CONFIG.batchSize || 50;
const MAX_RETRIES = ENHANCEMENT_CONFIG.maxRetries || 3;
const RETRY_DELAY = ENHANCEMENT_CONFIG.retryDelay || 1000; // ms
const TIMEOUT = ENHANCEMENT_CONFIG.timeout || 30000; // 30 seconds
const MIN_CONFIDENCE = ENHANCEMENT_CONFIG.minConfidence || 0.7;

/**
 * Comprehensive metadata enhancement schema
 */
const metadataEnhancementSchema = {
    type: "object",
    properties: {
        columns: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    columnName: { type: "string", description: "Original column name" },
                    tableName: { type: "string", description: "Table name" },
                    // Enhanced fields
                    normalizedColumnName: { 
                        type: "string", 
                        description: "Cleaned and normalized column name (remove quotes, special chars)" 
                    },
                    correctedDataType: { 
                        type: "string", 
                        description: "Corrected data type based on column name and context (VARCHAR, INTEGER, DECIMAL, TIMESTAMP, BOOLEAN, etc.)" 
                    },
                    dataTypeConfidence: { 
                        type: "number", 
                        minimum: 0, 
                        maximum: 1,
                        description: "Confidence in data type correction (0-1)" 
                    },
                    enhancedDescription: { 
                        type: "string", 
                        description: "Improved, professional description (null if original is good)" 
                    },
                    descriptionQuality: { 
                        type: "string", 
                        enum: ["excellent", "good", "needs_improvement", "missing"],
                        description: "Quality assessment of description" 
                    },
                    // PK/FK analysis
                    isPrimaryKey: { type: "boolean" },
                    pkConfidence: { type: "number", minimum: 0, maximum: 1 },
                    isForeignKey: { type: "boolean" },
                    fkConfidence: { type: "number", minimum: 0, maximum: 1 },
                    referenceTable: { type: "string" },
                    referencesColumn: { type: "string" },
                    // Quality flags
                    issues: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of issues found (e.g., 'incorrect_data_type', 'malformed_name', 'missing_description')"
                    },
                    suggestions: {
                        type: "array",
                        items: { type: "string" },
                        description: "Improvement suggestions"
                    }
                },
                required: ["columnName", "tableName", "normalizedColumnName", "correctedDataType"]
            }
        },
        overallQuality: {
            type: "object",
            properties: {
                score: { type: "number", minimum: 0, maximum: 1 },
                issuesFound: { type: "number" },
                improvementsMade: { type: "number" },
                summary: { type: "string" }
            }
        }
    },
    required: ["columns"]
};

/**
 * Build comprehensive context prompt for metadata enhancement
 */
function buildEnhancementContext(metadata) {
    // Group by table
    const tables = {};
    for (const col of metadata) {
        const tableName = col.tableName || "unknown";
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
 * Create enhancement prompt with clear instructions
 */
function buildEnhancementPrompt(context, batch) {
    return `${context}

TASK: Enhance and validate this metadata batch for production use.

For EACH column, perform these checks and improvements:

1. COLUMN NAME NORMALIZATION:
   - Remove leading/trailing quotes (e.g., "coupon_calc_method'" → "coupon_calc_method")
   - Remove special characters that shouldn't be in identifiers
   - Normalize to valid SQL identifier format
   - Preserve underscores and hyphens

2. DATA TYPE CORRECTION:
   - ID columns (*_id, *id) should be VARCHAR or INTEGER, NEVER DATE/TIMESTAMP
   - Date/time columns (contains 'date', 'time', 'created', 'updated') should be TIMESTAMP
   - Boolean flags (is_*, has_*, *_flag) should be BOOLEAN
   - Numeric columns (amount, price, quantity, count, total, balance) should be DECIMAL or INTEGER
   - Text columns should be VARCHAR
   - Provide confidence score (0-1) for corrections

3. DESCRIPTION ENHANCEMENT:
   - If description is empty, missing, or too short, generate a professional one
   - If description exists but is poor quality, improve it
   - Descriptions should be clear, concise, and business-meaningful
   - Rate quality: "excellent", "good", "needs_improvement", or "missing"

4. PRIMARY KEY / FOREIGN KEY VALIDATION:
   - Verify PK/FK assignments are correct
   - Suggest missing relationships
   - Provide confidence scores

5. QUALITY ISSUES:
   - Identify any problems (incorrect_data_type, malformed_name, missing_description, etc.)
   - Provide actionable suggestions

BATCH TO PROCESS:
${JSON.stringify(batch, null, 2)}

You MUST respond with valid JSON matching this schema:
${JSON.stringify(metadataEnhancementSchema, null, 2)}

IMPORTANT RULES:
- If a column name has trailing quotes or special chars, provide cleaned version in normalizedColumnName
- If data type is clearly wrong (e.g., ID as DATE), correct it with high confidence
- Generate descriptions only if missing or poor quality
- Be conservative: only change data types if you're confident (>0.7)
- Preserve original values if they're already correct`;
}

/**
 * Process metadata in batches with retry logic and timeout
 */
async function processBatch(batch, context, retryCount = 0) {
    try {
        const prompt = buildEnhancementPrompt(context, batch);
        logger.debug({ 
            batchSize: batch.length, 
            retry: retryCount 
        }, 'Processing metadata batch with LLM');
        
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`LLM request timeout after ${TIMEOUT}ms`)), TIMEOUT);
        });
        
        const result = await Promise.race([
            promptJSON(prompt),
            timeoutPromise
        ]);
        
        if (!result || !result.columns || result.columns.length === 0) {
            throw new Error('Invalid or empty LLM response');
        }
        
        // Validate response structure
        if (result.columns.length !== batch.length) {
            logger.warn({ 
                expected: batch.length, 
                received: result.columns.length 
            }, 'Batch size mismatch, using received data');
        }
        
        return result;
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            // Check for rate limit errors
            let waitTime = RETRY_DELAY * (retryCount + 1);
            
            if (error.message && error.message.startsWith('RATE_LIMIT:')) {
                // Extract wait time from rate limit error
                const parts = error.message.split(':');
                if (parts.length >= 2) {
                    const waitSeconds = parseInt(parts[1]) || 60;
                    waitTime = waitSeconds * 1000; // Convert to milliseconds
                    logger.warn({ 
                        waitSeconds,
                        retry: retryCount + 1,
                        maxRetries: MAX_RETRIES
                    }, 'Rate limit hit, waiting before retry...');
                }
            } else {
                logger.warn({ 
                    error: error.message, 
                    retry: retryCount + 1,
                    maxRetries: MAX_RETRIES
                }, 'LLM batch processing failed, retrying...');
            }
            
            // Exponential backoff with rate limit handling
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return processBatch(batch, context, retryCount + 1);
        }
        throw error;
    }
}

/**
 * Merge LLM enhancements with original metadata
 */
function mergeEnhancements(originalMetadata, llmResults) {
    const enhanced = [];
    const llmMap = new Map();
    
    // Create lookup map for LLM results
    for (const llmCol of llmResults.columns || []) {
        const key = `${llmCol.tableName}::${llmCol.columnName}`;
        llmMap.set(key, llmCol);
    }
    
    for (const col of originalMetadata) {
        const key = `${col.tableName}::${col.columnName}`;
        const llmCol = llmMap.get(key);
        
        if (llmCol) {
            // Apply enhancements with confidence thresholds
            const enhancedCol = { ...col };
            
            // 1. Normalize column name if needed
            if (llmCol.normalizedColumnName && 
                llmCol.normalizedColumnName !== col.columnName &&
                llmCol.normalizedColumnName.length > 0) {
                enhancedCol.columnName = llmCol.normalizedColumnName;
                enhancedCol.attributeName = llmCol.normalizedColumnName;
                enhancedCol._nameNormalized = true;
                enhancedCol._originalName = col.columnName;
            }
            
            // 2. Correct data type if confidence meets threshold
            if (llmCol.correctedDataType && 
                llmCol.dataTypeConfidence >= MIN_CONFIDENCE &&
                llmCol.correctedDataType !== col.dataType) {
                enhancedCol.dataType = llmCol.correctedDataType;
                enhancedCol._dataTypeCorrected = true;
                enhancedCol._dataTypeConfidence = llmCol.dataTypeConfidence;
                enhancedCol._originalDataType = col.dataType;
            }
            
            // 3. Enhance description if needed
            if (llmCol.enhancedDescription && 
                (llmCol.descriptionQuality === 'missing' || 
                 llmCol.descriptionQuality === 'needs_improvement')) {
                enhancedCol.description = llmCol.enhancedDescription;
                enhancedCol.attributeDescription = llmCol.enhancedDescription;
                enhancedCol._descriptionEnhanced = true;
            }
            
            // 4. Update PK/FK if LLM confidence is higher
            const currentPKConfidence = col.isPrimaryKey ? 0.7 : 0;
            const currentFKConfidence = col.isForeignKey ? 0.7 : 0;
            
            if (llmCol.pkConfidence > currentPKConfidence) {
                enhancedCol.isPrimaryKey = llmCol.isPrimaryKey;
                enhancedCol._pkSource = 'llm_enhanced';
                enhancedCol._pkConfidence = llmCol.pkConfidence;
            }
            
            if (llmCol.fkConfidence > currentFKConfidence) {
                enhancedCol.isForeignKey = llmCol.isForeignKey;
                enhancedCol._fkSource = 'llm_enhanced';
                enhancedCol._fkConfidence = llmCol.fkConfidence;
                if (llmCol.referenceTable) {
                    enhancedCol.referencesTable = llmCol.referenceTable;
                }
                if (llmCol.referencesColumn) {
                    enhancedCol.referencesColumn = llmCol.referencesColumn;
                }
            }
            
            // 5. Store quality metadata
            enhancedCol._llmEnhancement = {
                issues: llmCol.issues || [],
                suggestions: llmCol.suggestions || [],
                descriptionQuality: llmCol.descriptionQuality,
                dataTypeConfidence: llmCol.dataTypeConfidence
            };
            
            enhanced.push(enhancedCol);
        } else {
            // No LLM result for this column, keep original
            enhanced.push(col);
        }
    }
    
    return enhanced;
}

/**
 * Main function: Comprehensive metadata enhancement
 * @param {Array} metadata - Original metadata array
 * @returns {Promise<Array>} - Enhanced metadata with LLM improvements
 */
export async function enhanceMetadataWithLLM(metadata) {
    // Check if enhancement is enabled
    if (ENHANCEMENT_CONFIG.enabled === false) {
        logger.info('LLM metadata enhancement is disabled via config');
        return metadata;
    }
    
    if (!metadata || metadata.length === 0) {
        logger.warn('Empty metadata provided, returning as-is');
        return metadata;
    }
    
    // Check LLM availability
    if (!isLlmReady()) {
        try {
            logger.info("LLM not ready. Initializing...");
            await Initializellm();
        } catch (error) {
            logger.error({ error }, "Failed to initialize LLM, skipping enhancement (graceful degradation)");
            return metadata; // Return original if LLM unavailable
        }
    }
    
    const context = buildEnhancementContext(metadata);
    const totalColumns = metadata.length;
    const batches = [];
    
    // Split into batches
    for (let i = 0; i < metadata.length; i += BATCH_SIZE) {
        batches.push(metadata.slice(i, i + BATCH_SIZE));
    }
    
    logger.info({ 
        totalColumns, 
        batches: batches.length, 
        batchSize: BATCH_SIZE 
    }, 'Starting comprehensive metadata enhancement');
    
    const allResults = [];
    let processed = 0;
    
    try {
        // Process batches sequentially (to avoid overwhelming LLM)
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            logger.info({ 
                batch: i + 1, 
                total: batches.length, 
                size: batch.length 
            }, 'Processing batch');
            
            const result = await processBatch(batch, context);
            allResults.push(result);
            
            processed += batch.length;
            logger.info({ 
                processed, 
                total: totalColumns, 
                progress: `${Math.round((processed / totalColumns) * 100)}%` 
            }, 'Batch completed');
            
            // Add delay between batches to avoid rate limits (except for last batch)
            if (i < batches.length - 1) {
                const delayMs = 2000; // 2 second delay between batches
                logger.debug({ delayMs }, 'Waiting before next batch to avoid rate limits');
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        // Merge all results
        let enhancedMetadata = metadata;
        for (const result of allResults) {
            enhancedMetadata = mergeEnhancements(enhancedMetadata, result);
        }
        
        // Calculate overall statistics
        const stats = {
            total: enhancedMetadata.length,
            nameNormalized: enhancedMetadata.filter(c => c._nameNormalized).length,
            dataTypeCorrected: enhancedMetadata.filter(c => c._dataTypeCorrected).length,
            descriptionEnhanced: enhancedMetadata.filter(c => c._descriptionEnhanced).length,
            pkEnhanced: enhancedMetadata.filter(c => c._pkSource === 'llm_enhanced').length,
            fkEnhanced: enhancedMetadata.filter(c => c._fkSource === 'llm_enhanced').length
        };
        
        logger.info(stats, '✅ Metadata enhancement completed successfully');
        
        // Store overall quality if available
        if (allResults[0]?.overallQuality) {
            enhancedMetadata._qualityMetrics = allResults[0].overallQuality;
        }
        
        return enhancedMetadata;
        
    } catch (error) {
        logger.error({ 
            error: error.message, 
            processed,
            total: totalColumns 
        }, 'Metadata enhancement failed, returning original metadata');
        
        // Return original metadata on failure (graceful degradation)
        return metadata;
    }
}

/**
 * Quick enhancement for single column (for real-time use)
 */
export async function enhanceSingleColumn(column, allMetadata) {
    if (!isLlmReady()) {
        return { error: "LLM not ready" };
    }
    
    const context = buildEnhancementContext([column]);
    const batch = [column];
    
    try {
        const result = await processBatch(batch, context);
        if (result.columns && result.columns.length > 0) {
            const enhanced = mergeEnhancements([column], result);
            return enhanced[0];
        }
        return column;
    } catch (error) {
        logger.error({ error: error.message }, 'Single column enhancement failed');
        return column;
    }
}
