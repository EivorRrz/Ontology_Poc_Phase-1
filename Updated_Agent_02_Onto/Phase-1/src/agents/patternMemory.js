/**
 * @Module Pattern Memory System
 * @Description AI Agent learns from successful corrections and applies patterns to future runs
 * This enables the agent to improve over time by remembering what worked
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger.js';
import config from '../config/index.js';

// Pattern memory storage file (store in Phase-1 root)
const MEMORY_FILE = join(config.storage.artifactsDir, '..', '..', 'pattern-memory.json');

/**
 * Pattern Memory Structure
 */
let patternMemory = {
    dataTypes: {},      // columnName → { type, confidence, count }
    pkPatterns: {},     // pattern → { confidence, count }
    fkPatterns: {},     // pattern → { confidence, count }
    relationships: [],  // [{ from, to, pattern, confidence }]
    optimizations: [],  // [{ table, column, suggestion, impact }]
    lastUpdated: null
};

/**
 * Load pattern memory from disk
 */
function loadPatternMemory() {
    try {
        if (existsSync(MEMORY_FILE)) {
            const data = readFileSync(MEMORY_FILE, 'utf-8');
            patternMemory = JSON.parse(data);
            logger.info({
                dataTypes: Object.keys(patternMemory.dataTypes).length,
                pkPatterns: Object.keys(patternMemory.pkPatterns).length,
                fkPatterns: Object.keys(patternMemory.fkPatterns).length,
                relationships: patternMemory.relationships.length
            }, '📚 Pattern memory loaded');
        } else {
            logger.info('No existing pattern memory found, starting fresh');
        }
    } catch (error) {
        logger.warn({ error: error.message }, 'Failed to load pattern memory, starting fresh');
        patternMemory = {
            dataTypes: {},
            pkPatterns: {},
            fkPatterns: {},
            relationships: [],
            optimizations: [],
            lastUpdated: null
        };
    }
}

/**
 * Save pattern memory to disk
 */
function savePatternMemory() {
    try {
        patternMemory.lastUpdated = new Date().toISOString();
        writeFileSync(MEMORY_FILE, JSON.stringify(patternMemory, null, 2), 'utf-8');
        logger.debug('Pattern memory saved');
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to save pattern memory');
    }
}

/**
 * Learn from a successful correction
 */
export function learnFromCorrection(columnName, correction) {
    const normalizedName = columnName.toLowerCase().trim();
    
    // Learn data type patterns
    if (correction.dataType && correction.dataTypeConfidence) {
        if (!patternMemory.dataTypes[normalizedName]) {
            patternMemory.dataTypes[normalizedName] = {
                type: correction.dataType,
                confidence: correction.dataTypeConfidence,
                count: 1
            };
        } else {
            // Update with weighted average
            const existing = patternMemory.dataTypes[normalizedName];
            const totalCount = existing.count + 1;
            existing.confidence = (
                (existing.confidence * existing.count) + correction.dataTypeConfidence
            ) / totalCount;
            existing.count = totalCount;
            
            // Update type if confidence is higher
            if (correction.dataTypeConfidence > existing.confidence) {
                existing.type = correction.dataType;
            }
        }
    }
    
    // Learn PK patterns
    if (correction.isPrimaryKey && correction.pkConfidence) {
        const pattern = extractPattern(normalizedName);
        if (!patternMemory.pkPatterns[pattern]) {
            patternMemory.pkPatterns[pattern] = {
                confidence: correction.pkConfidence,
                count: 1
            };
        } else {
            const existing = patternMemory.pkPatterns[pattern];
            existing.confidence = (
                (existing.confidence * existing.count) + correction.pkConfidence
            ) / (existing.count + 1);
            existing.count += 1;
        }
    }
    
    // Learn FK patterns
    if (correction.isForeignKey && correction.fkConfidence) {
        const pattern = extractPattern(normalizedName);
        if (!patternMemory.fkPatterns[pattern]) {
            patternMemory.fkPatterns[pattern] = {
                confidence: correction.fkConfidence,
                count: 1
            };
        } else {
            const existing = patternMemory.fkPatterns[pattern];
            existing.confidence = (
                (existing.confidence * existing.count) + correction.fkConfidence
            ) / (existing.count + 1);
            existing.count += 1;
        }
    }
    
    savePatternMemory();
    logger.debug({
        column: columnName,
        learned: {
            dataType: correction.dataType,
            pk: correction.isPrimaryKey,
            fk: correction.isForeignKey
        }
    }, '🧠 Learned from correction');
}

/**
 * Extract pattern from column name (e.g., "user_id" → "_id")
 */
function extractPattern(columnName) {
    const lower = columnName.toLowerCase();
    
    // Common patterns
    if (lower.endsWith('_id')) return '_id';
    if (lower.endsWith('id')) return 'id';
    if (lower.startsWith('is_')) return 'is_';
    if (lower.startsWith('has_')) return 'has_';
    if (lower.endsWith('_at')) return '_at';
    if (lower.endsWith('_date')) return '_date';
    if (lower.endsWith('_time')) return '_time';
    if (lower.endsWith('_email')) return '_email';
    if (lower.endsWith('_name')) return '_name';
    
    return 'other';
}

/**
 * Apply learned patterns to metadata
 */
export function applyPatternMemory(metadata) {
    if (!metadata || !Array.isArray(metadata)) {
        return metadata;
    }
    
    let appliedCount = 0;
    
    const enhanced = metadata.map(col => {
        if (!col || !col.columnName) return col;
        
        const normalizedName = col.columnName.toLowerCase().trim();
        const enhancedCol = { ...col };
        
        // Apply data type patterns
        const dataTypePattern = patternMemory.dataTypes[normalizedName];
        if (dataTypePattern && dataTypePattern.confidence >= 0.8) {
            if (!col.dataType || col.dataType === 'VARCHAR') {
                enhancedCol.dataType = dataTypePattern.type;
                enhancedCol._patternMemoryApplied = true;
                enhancedCol._patternMemoryConfidence = dataTypePattern.confidence;
                appliedCount++;
            }
        }
        
        // Apply PK patterns
        const pattern = extractPattern(normalizedName);
        const pkPattern = patternMemory.pkPatterns[pattern];
        if (pkPattern && pkPattern.confidence >= 0.8 && !col.isPrimaryKey) {
            enhancedCol.isPrimaryKey = true;
            enhancedCol._patternMemoryPK = true;
            enhancedCol._patternMemoryPKConfidence = pkPattern.confidence;
            appliedCount++;
        }
        
        // Apply FK patterns
        const fkPattern = patternMemory.fkPatterns[pattern];
        if (fkPattern && fkPattern.confidence >= 0.8 && !col.isForeignKey) {
            enhancedCol.isForeignKey = true;
            enhancedCol._patternMemoryFK = true;
            enhancedCol._patternMemoryFKConfidence = fkPattern.confidence;
            appliedCount++;
        }
        
        return enhancedCol;
    });
    
    if (appliedCount > 0) {
        logger.info({
            applied: appliedCount,
            total: metadata.length
        }, '🧠 Applied pattern memory to metadata');
    }
    
    return enhanced;
}

/**
 * Get pattern memory statistics
 */
export function getPatternMemoryStats() {
    return {
        dataTypes: Object.keys(patternMemory.dataTypes).length,
        pkPatterns: Object.keys(patternMemory.pkPatterns).length,
        fkPatterns: Object.keys(patternMemory.fkPatterns).length,
        relationships: patternMemory.relationships.length,
        optimizations: patternMemory.optimizations.length,
        lastUpdated: patternMemory.lastUpdated
    };
}

/**
 * Learn relationship pattern
 */
export function learnRelationship(fromTable, toTable, pattern, confidence) {
    const existing = patternMemory.relationships.find(
        r => r.from === fromTable && r.to === toTable && r.pattern === pattern
    );
    
    if (existing) {
        existing.confidence = (
            (existing.confidence * existing.count) + confidence
        ) / (existing.count + 1);
        existing.count += 1;
    } else {
        patternMemory.relationships.push({
            from: fromTable,
            to: toTable,
            pattern,
            confidence,
            count: 1
        });
    }
    
    savePatternMemory();
}

/**
 * Learn optimization suggestion
 */
export function learnOptimization(table, column, suggestion, impact) {
    patternMemory.optimizations.push({
        table,
        column,
        suggestion,
        impact,
        timestamp: new Date().toISOString()
    });
    
    // Keep only last 100 optimizations
    if (patternMemory.optimizations.length > 100) {
        patternMemory.optimizations = patternMemory.optimizations.slice(-100);
    }
    
    savePatternMemory();
}

// Initialize on module load
loadPatternMemory();
