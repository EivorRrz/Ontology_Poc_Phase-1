/**
 * @Module Metadata Enhancement Agent (LangGraph - Pure Agentic AI)
 * @Description Pure agentic workflow with decision-making, self-correction, and stateful processing
 */

import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { enhanceMetadataBatchWithLangChain, initializeLangChain, getLangChainStatus } from "../llm/azureLangChainService.js";
import logger from "../utils/logger.js";
import config from "../config/index.js";
import { applyPatternMemory, learnFromCorrection } from "./patternMemory.js";
import { inferCrossTableRelationships, applyInferredRelationships } from "./relationshipInferenceAgent.js";
import { generateOptimizationSuggestions, applyOptimizations } from "./schemaOptimizationAgent.js";

/**
 * Agent State Schema
 */
const agentStateSchema = Annotation.Root({
    metadata: Annotation({
        reducer: (x, y) => {
            const value = y || x;
            if(!Array.isArray(value)){
                logger.warn("Invalid metadata state, defaulting to empty array");
                return [];
            }
            return value;
        },
        default: () => [],
    }),
    enhancedMetadata: Annotation({
        reducer: (x, y) => y || x,
        default: () => null,
    }),
    batches: Annotation({
        reducer: (x, y) => {
            const value = y || x;
            return Array.isArray(value) ? value : [];
        },
        default: () => [],
    }),
    processedBatches: Annotation({
        reducer: (x, y) => {
            const existing = Array.isArray(x) ? x : [];
            // Handle reset: if y is explicitly null, reset to empty array
            if (y === null) return [];
            if (y === undefined) return existing;
            if (!Array.isArray(y)) return existing;
            // Safety check: prevent invalid array lengths
            const maxLength = 1000000; // Reasonable maximum
            const newLength = existing.length + y.length;
            if (newLength > maxLength) {
                logger.warn({ existing: existing.length, new: y.length, max: maxLength }, 
                    "Array length would exceed maximum, truncating");
                return existing.slice(0, Math.max(0, maxLength - y.length)).concat(y);
            }
            return [...existing, ...y];
        },
        default: () => [],
    }),
    qualityScore: Annotation({
        reducer: (x, y) => {
            const score = y !== undefined ? y : (x || 0);
            return Math.max(0, Math.min(1, score));
        },
        default: () => 0,
    }),
    retryCount: Annotation({
        reducer: (x, y) => {
            const current = x || 0;
            if (y === null || y === undefined) return current;
            // If y is exactly current + 1, treat as absolute (explicit set from retryWithContextStep)
            // If y is a small number (1-10) and y > current, treat as absolute
            // If y is much larger than current, treat as absolute
            if (y === current + 1 || (y > current && y <= 10) || (y > current * 2 && y > 10)) {
                return Math.max(0, y); // Absolute value
            }
            // For increments (typically y would be 1), but we handle explicit sets above
            return Math.max(0, current + (y || 0)); // Increment
        },
        default: () => 0,
    }),
    currentStep: Annotation({
        reducer: (x, y) => y || x || "start",
        default: () => "start",
    }),
    errors: Annotation({
        reducer: (x, y) => {
            const existing = Array.isArray(x) ? x : [];
            // Handle reset: if y is explicitly null, reset to empty array
            if (y === null) return [];
            if (y === undefined) return existing;
            if (!Array.isArray(y)) {
                // If y is a single error object, wrap it in array
                if (y && typeof y === 'object' && y.error) {
                    const maxLength = 1000; // Much smaller limit
                    const combined = [...existing, y];
                    return combined.length > maxLength ? combined.slice(-maxLength) : combined;
                }
                return existing;
            }
            // Safety check: prevent invalid array lengths
            const maxLength = 1000; // Much smaller, reasonable maximum
            const combined = [...existing, ...y];
            if (combined.length > maxLength) {
                logger.warn({ existing: existing.length, new: y.length, max: maxLength }, 
                    "Errors array length would exceed maximum, keeping last 1000 errors");
                return combined.slice(-maxLength); // Keep last 1000 errors
            }
            return combined;
        },
        default: () => [],
    }),
    context: Annotation({
        reducer: (x, y) => y || x || "",
        default: () => "",
    }),
    startTime: Annotation({
        reducer: (x, y) => y || x || Date.now(),
        default: () => Date.now(),
    }),
    shouldRetry: Annotation({
        reducer: (x, y) => y !== undefined ? y : (x || false),
        default: () => false,
    }),
    relationships: Annotation({
        reducer: (x, y) => y || x || null,
        default: () => null,
    }),
    optimizations: Annotation({
        reducer: (x, y) => y || x || null,
        default: () => null,
    }),
});

/**
 * Step 1: Initialize
 */
async function initializeStep(state){
    const startTime = Date.now();
    logger.info("🚀 Step 1: Initializing agentic workflow...");

    try {
        if(!state.metadata || !Array.isArray(state.metadata) || state.metadata.length === 0){
            throw new Error("Invalid metadata: must be a non-empty array");
        }

        await initializeLangChain();

        const status = getLangChainStatus();
        if(status.circuitBreaker.state === "OPEN"){
            logger.warn("Circuit breaker is OPEN, proceeding with caution");
        }

        const metadata = state.metadata;
        const tableCount = [...new Set(metadata.map(m => m.tableName))].length;

        logger.info({
            totalColumns: metadata.length,
            tables: tableCount,
            initializationTime: Date.now() - startTime
        }, "Metadata loaded for processing");

        return {
            ...state,
            currentStep: "initialized",
            startTime: startTime,
        };
    } catch(error){
        logger.error({
            error: error.message,
            stack: error.stack
        }, "Initialization failed");
        
        return {
            ...state,
            errors: [...(state.errors || []), {
                step: "initialize",
                error: error.message,
                timestamp: Date.now()
            }],
            currentStep: "error",
        };
    }
}

/**
 * Step 1.5: Apply Pattern Memory (Learning from Past Corrections)
 */
async function applyPatternMemoryStep(state){
    logger.info("🧠 Step 1.5: Applying pattern memory (learning from past corrections)...");

    try {
        const metadata = state.metadata || [];
        
        if(metadata.length === 0){
            logger.warn("No metadata to apply pattern memory");
            return {
                ...state,
                currentStep: "pattern_memory_applied",
            };
        }

        // Apply learned patterns
        const enhancedMetadata = applyPatternMemory(metadata);
        
        const appliedCount = enhancedMetadata.filter(col => col._patternMemoryApplied || col._patternMemoryPK || col._patternMemoryFK).length;
        
        logger.info({
            applied: appliedCount,
            total: metadata.length
        }, "Pattern memory applied");

        return {
            ...state,
            metadata: enhancedMetadata,
            currentStep: "pattern_memory_applied",
        };
    } catch(error){
        logger.error({ error: error.message }, "Pattern memory application failed");
        return {
            ...state,
            errors: [...(state.errors || []), {
                step: "applyPatternMemory",
                error: error.message
            }],
            currentStep: "error",
        };
    }
}

/**
 * Step 2: Prepare Batches
 */
async function prepareBatchesStep(state){
    logger.info("📦 Step 2: Preparing batches for parallel processing...");

    try {
        const metadata = state.metadata || [];
        
        if(metadata.length === 0){
            throw new Error("No metadata to process");
        }

        let batchSize = config.llm.metadataEnhancement.batchSize || 50;
        
        if(batchSize <= 0 || batchSize > 100){
            logger.warn({ batchSize }, "Invalid batch size, using default");
            batchSize = 50;
        }

        const batches = [];
        for(let i = 0; i < metadata.length; i += batchSize){
            batches.push(metadata.slice(i, i + batchSize));
        }

        logger.info({
            totalBatches: batches.length,
            batchSize: batchSize,
            totalColumns: metadata.length
        }, "Batches prepared");

        return {
            ...state,
            batches: batches,
            currentStep: "batches_prepared",
        };
    } catch(error){
        logger.error({ error: error.message }, "Batch preparation failed");
        return {
            ...state,
            errors: [...(state.errors || []), {
                step: "prepareBatches",
                error: error.message
            }],
            currentStep: "error",
        };
    }
}

/**
 * Step 3: Enhance Metadata (Parallel Processing)
 */
async function enhanceMetadataStep(state){
    logger.info("✨ Step 3: Enhancing metadata with LangChain (parallel processing)...");

    const batches = state.batches || [];
    const metadata = state.metadata || [];
    const context = state.context || "";

    if(batches.length === 0){
        logger.warn("No batches to process");
        return {
            ...state,
            currentStep: "enhancement_skipped",
        };
    }

    const allResults = [];
    const errors = [];
    const startTime = Date.now();

    try {
        const MAX_CONCURRENT = 5;
        const batchPromises = [];
        
        for(let i = 0; i < batches.length; i += MAX_CONCURRENT){
            const batchGroup = batches.slice(i, i + MAX_CONCURRENT);
            
            const groupPromises = batchGroup.map(async (batch, index) => {
                const actualIndex = i + index;
                try {
                    logger.debug({
                        batch: actualIndex + 1,
                        total: batches.length,
                        size: batch.length
                    }, "Processing batch");

                    const result = await enhanceMetadataBatchWithLangChain(metadata, batch, 0);
                    
                    return {
                        batchIndex: actualIndex,
                        result: result,
                        success: true,
                    };
                } catch(error){
                    logger.error({
                        error: error.message,
                        batch: actualIndex + 1
                    }, "Batch processing failed");
                    
                    return {
                        batchIndex: actualIndex,
                        result: null,
                        success: false,
                        error: error.message,
                    };
                }
            });

            const groupResults = await Promise.all(groupPromises);
            
            for(const batchResult of groupResults){
                if(batchResult.success && batchResult.result){
                    allResults.push(batchResult.result);
                } else {
                    // Only add error object, not array
                    errors.push({
                        batch: batchResult.batchIndex + 1,
                        error: batchResult.error || "Unknown error",
                        timestamp: Date.now()
                    });
                }
            }
        }

        const processingTime = Date.now() - startTime;

        logger.info({
            successfulBatches: allResults.length,
            failedBatches: errors.length,
            totalBatches: batches.length,
            processingTime: `${processingTime}ms`
        }, "Batch enhancement completed");

        // Limit errors array size to prevent memory issues
        const existingErrors = Array.isArray(state.errors) ? state.errors : [];
        const maxErrors = 1000; // Reasonable limit
        const combinedErrors = [...existingErrors, ...errors];
        const limitedErrors = combinedErrors.length > maxErrors 
            ? combinedErrors.slice(-maxErrors) // Keep last 1000 errors
            : combinedErrors;

        return {
            ...state,
            processedBatches: allResults,
            errors: limitedErrors,
            currentStep: "enhanced",
        };
    } catch(error){
        logger.error({ error: error.message }, "Enhancement step failed");
        return {
            ...state,
            errors: [...(state.errors || []), {
                step: "enhance",
                error: error.message
            }],
            currentStep: "error",
        };
    }
}

/**
 * Step 4: Calculate Quality (AGENTIC DECISION POINT)
 */
async function calculateQualityStep(state){
    logger.info("📊 Step 4: Calculating quality score (AGENTIC DECISION POINT)...");

    try {
        const processedBatches = state.processedBatches || [];

        if(processedBatches.length === 0){
            logger.warn("No processed batches, quality score is 0");
            const maxRetries = config.llm.metadataEnhancement.maxRetries || 3;
            const currentRetryCount = state.retryCount || 0;
            // Only retry if we haven't exceeded max retries
            const shouldRetry = currentRetryCount < maxRetries;
            return {
                ...state,
                qualityScore: 0,
                currentStep: "quality_calculated",
                shouldRetry: shouldRetry,
            };
        }

        let totalScore = 0;
        let totalBatches = 0;
        let totalIssues = 0;
        let totalImprovements = 0;

        for(const batchResult of processedBatches){
            if(batchResult && batchResult.overallQuality){
                const quality = batchResult.overallQuality;
                totalScore += quality.score || 0;
                totalIssues += quality.issuesFound || 0;
                totalImprovements += quality.improvementsMade || 0;
                totalBatches++;
            }
        }

        const qualityScore = totalBatches > 0 ? totalScore / totalBatches : 0;
        const minQualityThreshold = config.llm.metadataEnhancement.minConfidence || 0.7;
        const maxRetries = config.llm.metadataEnhancement.maxRetries || 3;
        const currentRetryCount = state.retryCount || 0;

        // Check circuit breaker status - don't retry if circuit breaker is OPEN
        const langChainStatus = getLangChainStatus();
        const circuitBreakerOpen = langChainStatus.circuitBreaker.state === "OPEN";

        // 🤖 AGENTIC DECISION: Should we retry?
        // Only retry if: quality is low, retries not exceeded, AND circuit breaker is not open
        const shouldRetry = qualityScore < minQualityThreshold && 
                            currentRetryCount < maxRetries && 
                            !circuitBreakerOpen;

        logger.info({
            qualityScore: qualityScore.toFixed(3),
            threshold: minQualityThreshold,
            issuesFound: totalIssues,
            improvementsMade: totalImprovements,
            shouldRetry: shouldRetry,
            retryCount: currentRetryCount
        }, "Quality assessment completed - AGENTIC DECISION");

        return {
            ...state,
            qualityScore: qualityScore,
            currentStep: "quality_calculated",
            shouldRetry: shouldRetry,
            qualityMetrics: {
                score: qualityScore,
                issuesFound: totalIssues,
                improvementsMade: totalImprovements,
                batchesProcessed: totalBatches,
            },
        };
    } catch(error){
        logger.error({ error: error.message }, "Quality calculation failed");
        return {
            ...state,
            qualityScore: 0,
            shouldRetry: false,
            errors: [...(state.errors || []), {
                step: "calculateQuality",
                error: error.message
            }],
        };
    }
}

/**
 * Step 5: Merge Results
 */
async function mergeResultsStep(state){
    logger.info("🔗 Step 5: Merging enhanced results...");

    try {
        const processedBatches = state.processedBatches || [];
        const originalMetadata = state.metadata || [];

        if(processedBatches.length === 0){
            logger.warn("No processed batches to merge, returning original metadata");
            return {
                ...state,
                enhancedMetadata: originalMetadata,
                currentStep: "merged",
            };
        }

        const enhancedMetadata = mergeEnhancements(originalMetadata, processedBatches);

        // Learn from successful corrections (Pattern Memory)
        let learnedCount = 0;
        for (const col of enhancedMetadata) {
            if (col._dataTypeCorrected || col._pkSource === 'langchain_enhanced' || col._fkSource === 'langchain_enhanced') {
                learnFromCorrection(col.columnName, {
                    dataType: col.dataType,
                    dataTypeConfidence: col._dataTypeConfidence || 0.8,
                    isPrimaryKey: col.isPrimaryKey,
                    pkConfidence: col._pkConfidence || 0,
                    isForeignKey: col.isForeignKey,
                    fkConfidence: col._fkConfidence || 0
                });
                learnedCount++;
            }
        }
        
        if (learnedCount > 0) {
            logger.info({
                learned: learnedCount
            }, "🧠 Learned from corrections (pattern memory updated)");
        }

        logger.info({
            originalCount: originalMetadata.length,
            enhancedCount: enhancedMetadata.length,
            batchesMerged: processedBatches.length
        }, "Results merged successfully");

        return {
            ...state,
            enhancedMetadata: enhancedMetadata,
            currentStep: "merged",
        };
    } catch(error){
        logger.error({ error: error.message }, "Merge failed");
        return {
            ...state,
            enhancedMetadata: state.metadata || [],
            errors: [...(state.errors || []), {
                step: "merge",
                error: error.message
            }],
        };
    }
}

/**
 * Step 6: Infer Cross-Table Relationships (ADVANCED AI)
 */
async function inferRelationshipsStep(state){
    logger.info("🔗 Step 6: Inferring cross-table relationships (ADVANCED AI)...");

    try {
        const metadata = state.enhancedMetadata || state.metadata || [];
        
        if(metadata.length === 0){
            logger.warn("No metadata for relationship inference");
            return {
                ...state,
                currentStep: "relationships_inferred",
            };
        }

        // Infer relationships across all tables
        const relationshipResult = await inferCrossTableRelationships(metadata);
        
        // Apply inferred relationships
        const enhancedWithRelationships = applyInferredRelationships(metadata, relationshipResult);

        logger.info({
            totalRelationships: relationshipResult.summary.totalRelationships,
            missingFKs: relationshipResult.summary.missingFKs,
            manyToMany: relationshipResult.summary.manyToMany || 0
        }, "Cross-table relationships inferred");

        return {
            ...state,
            enhancedMetadata: enhancedWithRelationships,
            relationships: relationshipResult,
            currentStep: "relationships_inferred",
        };
    } catch(error){
        logger.error({ error: error.message }, "Relationship inference failed");
        return {
            ...state,
            errors: [...(state.errors || []), {
                step: "inferRelationships",
                error: error.message
            }],
            currentStep: "error",
        };
    }
}

/**
 * Step 7: Generate Optimization Suggestions (ADVANCED AI)
 */
async function optimizeSchemaStep(state){
    logger.info("⚡ Step 7: Generating schema optimization suggestions (ADVANCED AI)...");

    try {
        const metadata = state.enhancedMetadata || state.metadata || [];
        
        if(metadata.length === 0){
            logger.warn("No metadata for optimization");
            return {
                ...state,
                currentStep: "optimized",
            };
        }

        // Generate optimization suggestions
        const optimizationResult = await generateOptimizationSuggestions(metadata);
        
        // Apply high-priority optimizations
        const optimizedMetadata = applyOptimizations(metadata, optimizationResult);

        logger.info({
            totalOptimizations: optimizationResult.summary.totalOptimizations,
            highImpact: optimizationResult.summary.highImpact,
            mediumImpact: optimizationResult.summary.mediumImpact
        }, "Schema optimization suggestions generated");

        return {
            ...state,
            enhancedMetadata: optimizedMetadata,
            optimizations: optimizationResult,
            currentStep: "optimized",
        };
    } catch(error){
        logger.error({ error: error.message }, "Optimization failed");
        return {
            ...state,
            errors: [...(state.errors || []), {
                step: "optimizeSchema",
                error: error.message
            }],
            currentStep: "error",
        };
    }
}

/**
 * Step 8: Retry with Enhanced Context (AGENTIC SELF-CORRECTION)
 */
async function retryWithContextStep(state){
    logger.info("🔄 Step 6: Retrying with enhanced context (AGENTIC SELF-CORRECTION)...");

    try {
        const currentRetryCount = (state.retryCount || 0) + 1;
        const qualityScore = state.qualityScore || 0;
        const maxRetries = config.llm.metadataEnhancement.maxRetries || 3;

        // Check circuit breaker - don't retry if service is unavailable
        const langChainStatus = getLangChainStatus();
        const circuitBreakerOpen = langChainStatus.circuitBreaker.state === "OPEN";

        if(circuitBreakerOpen){
            logger.warn({
                retryCount: currentRetryCount,
                circuitBreakerState: "OPEN",
                failures: langChainStatus.circuitBreaker.failures
            }, "Circuit breaker is OPEN - stopping retries");
            
            return {
                ...state,
                shouldRetry: false,
                currentStep: "circuit_breaker_open",
            };
        }

        if(currentRetryCount >= maxRetries){
            logger.warn({
                retryCount: currentRetryCount,
                maxRetries: maxRetries
            }, "Max retries reached, proceeding with current results");
            
            return {
                ...state,
                shouldRetry: false,
                currentStep: "max_retries_reached",
            };
        }

        const enhancedContext = `${state.context || ""}

ADDITIONAL CONTEXT FOR RETRY #${currentRetryCount}:
- Previous quality score: ${qualityScore.toFixed(3)}
- Retry attempt: ${currentRetryCount} of ${maxRetries}
- Focus on improving data type accuracy and description quality
- Be more conservative with changes (only high confidence corrections >0.8)
- Provide detailed quality assessment
        `;

        logger.info({
            retryCount: currentRetryCount,
            previousQuality: qualityScore.toFixed(3)
        }, "Preparing retry with enhanced context");

        return {
            ...state,
            retryCount: currentRetryCount,
            context: enhancedContext,
            currentStep: "retrying",
            batches: state.batches,
            processedBatches: null, // Reset for retry
        };
    } catch(error){
        logger.error({ error: error.message }, "Retry preparation failed");
        return {
            ...state,
            shouldRetry: false,
            errors: [...(state.errors || []), {
                step: "retry",
                error: error.message
            }],
        };
    }
}

/**
 * Merge enhancements from batch results
 */
function mergeEnhancements(originalMetadata, batchResults){
    const enhanced = [];
    const llmMap = new Map();
    const MIN_CONFIDENCE = config.llm.metadataEnhancement.minConfidence || 0.7;

    if(!Array.isArray(originalMetadata) || !Array.isArray(batchResults)){
        logger.warn("Invalid input for merge, returning original metadata");
        return originalMetadata || [];
    }

    for(const batchResult of batchResults){
        if(!batchResult || !Array.isArray(batchResult.columns)) continue;
        
        for(const llmCol of batchResult.columns){
            if(!llmCol || !llmCol.tableName || !llmCol.columnName) continue;
            
            const key = `${llmCol.tableName}::${llmCol.columnName}`;
            const existing = llmMap.get(key);
            
            if(!existing || (llmCol.dataTypeConfidence || 0) > (existing.dataTypeConfidence || 0)){
                llmMap.set(key, llmCol);
            }
        }
    }

    for(const col of originalMetadata){
        if(!col || typeof col !== 'object'){
            enhanced.push(col);
            continue;
        }

        const key = `${col.tableName || ''}::${col.columnName || ''}`;
        const llmCol = llmMap.get(key);

        if(llmCol){
            const enhancedCol = { ...col };

            if(llmCol.normalizedColumnName && llmCol.normalizedColumnName !== col.columnName){
                enhancedCol.columnName = llmCol.normalizedColumnName;
                enhancedCol.attributeName = llmCol.normalizedColumnName;
                enhancedCol._nameNormalized = true;
                enhancedCol._originalName = col.columnName;
            }

            if(llmCol.correctedDataType &&
                llmCol.dataTypeConfidence >= MIN_CONFIDENCE &&
                llmCol.correctedDataType !== col.dataType){
                enhancedCol.dataType = llmCol.correctedDataType;
                enhancedCol._dataTypeCorrected = true;
                enhancedCol._dataTypeConfidence = llmCol.dataTypeConfidence;
                enhancedCol._originalDataType = col.dataType;
            }

            if(llmCol.enhancedDescription &&
                (llmCol.descriptionQuality === 'missing' ||
                 llmCol.descriptionQuality === 'needs_improvement')){
                enhancedCol.description = llmCol.enhancedDescription;
                enhancedCol.attributeDescription = llmCol.enhancedDescription;
                enhancedCol._descriptionEnhanced = true;
            }

            if(llmCol.pkConfidence && llmCol.pkConfidence > 0.7){
                enhancedCol.isPrimaryKey = llmCol.isPrimaryKey;
                enhancedCol._pkSource = 'langchain_enhanced';
                enhancedCol._pkConfidence = llmCol.pkConfidence;
            }

            if(llmCol.fkConfidence && llmCol.fkConfidence > 0.7){
                enhancedCol.isForeignKey = llmCol.isForeignKey;
                enhancedCol._fkSource = 'langchain_enhanced';
                enhancedCol._fkConfidence = llmCol.fkConfidence;
                if(llmCol.referenceTable) enhancedCol.referencesTable = llmCol.referenceTable;
                if(llmCol.referencesColumn) enhancedCol.referencesColumn = llmCol.referencesColumn;
            }

            enhancedCol._langchainEnhancement = {
                issues: llmCol.issues || [],
                suggestions: llmCol.suggestions || [],
                descriptionQuality: llmCol.descriptionQuality,
                dataTypeConfidence: llmCol.dataTypeConfidence
            };

            enhanced.push(enhancedCol);
        } else {
            enhanced.push(col);
        }
    }

    return enhanced;
}

/**
 * Decision Function: Route based on quality check
 */
function routeDecision(state){
    const maxRetries = config.llm.metadataEnhancement.maxRetries || 3;
    const currentRetryCount = state.retryCount || 0;
    
    // Check circuit breaker status - don't retry if OPEN
    const langChainStatus = getLangChainStatus();
    const circuitBreakerOpen = langChainStatus.circuitBreaker.state === "OPEN";
    
    const shouldRetry = state.shouldRetry === true && 
                       currentRetryCount < maxRetries && 
                       !circuitBreakerOpen;
    
    logger.info({
        shouldRetry: shouldRetry,
        qualityScore: state.qualityScore?.toFixed(3) || 0,
        retryCount: currentRetryCount,
        maxRetries: maxRetries,
        circuitBreakerOpen: circuitBreakerOpen
    }, "🤖 AGENTIC ROUTING DECISION");

    return shouldRetry ? "retry" : "continue";
}

/**
 * Decision Function: Route after retry step - check if we should actually retry or merge
 */
function routeAfterRetry(state){
    // If retry step detected circuit breaker OPEN or max retries, go to merge
    if(state.currentStep === "circuit_breaker_open" || state.currentStep === "max_retries_reached"){
        logger.info({
            currentStep: state.currentStep,
            retryCount: state.retryCount || 0
        }, "🛑 Stopping retries - routing to merge");
        return "merge";
    }
    
    // Otherwise, proceed with enhancement retry
    return "enhance";
}

/**
 * Create the Agentic Workflow Graph
 */
export function createMetadataEnhancementAgent(){
        logger.info("🤖 Creating advanced AI agent workflow with pattern memory, relationship inference, and optimization...");

    try {
        const workflow = new StateGraph(agentStateSchema)
            .addNode("initialize", initializeStep)
            .addNode("applyPatternMemory", applyPatternMemoryStep)
            .addNode("prepareBatches", prepareBatchesStep)
            .addNode("enhance", enhanceMetadataStep)
            .addNode("calculateQuality", calculateQualityStep)
            .addNode("merge", mergeResultsStep)
            .addNode("inferRelationships", inferRelationshipsStep)
            .addNode("optimizeSchema", optimizeSchemaStep)
            .addNode("retry", retryWithContextStep)
            
            .setEntryPoint("initialize")
            .addEdge("initialize", "applyPatternMemory")
            .addEdge("applyPatternMemory", "prepareBatches")
            .addEdge("prepareBatches", "enhance")
            .addEdge("enhance", "calculateQuality")
            
            .addConditionalEdges(
                "calculateQuality",
                routeDecision,
                {
                    retry: "retry",
                    continue: "merge",
                }
            )
            
            .addConditionalEdges(
                "retry",
                routeAfterRetry,
                {
                    enhance: "enhance",
                    merge: "merge",
                }
            )
            
            .addEdge("merge", "inferRelationships")
            .addEdge("inferRelationships", "optimizeSchema")
            .addEdge("optimizeSchema", END);

        const compiledWorkflow = workflow.compile();

        logger.info("✅ Advanced AI agent workflow created successfully (Pattern Memory + Relationship Inference + Optimization)");
        
        return compiledWorkflow;
    } catch(error){
        logger.error({ error: error.message }, "Failed to create agentic workflow");
        throw error;
    }
}

/**
 * Run the agentic enhancement workflow
 */
export async function runAgenticEnhancement(metadata){
    const startTime = Date.now();
    
    try {
        if(!metadata || !Array.isArray(metadata) || metadata.length === 0){
            logger.warn("Invalid metadata provided, returning as-is");
            return metadata;
        }

        const agent = createMetadataEnhancementAgent();
        
        const initialState = {
            metadata: metadata,
            retryCount: 0,
            currentStep: "start",
            errors: [],
            startTime: startTime,
        };

        logger.info({
            totalColumns: metadata.length,
            tables: [...new Set(metadata.map(m => m.tableName))].length
        }, "🤖 Starting advanced AI agent workflow (Pattern Memory + Relationship Inference + Optimization)...");

        const result = await agent.invoke(initialState, { recursionLimit: 50 });
        
        const totalTime = Date.now() - startTime;
        
        logger.info({
            qualityScore: result.qualityScore?.toFixed(3) || 0,
            retries: result.retryCount || 0,
            step: result.currentStep,
            errors: result.errors?.length || 0,
            qualityMetrics: result.qualityMetrics,
            relationships: result.relationships?.summary?.totalRelationships || 0,
            missingFKs: result.relationships?.summary?.missingFKs || 0,
            optimizations: result.optimizations?.summary?.totalOptimizations || 0,
            highImpactOpts: result.optimizations?.summary?.highImpact || 0,
            totalTime: `${totalTime}ms`
        }, "✅ Advanced AI agent workflow completed successfully");

        // Attach relationships and optimizations to metadata for downstream use
        const finalMetadata = result.enhancedMetadata || result.metadata || metadata;
        if (Array.isArray(finalMetadata)) {
            finalMetadata._agentResults = {
                relationships: result.relationships,
                optimizations: result.optimizations,
                qualityScore: result.qualityScore,
                qualityMetrics: result.qualityMetrics
            };
        }

        return finalMetadata;

    } catch(error){
        const totalTime = Date.now() - startTime;
        
        logger.error({
            error: error.message,
            stack: error.stack,
            totalTime: `${totalTime}ms`
        }, "❌ Agentic workflow failed");
        
        logger.warn("Returning original metadata due to workflow failure");
        return metadata;
    }
}
