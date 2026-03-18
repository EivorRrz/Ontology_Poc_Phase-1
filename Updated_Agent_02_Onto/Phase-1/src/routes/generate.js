/**
 * @Module Generate Route
 * @Description API endpoint to automatically generate logical models and ERD pictures
 */

import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getMetadata } from '../storage/fileStorage.js';
import { generateDBML, saveDBML } from '../generators/dbmlGenerator.js';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Call Phase-2 to generate MySQL physical models
 */
async function generatePhysicalModels(fileId) {
    return new Promise((resolve, reject) => {
        const phase2Dir = path.join(__dirname, '..', '..', '..', 'Phase-2');
        const phase2Script = path.join(phase2Dir, 'src', 'index.js');
        
        logger.info({ fileId }, '🐍 Calling Phase-2: MySQL Physical Model Generator...');
        
        const nodeProcess = spawn('node', [phase2Script, fileId], {
            cwd: phase2Dir,
            shell: true
        });
        
        let stdout = '';
        let stderr = '';
        
        nodeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            logger.info(output.trim());
        });
        
        nodeProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        nodeProcess.on('close', (code) => {
            if (code === 0) {
                logger.info({ fileId }, '✅ Phase-2 completed successfully');
                resolve({ success: true, output: stdout });
            } else {
                logger.warn({ fileId, code, stderr }, '⚠️ Phase-2 failed');
                reject(new Error(`Phase-2 failed with code ${code}: ${stderr}`));
            }
        });
        
        nodeProcess.on('error', (err) => {
            logger.error({ error: err.message, fileId }, '❌ Failed to spawn Phase-2 process');
            reject(err);
        });
    });
}

/**
 * POST /generate/logical/:fileId
 * Generate logical model only (DBML + ERD diagrams)
 */
router.post('/logical/:fileId', async (req, res) => {
    const { fileId } = req.params;
    
    try {
        logger.info({ fileId }, 'Generating logical model (DBML + ERD diagrams)...');
        
        // Step 1: Load metadata
        const metadata = await getMetadata(fileId);
        
        if (!metadata) {
            return res.status(404).json({
                error: 'Not-Found',
                message: `No metadata found for fileId: ${fileId}. Upload file first using POST /upload/ingest`
            });
        }
        
        const results = {
            fileId,
            generated: {},
            errors: []
        };
        
        // Step 2: Generate DBML (with LLM enhancement)
        try {
            const dbmlPath = path.join(config.storage.artifactsDir, fileId, 'dbml', 'schema.dbml');
            const { existsSync } = await import('fs');
            
            if (!existsSync(dbmlPath)) {
                logger.info({ fileId }, 'Generating Logical DBML with LLM enhancement...');
                const dbmlContent = await generateDBML(metadata, true); // Use LLM enhancement
                const savedPath = await saveDBML(fileId, dbmlContent);
                
                results.generated.dbml = {
                    path: savedPath,
                    size: dbmlContent.length
                };
                
                logger.info({ fileId }, '✅ DBML generated successfully');
            } else {
                logger.info({ fileId }, 'DBML already exists, skipping');
                results.generated.dbml = { path: dbmlPath, exists: true };
            }
        } catch (error) {
            logger.error({ error: error.message, fileId }, '❌ DBML generation failed');
            results.errors.push({
                type: 'dbml',
                error: error.message
            });
        }
        
        // Step 3: Diagram generation removed - only Interactive HTML viewer is used
        logger.info({ fileId }, 'Skipping static diagram generation (PNG/SVG/PDF) - using Interactive HTML viewer only');
        
        // Return results
        const status = results.errors.length === 0 ? 'success' : 'partial';
        const statusCode = results.errors.length === 0 ? 200 : 207;
        
        logger.info({ fileId, status, errorCount: results.errors.length }, 'Logical model generation complete');
        
        res.status(statusCode).json({
            status,
            message: 'Logical model (DBML + ERD diagrams) generated',
            fileId,
            artifacts: {
                logical: {
                    dbml: results.generated.dbml?.path || null,
                    note: 'Static diagrams (PNG/SVG/PDF) removed - use Interactive HTML viewer instead'
                }
            },
            errors: results.errors.length > 0 ? results.errors : undefined
        });
        
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack, fileId }, 'Logical model generation failed');
        
        res.status(500).json({
            error: 'Internal-Server-Error',
            message: error.message,
            fileId
        });
    }
});

/**
 * POST /generate/physical/:fileId
 * Generate physical model only (MySQL SQL)
 */
router.post('/physical/:fileId', async (req, res) => {
    const { fileId } = req.params;
    
    try {
        logger.info({ fileId }, 'Generating physical model (MySQL SQL)...');
        
        // Step 1: Load metadata
        const metadata = await getMetadata(fileId);
        
        if (!metadata) {
            return res.status(404).json({
                error: 'Not-Found',
                message: `No metadata found for fileId: ${fileId}. Upload file first using POST /upload/ingest`
            });
        }
        
        const results = {
            fileId,
            generated: {},
            errors: []
        };
        
        // Step 2: Generate Physical Models (Phase-2)
        try {
            logger.info({ fileId }, 'Generating MySQL physical models (Phase-2)...');
            const phase2Dir = path.join(__dirname, '..', '..', '..', 'Phase-2');
            const phase2Script = path.join(phase2Dir, 'generate-complete.js');
            
            let stdout = '';
            let stderr = '';
            
            await new Promise((resolve, reject) => {
                const nodeProcess = spawn('node', [phase2Script, fileId], {
                    cwd: phase2Dir,
                    shell: true,
                    stdio: 'pipe'
                });
                
                nodeProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                nodeProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                
                nodeProcess.on('close', (code) => {
                    if (code === 0) {
                        logger.info({ fileId, stdout: stdout.substring(0, 500) }, '✅ Physical models generated successfully');
                        resolve();
                    } else {
                        logger.warn({ fileId, code, stderr: stderr.substring(0, 500) }, '⚠️ Physical model generation failed');
                        reject(new Error(`Phase-2 failed with code ${code}: ${stderr.substring(0, 200)}`));
                    }
                });
                
                nodeProcess.on('error', (err) => {
                    logger.error({ error: err.message, fileId }, '❌ Failed to spawn Phase-2');
                    reject(err);
                });
            });
            
            // Verify files were actually created
            const { existsSync } = await import('fs');
            const physicalDir = path.join(config.storage.artifactsDir, fileId, 'physical');
            const executiveDir = path.join(config.storage.artifactsDir, fileId, 'executive');
            
            const mysqlSqlPath = path.join(physicalDir, 'mysql.sql');
            const erdPngPath = path.join(physicalDir, 'erd.png');
            const erdSvgPath = path.join(physicalDir, 'erd.svg');
            const execReportPath = path.join(executiveDir, 'EXECUTIVE_REPORT.html');
            const interactivePath = path.join(executiveDir, 'erd_INTERACTIVE.html');
            
            const physicalFiles = {};
            if (existsSync(mysqlSqlPath)) {
                physicalFiles.mysql_sql = `artifacts/${fileId}/physical/mysql.sql`;
            }
            if (existsSync(erdPngPath)) {
                physicalFiles.erd_png = `artifacts/${fileId}/physical/erd.png`;
            }
            if (existsSync(erdSvgPath)) {
                physicalFiles.erd_svg = `artifacts/${fileId}/physical/erd.svg`;
            }
            if (existsSync(execReportPath)) {
                physicalFiles.executive_report = `artifacts/${fileId}/executive/EXECUTIVE_REPORT.html`;
            }
            if (existsSync(interactivePath)) {
                physicalFiles.interactive = `artifacts/${fileId}/executive/erd_INTERACTIVE.html`;
            }
            
            if (Object.keys(physicalFiles).length === 0) {
                throw new Error('No physical model files were generated. Check Phase-2 logs.');
            }
            
            results.generated.physical = physicalFiles;
        } catch (error) {
            logger.warn({ error: error.message, fileId }, '⚠️ Physical model generation failed');
            results.errors.push({
                type: 'physical',
                error: error.message
            });
        }
        
        // Return results
        const status = results.errors.length === 0 ? 'success' : 'partial';
        const statusCode = results.errors.length === 0 ? 200 : 207;
        
        logger.info({ fileId, status, errorCount: results.errors.length }, 'Physical model generation complete');
        
        res.status(statusCode).json({
            status,
            message: 'Physical model (MySQL SQL) generated',
            fileId,
            artifacts: {
                physical: results.generated.physical || null
            },
            errors: results.errors.length > 0 ? results.errors : undefined
        });
        
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack, fileId }, 'Physical model generation failed');
        
        res.status(500).json({
            error: 'Internal-Server-Error',
            message: error.message,
            fileId
        });
    }
});

/**
 * POST /generate/:fileId
 * Generate all artifacts (logical + physical)
 */
router.post('/:fileId', async (req, res) => {
    const { fileId } = req.params;
    
    try {
        logger.info({ fileId }, 'Starting artifact generation...');
        
        // Step 1: Load metadata
        const metadata = await getMetadata(fileId);
        
        if (!metadata) {
            return res.status(404).json({
                error: 'Not-Found',
                message: `No metadata found for fileId: ${fileId}`
            });
        }
        
        const results = {
            fileId,
            generated: {},
            errors: []
        };
        
        // Step 2: Generate DBML (Logical Model) - Only if not already generated
        try {
            const dbmlPath = path.join(config.storage.artifactsDir, fileId, 'dbml', 'schema.dbml');
            const { existsSync } = await import('fs');
            
            if (!existsSync(dbmlPath)) {
                logger.info({ fileId }, 'Generating DBML...');
                const dbmlContent = await generateDBML(metadata);
                const savedPath = await saveDBML(fileId, dbmlContent);
                
                results.generated.dbml = {
                    path: savedPath,
                    size: dbmlContent.length
                };
                
                logger.info({ fileId }, '✅ DBML generated successfully');
            } else {
                logger.info({ fileId }, 'DBML already exists, skipping');
                results.generated.dbml = { path: dbmlPath, exists: true };
            }
        } catch (error) {
            logger.error({ error: error.message, fileId }, '❌ DBML generation failed');
            results.errors.push({
                type: 'dbml',
                error: error.message
            });
        }
        
        // Step 3: Diagram generation removed - only Interactive HTML viewer is used
        logger.info({ fileId }, 'Skipping static diagram generation (PNG/SVG/PDF) - using Interactive HTML viewer only');
        
        // Step 4: Generate Physical Models (Phase-2) - Use generate-complete.js
        try {
            logger.info({ fileId }, 'Generating MySQL physical models (Phase-2)...');
            const phase2Dir = path.join(__dirname, '..', '..', '..', 'Phase-2');
            const phase2Script = path.join(phase2Dir, 'generate-complete.js');
            
            let stdout = '';
            let stderr = '';
            
            await new Promise((resolve, reject) => {
                const nodeProcess = spawn('node', [phase2Script, fileId], {
                    cwd: phase2Dir,
                    shell: true,
                    stdio: 'pipe'
                });
                
                nodeProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                nodeProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                
                nodeProcess.on('close', (code) => {
                    if (code === 0) {
                        logger.info({ fileId, stdout: stdout.substring(0, 500) }, '✅ Physical models generated successfully');
                        resolve();
                    } else {
                        logger.warn({ fileId, code, stderr: stderr.substring(0, 500) }, '⚠️ Physical model generation failed');
                        reject(new Error(`Phase-2 failed with code ${code}: ${stderr.substring(0, 200)}`));
                    }
                });
                
                nodeProcess.on('error', (err) => {
                    logger.error({ error: err.message, fileId }, '❌ Failed to spawn Phase-2');
                    reject(err);
                });
            });
            
            // Verify files were actually created
            const { existsSync } = await import('fs');
            const physicalDir = path.join(config.storage.artifactsDir, fileId, 'physical');
            const executiveDir = path.join(config.storage.artifactsDir, fileId, 'executive');
            
            const mysqlSqlPath = path.join(physicalDir, 'mysql.sql');
            const erdPngPath = path.join(physicalDir, 'erd.png');
            const erdSvgPath = path.join(physicalDir, 'erd.svg');
            const execReportPath = path.join(executiveDir, 'EXECUTIVE_REPORT.html');
            const interactivePath = path.join(executiveDir, 'erd_INTERACTIVE.html');
            
            const physicalFiles = {};
            if (existsSync(mysqlSqlPath)) {
                physicalFiles.mysql_sql = `artifacts/${fileId}/physical/mysql.sql`;
            }
            if (existsSync(erdPngPath)) {
                physicalFiles.erd_png = `artifacts/${fileId}/physical/erd.png`;
            }
            if (existsSync(erdSvgPath)) {
                physicalFiles.erd_svg = `artifacts/${fileId}/physical/erd.svg`;
            }
            if (existsSync(execReportPath)) {
                physicalFiles.executive_report = `artifacts/${fileId}/executive/EXECUTIVE_REPORT.html`;
            }
            if (existsSync(interactivePath)) {
                physicalFiles.interactive = `artifacts/${fileId}/executive/erd_INTERACTIVE.html`;
            }
            
            if (Object.keys(physicalFiles).length === 0) {
                throw new Error('No physical model files were generated. Check Phase-2 logs.');
            }
            
            results.generated.physical = physicalFiles;
        } catch (error) {
            logger.warn({ error: error.message, fileId }, '⚠️ Physical model generation failed (non-critical)');
            results.errors.push({
                type: 'physical',
                error: error.message
            });
        }
        
        // Step 6: Return results
        const status = results.errors.length === 0 ? 'success' : 'partial';
        const statusCode = results.errors.length === 0 ? 200 : 207; // 207 = Multi-Status
        
        logger.info({ fileId, status, errorCount: results.errors.length }, 'Artifact generation complete');
        
        res.status(statusCode).json({
            status,
            message: `Generated ${Object.keys(results.generated).length} artifact types`,
            fileId,
            artifacts: results.generated,
            errors: results.errors.length > 0 ? results.errors : undefined,
            metadata: {
                tables: metadata.metadata.tableCount,
                columns: metadata.metadata.rowCount
            }
        });
        
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack, fileId }, 'Artifact generation failed');
        
        res.status(500).json({
            error: 'Internal-Server-Error',
            message: error.message,
            fileId
        });
    }
});

/**
 * GET /generate/:fileId/status
 * Check which artifacts exist for a fileId
 */
router.get('/:fileId/status', async (req, res) => {
    const { fileId } = req.params;
    
    try {
        const { getArtifactStatus } = await import('../storage/fileStorage.js');
        const status = await getArtifactStatus(fileId);
        
        if (!status) {
            return res.status(404).json({
                error: 'Not-Found',
                message: `No artifacts found for fileId: ${fileId}`
            });
        }
        
        res.json({
            fileId,
            artifacts: status
        });
        
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to get artifact status');
        
        res.status(500).json({
            error: 'Internal-Server-Error',
            message: error.message
        });
    }
});

export default router;

