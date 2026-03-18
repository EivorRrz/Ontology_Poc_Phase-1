/**
 * @Module Enhanced DBML Diagram Generator
 * @Description Production-ready DBML CLI generator with adaptive quality
 * Fallback generator when Graphviz is not available
 * Handles small, medium, large, and very-large schemas (700+ columns)
 */

import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { ensureFolders } from '../utils/folderOrganizer.js';
import { getMetadata } from '../storage/fileStorage.js';

/**
 * Determine schema size and get quality settings
 */
function getSchemaSize(metadata) {
    const tableCount = metadata.metadata?.tableCount || 0;
    const columnCount = metadata.metadata?.rowCount || 0;
    
    // Check for very large tables (700+ columns)
    const maxColumnsPerTable = Math.max(...Object.values(metadata.metadata?.tables || {})
        .map(t => (t.columns || []).length), 0);
    
    if (maxColumnsPerTable >= 500) {
        return 'very-large';
    }
    
    if (tableCount <= 10 && columnCount <= 100) {
        return 'small';
    } else if (tableCount <= 30 && columnCount <= 500) {
        return 'medium';
    } else {
        return 'large';
    }
}

function getQualitySettings(schemaSize, maxColumnsPerTable = 0) {
    const settings = {
        small: {
            scale: 3,
            width: 4000,
            height: 6000,
            timeout: 30000,
            retries: 2
        },
        medium: {
            scale: 2,
            width: 5000,
            height: 7000,
            timeout: 60000,
            retries: 3
        },
        large: {
            scale: 2,
            width: 6000,
            height: 8000,
            timeout: 120000,
            retries: 4
        },
        'very-large': {
            scale: 1.5,         // Lower scale for performance
            width: 8000,        // Extra wide canvas
            height: 10000,      // Extra tall canvas
            timeout: 180000,    // 3 minutes
            retries: 5          // More retries for large files
        }
    };
    
    // Detect very large tables
    if (maxColumnsPerTable >= 500) {
        return settings['very-large'];
    }
    
    return settings[schemaSize] || settings.medium;
}

/**
 * Generate PNG with adaptive quality and retry logic
 */
export async function generateDBMLPNG(dbmlPath, outputPath, options = {}) {
    const maxRetries = options.retries || 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!existsSync(dbmlPath)) {
                throw new Error(`DBML file not found: ${dbmlPath}`);
            }
            
            logger.info({ 
                dbmlPath, 
                outputPath, 
                attempt,
                settings: options 
            }, `Generating DBML PNG (attempt ${attempt}/${maxRetries})...`);
            
            const args = [
                '@dbml/cli', 
                'dbml2img', 
                dbmlPath, 
                '-o', 
                outputPath
            ];
            
            if (options.scale) {
                args.push('--scale', String(options.scale));
            }
            if (options.width) {
                args.push('--width', String(options.width));
            }
            if (options.height) {
                args.push('--height', String(options.height));
            }
            
            const result = await generatePNGWithTimeout(args, options.timeout || 60000);
            
            if (existsSync(outputPath)) {
                const stats = statSync(outputPath);
                if (stats.size > 0) {
                    logger.info({ 
                        outputPath, 
                        size: stats.size,
                        attempt 
                    }, '✅ DBML PNG generated successfully');
                    return outputPath;
                } else {
                    throw new Error('Generated PNG file is empty');
                }
            } else {
                throw new Error('PNG file was not created');
            }
        } catch (error) {
            lastError = error;
            logger.warn({ 
                error: error.message, 
                attempt 
            }, `DBML PNG generation failed (attempt ${attempt}/${maxRetries})`);
            
            if (attempt < maxRetries) {
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    throw new Error(`DBML PNG generation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

function generatePNGWithTimeout(args, timeout) {
    return new Promise((resolve, reject) => {
        // Use direct path to dbml2img if available, otherwise use npx
        const isWindows = process.platform === 'win32';
        const dbmlBinPath = path.join(process.cwd(), 'node_modules', '.bin', isWindows ? 'dbml2img.cmd' : 'dbml2img');
        
        let command;
        let procArgs;
        
        if (existsSync(dbmlBinPath)) {
            // Use local binary directly
            command = isWindows ? dbmlBinPath : 'node';
            procArgs = isWindows ? [] : [dbmlBinPath];
            // Add the rest of args (skip @dbml/cli and dbml2img)
            procArgs.push(...args.slice(2));
        } else {
            // @dbml/cli doesn't have dbml2img command - skip DBML CLI generation
            // Return error gracefully instead of trying invalid command
            reject(new Error('DBML CLI diagram generation not available. Please install Graphviz or dbml2img package separately.'));
            return;
        }
        
        const proc = spawn(command, procArgs, {
            shell: isWindows,
            stdio: 'pipe',
            cwd: process.cwd()
        });
        
        let stdout = '';
        let stderr = '';
        let timeoutId = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`PNG generation timeout after ${timeout}ms`));
        }, timeout);
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`DBML CLI failed with code ${code}: ${stderr || stdout}`));
            }
        });
        
        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

/**
 * Generate SVG with adaptive quality
 */
export async function generateDBMLSVG(dbmlPath, outputPath, options = {}) {
    const maxRetries = options.retries || 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!existsSync(dbmlPath)) {
                throw new Error(`DBML file not found: ${dbmlPath}`);
            }
            
            logger.info({ 
                dbmlPath, 
                outputPath, 
                attempt 
            }, `Generating DBML SVG (attempt ${attempt}/${maxRetries})...`);
            
            const args = [
                '@dbml/cli', 
                'dbml2img', 
                dbmlPath, 
                '-o', 
                outputPath,
                '--format', 
                'svg'
            ];
            
            if (options.scale) {
                args.push('--scale', String(options.scale));
            }
            
            await generateSVGWithTimeout(args, options.timeout || 60000);
            
            if (existsSync(outputPath)) {
                const stats = statSync(outputPath);
                if (stats.size > 0) {
                    logger.info({ 
                        outputPath, 
                        size: stats.size,
                        attempt 
                    }, '✅ DBML SVG generated successfully');
                    return outputPath;
                } else {
                    throw new Error('Generated SVG file is empty');
                }
            } else {
                throw new Error('SVG file was not created');
            }
        } catch (error) {
            lastError = error;
            logger.warn({ 
                error: error.message, 
                attempt 
            }, `DBML SVG generation failed (attempt ${attempt}/${maxRetries})`);
            
            if (attempt < maxRetries) {
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    throw new Error(`DBML SVG generation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

function generateSVGWithTimeout(args, timeout) {
    return new Promise((resolve, reject) => {
        // Use direct path to dbml2img if available, otherwise skip
        const isWindows = process.platform === 'win32';
        const dbmlBinPath = path.join(process.cwd(), 'node_modules', '.bin', isWindows ? 'dbml2img.cmd' : 'dbml2img');
        
        let command;
        let procArgs;
        
        if (existsSync(dbmlBinPath)) {
            // Use local binary directly
            command = isWindows ? dbmlBinPath : 'node';
            procArgs = isWindows ? [] : [dbmlBinPath];
            procArgs.push(...args.slice(2));
        } else {
            // @dbml/cli doesn't have dbml2img command - skip DBML CLI generation
            reject(new Error('DBML CLI diagram generation not available. Please install Graphviz or dbml2img package separately.'));
            return;
        }
        
        const proc = spawn(command, procArgs, {
            shell: isWindows,
            stdio: 'pipe',
            cwd: process.cwd()
        });
        
        let stdout = '';
        let stderr = '';
        let timeoutId = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`SVG generation timeout after ${timeout}ms`));
        }, timeout);
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`DBML CLI failed with code ${code}: ${stderr || stdout}`));
            }
        });
        
        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

/**
 * Generate PDF
 */
export async function generateDBMLPDF(dbmlPath, outputPath, options = {}) {
    return new Promise((resolve, reject) => {
        if (!existsSync(dbmlPath)) {
            return reject(new Error(`DBML file not found: ${dbmlPath}`));
        }
        
        logger.info({ dbmlPath, outputPath }, 'Generating DBML PDF...');
        
        // Use direct path to dbml2img if available, otherwise skip
        const isWindows = process.platform === 'win32';
        const dbmlBinPath = path.join(process.cwd(), 'node_modules', '.bin', isWindows ? 'dbml2img.cmd' : 'dbml2img');
        
        let command;
        let procArgs;
        
        if (existsSync(dbmlBinPath)) {
            command = isWindows ? dbmlBinPath : 'node';
            procArgs = isWindows ? [] : [dbmlBinPath];
            procArgs.push(dbmlPath, '-o', outputPath, '--format', 'pdf');
        } else {
            return reject(new Error('DBML CLI diagram generation not available. Please install Graphviz or dbml2img package separately.'));
        }
        
        const proc = spawn(command, procArgs, {
            shell: isWindows,
            stdio: 'pipe',
            cwd: process.cwd()
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                logger.info({ outputPath }, '✅ DBML PDF generated successfully');
                resolve(outputPath);
            } else {
                logger.error({ code, stderr }, '❌ DBML PDF generation failed');
                reject(new Error(`DBML CLI failed with code ${code}: ${stderr}`));
            }
        });
        
        proc.on('error', (err) => {
            logger.error({ error: err.message }, '❌ Failed to spawn DBML CLI');
            reject(err);
        });
    });
}

/**
 * Generate all formats with adaptive quality
 */
export async function generateDBMLDiagrams(fileId, dbmlPath, metadata = null) {
    const paths = await ensureFolders(fileId);
    
    // Get metadata if not provided
    if (!metadata) {
        try {
            metadata = await getMetadata(fileId);
        } catch (err) {
            logger.warn({ error: err.message }, 'Could not load metadata, using defaults');
        }
    }
    
    let schemaSize = 'medium';
    let qualitySettings = getQualitySettings('medium');
    
    if (metadata) {
        schemaSize = getSchemaSize(metadata);
        const maxColumnsPerTable = Math.max(...Object.values(metadata.metadata?.tables || {})
            .map(t => (t.columns || []).length), 0);
        qualitySettings = getQualitySettings(schemaSize, maxColumnsPerTable);
        
        logger.info({ 
            fileId, 
            schemaSize,
            tableCount: metadata.metadata?.tableCount,
            columnCount: metadata.metadata?.rowCount,
            maxColumnsPerTable,
            settings: qualitySettings
        }, 'Determined schema size and quality settings');
    }
    
    const results = {
        png: null,
        svg: null,
        pdf: null,
        errors: [],
        schemaSize,
        generator: 'dbml-cli'
    };
    
    // Generate PNG
    try {
        const pngPath = path.join(paths.logical, 'erd.png');
        if (!existsSync(pngPath)) {
            await generateDBMLPNG(dbmlPath, pngPath, qualitySettings);
            results.png = pngPath;
        } else {
            logger.info({ pngPath }, 'PNG already exists, skipping');
            results.png = pngPath;
        }
    } catch (err) {
        logger.error({ error: err.message }, '❌ PNG generation failed');
        results.errors.push({ type: 'png', error: err.message });
    }
    
    // Generate SVG
    try {
        const svgPath = path.join(paths.logical, 'erd.svg');
        if (!existsSync(svgPath)) {
            await generateDBMLSVG(dbmlPath, svgPath, qualitySettings);
            results.svg = svgPath;
        } else {
            logger.info({ svgPath }, 'SVG already exists, skipping');
            results.svg = svgPath;
        }
    } catch (err) {
        logger.error({ error: err.message }, '❌ SVG generation failed');
        results.errors.push({ type: 'svg', error: err.message });
    }
    
    // Generate PDF
    try {
        const pdfPath = path.join(paths.logical, 'erd.pdf');
        if (!existsSync(pdfPath)) {
            await generateDBMLPDF(dbmlPath, pdfPath);
            results.pdf = pdfPath;
        } else {
            logger.info({ pdfPath }, 'PDF already exists, skipping');
            results.pdf = pdfPath;
        }
    } catch (err) {
        logger.error({ error: err.message }, '❌ PDF generation failed');
        results.errors.push({ type: 'pdf', error: err.message });
    }
    
    // Log summary
    const successCount = [results.png, results.svg, results.pdf].filter(Boolean).length;
    logger.info({ 
        fileId, 
        schemaSize,
        successCount,
        totalFormats: 3,
        errors: results.errors.length
    }, `Diagram generation complete: ${successCount}/3 formats generated`);
    
    return results;
}
