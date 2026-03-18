/**
 * File Watcher Utility
 * Automatically processes files dropped into the watch directory
 * Mimics the upload endpoint functionality for automatic processing
 */

import { watch } from 'fs';
import { stat, rename, unlink, readdir } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import config from '../config/index.js';
import { parseMetadataFile } from '../parsers/index.js';
import { getInferenceStats } from '../heuristics/index.js';
import { getLLMStatus } from '../llm/index.js';
import { saveMetadata } from '../storage/fileStorage.js';
import { spawn } from 'child_process';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track files being processed to avoid duplicate processing
const processingFiles = new Set();

// Track fileIds that are currently generating to prevent duplicate generation
const generatingFileIds = new Set();

/**
 * Generate interactive dual HTML visualization (DATA_MODEL_DUAL_ENHANCED.html)
 * This creates the interactive ERD viewer that Phase-2 expects
 * Runs dynamically for every processed fileId
 * Can also be called manually: generateInteractiveHTML(fileId)
 */
export async function generateInteractiveHTML(fileId) {
    // Prevent duplicate generation for the same fileId
    if (generatingFileIds.has(fileId)) {
        logger.warn({ fileId }, '⚠️ Generate already running for this fileId, skipping duplicate');
        console.log(`⚠️ Generate command already running for fileId: ${fileId}, skipping...\n`);
        return { success: false, error: 'Already generating' };
    }
    
    generatingFileIds.add(fileId);
    
    return new Promise((resolve) => {
        // Resolve path: Phase-1/src/utils -> Phase-1 -> AGENT-POC-2 -> Phase-2
        const phase2Dir = join(__dirname, '..', '..', '..', 'Phase-2');
        const phase2Script = join(phase2Dir, 'generate.js');
        
        // Verify generate.js exists
        if (!existsSync(phase2Script)) {
            generatingFileIds.delete(fileId);
            const errorMsg = `generate.js not found at: ${phase2Script}`;
            logger.error({ fileId, phase2Script, __dirname }, errorMsg);
            console.error(`\n❌ ${errorMsg}`);
            console.error(`   Current __dirname: ${__dirname}`);
            console.error(`   Looking for Phase-2 at: ${phase2Dir}\n`);
            resolve({ success: false, error: errorMsg });
            return;
        }
        
        logger.info({ fileId, script: phase2Script, cwd: phase2Dir }, '🎨 Running: node generate.js ' + fileId);
        console.log(`\n🎨 Running: node generate.js ${fileId}`);
        console.log(`   Script: ${phase2Script}`);
        console.log(`   Working Directory: ${phase2Dir}`);
        console.log(`   This will generate both Interactive HTML and MySQL DDL...\n`);
        
        // Use spawn with proper Windows handling
        // IMPORTANT: Use array format with shell:true for Windows compatibility
        console.log(`   Executing: node "${phase2Script}" ${fileId}`);
        console.log(`   Working directory: ${phase2Dir}`);
        console.log(`   Script path: ${phase2Script}`);
        console.log(`   File ID: ${fileId}\n`);
        
        // Spawn the process - use array format which works better cross-platform
        // IMPORTANT: Use detached: false to ensure process completes properly
        const nodeProcess = spawn('node', [phase2Script, fileId], {
            cwd: phase2Dir,
            shell: true, // Use shell for Windows compatibility (handles paths better)
            stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr
            detached: false, // Keep attached to parent process
            windowsHide: false // Show window on Windows (for debugging)
        });
        
        let stdout = '';
        let stderr = '';
        let outputStarted = false;
        
        // Capture and display output in real-time
        if (nodeProcess.stdout) {
            nodeProcess.stdout.on('data', (data) => {
                outputStarted = true;
                const output = data.toString();
                stdout += output;
                // Display output immediately with prefix to identify it
                process.stdout.write(`[GENERATE] ${output}`);
            });
        }
        
        if (nodeProcess.stderr) {
            nodeProcess.stderr.on('data', (data) => {
                outputStarted = true;
                const output = data.toString();
                stderr += output;
                // Display errors immediately with prefix
                process.stderr.write(`[GENERATE-ERR] ${output}`);
            });
        }
        
        // Log when process actually starts
        nodeProcess.on('spawn', () => {
            console.log(`[GENERATE] Process spawned successfully (PID: ${nodeProcess.pid})\n`);
        });
        
        let timeout;
        
        const cleanup = () => {
            generatingFileIds.delete(fileId);
            if (timeout) clearTimeout(timeout);
        };
        
        nodeProcess.on('close', (code, signal) => {
            cleanup();
            console.log(`\n[GENERATE] Process closed - Exit code: ${code}, Signal: ${signal || 'none'}`);
            console.log(`[GENERATE] Output received: ${outputStarted ? 'Yes' : 'No'}`);
            console.log(`[GENERATE] stdout length: ${stdout.length}, stderr length: ${stderr.length}\n`);
            
            if (code === 0) {
                logger.info({ fileId }, '✅ node generate.js completed successfully - HTML and DDL generated');
                console.log(`✅ ========================================`);
                console.log(`✅ Generate command completed successfully for fileId: ${fileId}`);
                if (stdout) {
                    console.log(`✅ Output:\n${stdout.substring(0, 500)}`);
                }
                console.log(`✅ ========================================\n`);
                resolve({ success: true, output: stdout });
            } else {
                const errorMsg = stderr || stdout || 'Unknown error';
                logger.error({ fileId, code, signal, stderr: errorMsg.substring(0, 500) }, '❌ node generate.js failed');
                console.error(`\n❌ ========================================`);
                console.error(`❌ Error running node generate.js ${fileId}`);
                console.error(`❌ Exit code: ${code}, Signal: ${signal || 'none'}`);
                console.error(`❌ Error output:\n${errorMsg.substring(0, 1000)}`);
                console.error(`❌ ========================================\n`);
                resolve({ success: false, error: errorMsg, code });
            }
        });
        
        nodeProcess.on('error', (err) => {
            cleanup();
            const errorMsg = `Failed to spawn process: ${err.message}`;
            logger.error({ error: err.message, fileId, phase2Script, phase2Dir }, '⚠️ Failed to spawn node generate.js');
            console.error(`\n❌ ${errorMsg}`);
            console.error(`   Script path: ${phase2Script}`);
            console.error(`   Working dir: ${phase2Dir}\n`);
            resolve({ success: false, error: errorMsg });
        });
        
        // Add timeout to prevent hanging (5 minutes)
        timeout = setTimeout(() => {
            if (!nodeProcess.killed) {
                nodeProcess.kill();
                cleanup();
                const timeoutMsg = 'Process timed out after 5 minutes';
                logger.error({ fileId }, timeoutMsg);
                console.error(`\n❌ ${timeoutMsg}\n`);
                resolve({ success: false, error: timeoutMsg });
            }
        }, 300000);
    });
}

/**
 * Process a file dropped into the watch directory
 * Similar to upload middleware but without HTTP request/response
 */
async function processFile(filePath) {
    const fileName = basename(filePath);
    
    // Skip if already processing
    if (processingFiles.has(filePath)) {
        logger.debug({ filePath }, 'File already being processed, skipping');
        return;
    }
    
    // Check file extension
    const ext = extname(fileName).toLowerCase();
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    if (!allowedExtensions.includes(ext)) {
        logger.warn({ fileName, ext }, '⚠️ Unsupported file type in watch directory');
        return;
    }
    
    processingFiles.add(filePath);
    
    try {
        // Wait a bit to ensure file is fully written
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify file exists and is readable
        const stats = await stat(filePath);
        if (!stats.isFile()) {
            logger.warn({ filePath }, '⚠️ Path is not a file');
            processingFiles.delete(filePath);
            return;
        }
        
        logger.info({ fileName, size: stats.size }, '📄 Processing file from watch directory...');
        
        // Generate dynamic fileId (timestamp) - unique for each processed file
        // This fileId will be used to create the artifacts folder and run: node generate.js <fileId>
        const fileId = Date.now().toString();
        
        // Parse metadata from file
        const metadata = await parseMetadataFile(filePath, fileName);
        const inference = getInferenceStats(metadata);
        
        // Transform metadata into hierarchical structure (Domain → Sub-domain → Entity → Attributes)
        const hierarchicalStructure = {};
        const tablesMap = {};
        
        metadata.forEach(col => {
            const domain = col.domain || 'Other';
            const subDomain = col.subDomain || 'General';
            const entityName = col.entityName || col.tableName;
            const entityDesc = col.entityDescription;
            
            // Build hierarchical structure
            if (!hierarchicalStructure[domain]) {
                hierarchicalStructure[domain] = {};
            }
            if (!hierarchicalStructure[domain][subDomain]) {
                hierarchicalStructure[domain][subDomain] = {};
            }
            if (!hierarchicalStructure[domain][subDomain][entityName]) {
                hierarchicalStructure[domain][subDomain][entityName] = {
                    entityName: entityName,
                    entityDescription: entityDesc,
                    attributes: []
                };
            }
            
            hierarchicalStructure[domain][subDomain][entityName].attributes.push({
                attributeName: col.attributeName || col.columnName,
                attributeDescription: col.attributeDescription || col.description,
                dataType: col.dataType,
                isPrimaryKey: col.isPrimaryKey,
                isForeignKey: col.isForeignKey,
                referencesTable: col.referencesTable,
                referencesColumn: col.referencesColumn,
                nullable: col.nullable,
                isUnique: col.isUnique,
                domain: domain,
                subDomain: subDomain
            });
            
            // Also build backward-compatible table-grouped structure
            if (!tablesMap[col.tableName]) {
                tablesMap[col.tableName] = {
                    tableName: col.tableName,
                    entityName: entityName,
                    entityDescription: entityDesc,
                    domain: domain,
                    subDomain: subDomain,
                    columns: []
                };
            }
            tablesMap[col.tableName].columns.push({
                ...col,
                attributeName: col.attributeName || col.columnName,
                attributeDescription: col.attributeDescription || col.description
            });
        });
        
        // Prepare metadata document
        const metadataDocument = {
            fileId,
            originalName: fileName,
            uploadedAt: new Date().toISOString(),
            fileSize: stats.size,
            filePath: filePath,
            metadata: {
                rowCount: metadata.length,
                tableCount: Object.keys(tablesMap).length,
                tables: tablesMap,
                hierarchical: hierarchicalStructure
            },
            inference,
            llmStatus: getLLMStatus(),
            artifacts: {
                dbml: { generated: false },
                sql_postgres: { generated: false },
                sql_snowflake: { generated: false },
                erd_png: { generated: false },
                erd_svg: { generated: false }
            },
            createdAt: new Date().toISOString()
        };
        
        // Save metadata to disk (artifacts/<fileId>/json/metadata.json)
        await saveMetadata(fileId, metadataDocument);
        logger.info({ fileId, tables: Object.keys(tablesMap).length }, '✅ Metadata saved to artifacts folder');
        
        // Verify metadata file exists before generating HTML
        const metadataFilePath = join(config.storage.artifactsDir, fileId, 'json', 'metadata.json');
        if (!existsSync(metadataFilePath)) {
            logger.error({ fileId, metadataFilePath }, '❌ Metadata file not found after save - cannot generate HTML');
            throw new Error(`Metadata file not found at ${metadataFilePath}`);
        }
        
        // Wait a moment to ensure file is fully written to disk
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Move processed file to "processed" subdirectory FIRST to prevent watcher from picking it up again
        const processedDir = join(config.storage.watchDir, 'processed');
        if (!existsSync(processedDir)) {
            mkdirSync(processedDir, { recursive: true });
        }
        
        const processedFilePath = join(processedDir, `${fileId}_${fileName}`);
        try {
            await rename(filePath, processedFilePath);
            logger.info({ fileName, fileId, processedPath: processedFilePath }, '✅ File moved to processed folder (before generation)');
        } catch (renameErr) {
            // If rename fails (file might have been moved already), log and continue
            logger.warn({ error: renameErr.message, filePath }, '⚠️ Could not move file to processed (may already be moved)');
        }
        
        // Generate interactive HTML and MySQL DDL automatically (one flow)
        // This runs dynamically: node generate.js <fileId> from Phase-2 directory
        // The fileId is generated dynamically for each processed file
        // IMPORTANT: This MUST run for every processed file
        logger.info({ fileId }, '🎨 Starting automatic generation: node generate.js ' + fileId);
        console.log(`\n🔄 ========================================`);
        console.log(`🔄 Watcher AUTOMATICALLY running: node generate.js ${fileId}`);
        console.log(`🔄 ========================================`);
        console.log(`   Metadata file exists: ${existsSync(metadataFilePath)}`);
        console.log(`   Metadata path: ${metadataFilePath}`);
        console.log(`   File ID: ${fileId}`);
        console.log(`   Starting generation NOW...\n`);
        
        try {
            const result = await generateInteractiveHTML(fileId);
            
            if (result && result.success) {
                logger.info({ fileId }, '✅ node generate.js completed successfully');
                console.log(`\n✅ ========================================`);
                console.log(`✅ Generate command COMPLETED successfully for fileId: ${fileId}`);
                console.log(`✅ ========================================\n`);
            } else {
                // Skip if already generating (duplicate call prevented)
                if (result && result.error === 'Already generating') {
                    console.log(`⚠️ Generate already in progress for fileId: ${fileId}, skipping...\n`);
                    return; // Exit early, file already being processed
                }
                
                const errorMsg = result?.error || 'Unknown error';
                const exitCode = result?.code;
                
                logger.error({ fileId, error: errorMsg, code: exitCode }, '❌ node generate.js FAILED');
                console.log(`\n❌ ========================================`);
                console.log(`❌ Generate command FAILED for fileId: ${fileId}`);
                console.log(`❌ ========================================`);
                console.log(`   Error: ${errorMsg.substring(0, 500)}`);
                if (exitCode !== undefined) {
                    console.log(`   Exit code: ${exitCode}`);
                }
                console.log(`\n⚠️  NOTE: You may need to run manually: node generate.js ${fileId}\n`);
            }
        } catch (err) {
            logger.error({ error: err.message, stack: err.stack, fileId }, '❌ EXCEPTION running node generate.js');
            console.log(`\n❌ ========================================`);
            console.log(`❌ EXCEPTION running generate command for fileId: ${fileId}`);
            console.log(`❌ ========================================`);
            console.log(`   Error: ${err.message}`);
            if (err.stack) {
                console.log(`   Stack: ${err.stack.substring(0, 500)}`);
            }
            console.log(`\n⚠️  NOTE: You may need to run manually: node generate.js ${fileId}\n`);
        }
        
        console.log(`\n✅ File processed successfully!`);
        console.log(`   File: ${fileName}`);
        console.log(`   File ID: ${fileId}`);
        console.log(`   Tables: ${Object.keys(tablesMap).length}`);
        console.log(`   Interactive HTML: http://localhost:${config.server.port}/artifacts/${fileId}/executive/DATA_MODEL_DUAL_ENHANCED.html`);
        console.log(`   MySQL DDL: http://localhost:${config.server.port}/artifacts/${fileId}/physical/mysql.sql\n`);
        
    } catch (error) {
        logger.error({ error: error.message, filePath }, '❌ Error processing file from watch directory');
        console.error(`\n❌ Error processing ${fileName}: ${error.message}\n`);
    } finally {
        processingFiles.delete(filePath);
    }
}

/**
 * Start watching the watch directory for new files
 */
export async function startFileWatcher() {
    const watchDir = config.storage.watchDir;
    
    // Create watch directory if it doesn't exist
    if (!existsSync(watchDir)) {
        mkdirSync(watchDir, { recursive: true });
        logger.info({ watchDir }, '📁 Created watch directory');
    }
    
    logger.info({ watchDir }, '👀 Starting file watcher...');
    console.log(`\n👀 File Watcher Active!`);
    console.log(`   Watch Directory: ${watchDir}`);
    console.log(`   Supported formats: .xlsx, .xls, .csv`);
    console.log(`   Drop files here to automatically process them!`);
    console.log(`   Watching for new files (polling every 5 seconds as backup)...\n`);
    
    // Log existing files in watch directory
    try {
        const existingFiles = await readdir(watchDir);
        const files = existingFiles.filter(f => f !== 'processed');
        if (files.length > 0) {
            console.log(`   Found ${files.length} existing file(s) in watch directory:`);
            files.forEach(f => console.log(`     - ${f}`));
            console.log('');
        }
    } catch (err) {
        // Ignore if directory is empty or doesn't exist yet
    }
    
    // Track files we've already processed to avoid duplicates
    const processedFiles = new Set();
    
    // Function to check and process new files
    const checkForNewFiles = async () => {
        try {
            const files = await readdir(watchDir);
            const processedDir = join(watchDir, 'processed');
            
            for (const file of files) {
                // Skip processed directory
                if (file === 'processed') continue;
                
                const filePath = join(watchDir, file);
                
                // Skip if already being processed
                if (processingFiles.has(filePath)) {
                    continue;
                }
                
                try {
                    const stats = await stat(filePath);
                    
                    // Skip if file doesn't exist (might have been moved)
                    if (!stats.isFile()) continue;
                    
                    const fileKey = `${file}_${stats.mtimeMs}`;
                    
                    // Skip if already processed
                    if (processedFiles.has(fileKey)) continue;
                    
                    const ext = extname(file).toLowerCase();
                    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
                        processedFiles.add(fileKey);
                        logger.info({ fileName: file }, '📄 New file detected in watch directory');
                        // Process file asynchronously
                        processFile(filePath).catch(err => {
                            logger.error({ error: err.message, filePath }, 'Error in processFile');
                            processedFiles.delete(fileKey); // Allow retry on error
                        });
                    }
                } catch (err) {
                    if (err.code !== 'ENOENT') {
                        logger.debug({ error: err.message, filePath }, 'File stat error (ignored)');
                    }
                }
            }
        } catch (err) {
            logger.debug({ error: err.message }, 'Error checking watch directory');
        }
    };
    
    // Initial check for existing files
    await checkForNewFiles();
    
    // Watch for file changes (Windows-friendly)
    const watcher = watch(watchDir, { recursive: false }, async (eventType, filename) => {
        if (!filename) return;
        
        // Skip processed directory
        if (filename === 'processed') return;
        
        const filePath = join(watchDir, filename);
        
        // Skip if already being processed
        if (processingFiles.has(filePath)) {
            return;
        }
        
        // On Windows, file creation often triggers 'rename' event
        if (eventType === 'rename' || eventType === 'change') {
            // Wait a bit for file to be fully written (especially on Windows)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            try {
                const stats = await stat(filePath);
                
                // Skip if file doesn't exist (might have been moved to processed)
                if (!stats.isFile()) return;
                
                const ext = extname(filename).toLowerCase();
                if (['.xlsx', '.xls', '.csv'].includes(ext)) {
                    const fileKey = `${filename}_${stats.mtimeMs}`;
                    
                    // Skip if already processed or currently processing
                    if (processedFiles.has(fileKey) || processingFiles.has(filePath)) {
                        return;
                    }
                    
                    processedFiles.add(fileKey);
                    logger.info({ fileName: filename, eventType }, '📄 File detected via watcher');
                    // Process file asynchronously
                    processFile(filePath).catch(err => {
                        logger.error({ error: err.message, filePath }, 'Error in processFile');
                        processedFiles.delete(fileKey); // Allow retry on error
                    });
                }
            } catch (err) {
                // File doesn't exist (was deleted or moved), ignore
                if (err.code !== 'ENOENT') {
                    logger.debug({ error: err.message, filePath }, 'File stat error (ignored)');
                }
            }
        }
    });
    
    // Also poll every 5 seconds as backup (Windows fs.watch can be unreliable)
    const pollInterval = setInterval(checkForNewFiles, 5000);
    
    // Store watcher and interval for cleanup if needed
    watcher.on('error', (err) => {
        logger.error({ error: err.message }, 'File watcher error');
    });
    
    // Cleanup function (can be called if needed)
    const stopWatcher = () => {
        watcher.close();
        clearInterval(pollInterval);
    };
    
    logger.info({ watchDir }, '✅ File watcher started successfully');
}
