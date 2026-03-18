/**
 * Complete Logical Model Generator
 * Generates logical data model (LDM) with LLM enhancement
 * Outputs: DBML, Logical ERD (PNG/SVG), Logical JSON
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getMetadata } from './src/storage/fileStorage.js';
import { generateDBML, saveDBML } from './src/generators/dbmlGenerator.js';
import { ensureFolders } from './src/utils/folderOrganizer.js';
// Diagram generation removed - only Interactive HTML viewer is used
import { writeFile } from 'fs/promises';
import config from './src/config/index.js';
import { mapToLogicalType } from './src/generators/logicalTypeMapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const COLORS = {
    RESET: '\x1b[0m',
    BOLD: '\x1b[1m',
    CYAN: '\x1b[36m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    RED: '\x1b[31m'
};

function log(msg) {
    console.log(msg);
}

function progress(step, total, message) {
    log(`[${step}/${total}] ${message}...`);
}

function success(msg) {
    log(`   ${COLORS.GREEN}✓${COLORS.RESET} ${msg}`);
}

function error(msg) {
    log(`   ${COLORS.RED}✗${COLORS.RESET} ${msg}`);
}

async function loadMetadata(fileId) {
    const metadata = await getMetadata(fileId);
    
    if (!metadata) {
        throw new Error(`No metadata found for fileId: ${fileId}. Upload file first.`);
    }
    
    return metadata;
}

async function generateLogical(fileId) {
    log(`\n${COLORS.BOLD}${COLORS.CYAN}📊 COMPLETE LOGICAL MODEL GENERATOR${COLORS.RESET}\n`);
    log(`File ID: ${fileId}`);
    log(`Mode: ${COLORS.BOLD}LOGICAL DATA MODEL (LDM)${COLORS.RESET} - Conceptual level only\n`);
    
    const startTime = Date.now();
    const outputDir = path.join(config.storage.artifactsDir, fileId);
    
    // Create organized folders
    const paths = await ensureFolders(fileId);
    
    const results = { files: [], errors: [] };
    
    try {
        // Step 1: Load metadata
        progress(1, 5, 'Loading metadata');
        let metadata = await loadMetadata(fileId);
        const tableCount = metadata.metadata?.tableCount || 0;
        const totalColumns = metadata.metadata?.rowCount || 0;
        success(`Loaded: ${tableCount} entities, ${totalColumns} attributes`);
        
        // Step 2: Generate Logical DBML (with LLM enhancement)
        progress(2, 5, 'Generating Logical DBML with LLM enhancement');
        try {
            const dbmlPath = path.join(paths.dbml, 'schema.dbml');
            const { existsSync } = await import('fs');
            
            if (!existsSync(dbmlPath)) {
                const dbmlContent = await generateDBML(metadata, true); // Use LLM enhancement
                const savedPath = await saveDBML(fileId, dbmlContent);
                results.files.push({ name: 'schema.dbml', path: savedPath, size: dbmlContent.length });
                success('schema.dbml');
            } else {
                log(`   ${COLORS.YELLOW}⊘${COLORS.RESET} DBML already exists, skipping`);
            }
        } catch (err) {
            error(`DBML generation failed: ${err.message}`);
            results.errors.push({ type: 'dbml', error: err.message });
        }
        console.log();
        
        // Step 3: Generate Logical ERD diagrams (PNG + SVG)
        progress(3, 5, 'Generating Logical ERD diagrams (PNG + SVG)');
        try {
            const dbmlPath = path.join(paths.dbml, 'schema.dbml');
            const { existsSync } = await import('fs');
            
            if (!existsSync(dbmlPath)) {
                throw new Error('DBML file not found. Generate DBML first.');
            }
            
            // Diagram generation removed - only Interactive HTML viewer is used
            console.log('  ⏭️  Skipping static diagram generation (PNG/SVG/PDF)');
            console.log('  ℹ️  Use Interactive HTML viewer instead: artifacts/' + fileId + '/executive/erd_INTERACTIVE.html');
        } catch (err) {
            // Ignore diagram generation errors since we're not generating them
            console.log('  ⏭️  Diagram generation skipped');
        }
        console.log();
        
        // Step 4: Generate Logical JSON (internal representation)
        progress(4, 5, 'Generating Logical JSON representation');
        try {
            const jsonPath = path.join(paths.logical, 'logical.json');
            const { existsSync } = await import('fs');
            
            if (!existsSync(jsonPath)) {
                // Create logical model JSON representation
                const logicalModel = {
                    fileId: metadata.fileId,
                    originalName: metadata.originalName,
                    generatedAt: new Date().toISOString(),
                    modelType: 'logical',
                    entities: {}
                };
                
                const tables = metadata.metadata?.tables || {};
                for (const [tableName, tableData] of Object.entries(tables)) {
                    logicalModel.entities[tableName] = {
                        description: tableData.description || tableData._llmDescription || null,
                        attributes: (tableData.columns || []).map(col => ({
                            name: col.columnName,
                            logicalType: col._llmLogicalType || mapToLogicalType(col.dataType),
                            description: col._llmDescription || col.description || null,
                            isPrimaryKey: col.isPrimaryKey || false,
                            isDerived: col._llmIsDerived || false,
                            businessRule: col._llmBusinessRule || null
                        })),
                        relationships: tableData._llmRelationships || []
                    };
                }
                
                await writeFile(jsonPath, JSON.stringify(logicalModel, null, 2), 'utf-8');
                results.files.push({ name: 'logical.json', path: jsonPath });
                success('logical.json');
            } else {
                log(`   ${COLORS.YELLOW}⊘${COLORS.RESET} Logical JSON already exists, skipping`);
            }
        } catch (err) {
            error(`Logical JSON generation failed: ${err.message}`);
            results.errors.push({ type: 'json', error: err.message });
        }
        console.log();
        
        // Step 5: Summary
        progress(5, 5, 'Generation complete');
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        log(`\n${COLORS.GREEN}${COLORS.BOLD}✓ GENERATION COMPLETE!${COLORS.RESET}\n`);
        log(`${COLORS.CYAN}📊 Summary:${COLORS.RESET}`);
        log(`   Entities: ${tableCount}`);
        log(`   Attributes: ${totalColumns}`);
        log(`   Files Generated: ${results.files.length}`);
        log(`   Errors: ${results.errors.length}`);
        log(`   Time: ${elapsed}s\n`);
        
        log(`${COLORS.CYAN}📁 Generated Files:${COLORS.RESET}`);
        for (const file of results.files) {
            const size = file.size ? ` (${(file.size / 1024).toFixed(2)} KB)` : '';
            const gen = file.generator ? ` - ${file.generator}` : '';
            log(`   ${COLORS.GREEN}✓${COLORS.RESET} ${file.name}${size}${gen}`);
        }
        
        if (results.errors.length > 0) {
            log(`\n${COLORS.YELLOW}⚠ Errors:${COLORS.RESET}`);
            for (const err of results.errors) {
                log(`   ${COLORS.RED}✗${COLORS.RESET} ${err.type}: ${err.error}`);
            }
        }
        
        return {
            success: results.errors.length === 0,
            files: results.files,
            errors: results.errors
        };
        
    } catch (err) {
        error(`Generation failed: ${err.message}`);
        throw err;
    }
}

// Main execution
const fileId = process.argv[2];

if (!fileId) {
    console.error('Usage: node generate-logical.js <fileId>');
    process.exit(1);
}

generateLogical(fileId)
    .then(result => {
        process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
        console.error(`\n${COLORS.RED}Fatal error:${COLORS.RESET} ${err.message}`);
        process.exit(1);
    });

