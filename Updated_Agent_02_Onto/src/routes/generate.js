/**
 * @Module Generate Route
 * @Description API endpoint to automatically generate logical models and ERD pictures
 */

import express from 'express';
import logger from '../utils/logger.js';
import { getMetadata } from '../storage/fileStorage.js';
import { generateDBML, saveDBML } from '../generators/dbmlGenerator.js';
import { generateMermaidERD, generateERDImages, saveMermaidERD } from '../generators/erdGenerator.js';

const router = express.Router();

/**
 * POST /generate/:fileId
 * Automatically generate DBML and ERD images for uploaded file
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
        
        // Step 2: Generate DBML (Logical Model)
        try {
            logger.info({ fileId }, 'Generating DBML...');
            const dbmlContent = await generateDBML(metadata);
            const dbmlPath = await saveDBML(fileId, dbmlContent);
            
            results.generated.dbml = {
                path: dbmlPath,
                size: dbmlContent.length
            };
            
            logger.info({ fileId }, '✅ DBML generated successfully');
        } catch (error) {
            logger.error({ error: error.message, fileId }, '❌ DBML generation failed');
            results.errors.push({
                type: 'dbml',
                error: error.message
            });
        }
        
        // Step 3: Generate Mermaid ERD
        let mermaidContent;
        try {
            logger.info({ fileId }, 'Generating Mermaid ERD...');
            mermaidContent = await generateMermaidERD(metadata);
            const mermaidPath = await saveMermaidERD(fileId, mermaidContent);
            
            results.generated.mermaid = {
                path: mermaidPath,
                size: mermaidContent.length
            };
            
            logger.info({ fileId }, '✅ Mermaid ERD generated successfully');
        } catch (error) {
            logger.error({ error: error.message, fileId }, '❌ Mermaid ERD generation failed');
            results.errors.push({
                type: 'mermaid',
                error: error.message
            });
        }
        
        // Step 4: Generate ERD Images (PNG, SVG, PDF)
        if (mermaidContent) {
            try {
                logger.info({ fileId }, 'Generating ERD images (PNG, SVG, PDF)...');
                const imagePaths = await generateERDImages(fileId, mermaidContent);
                
                results.generated.images = imagePaths;
                
                logger.info({ fileId }, '✅ ERD images generated successfully');
            } catch (error) {
                logger.error({ error: error.message, fileId }, '❌ ERD image generation failed');
                results.errors.push({
                    type: 'images',
                    error: error.message
                });
            }
        }
        
        // Step 5: Return results
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

