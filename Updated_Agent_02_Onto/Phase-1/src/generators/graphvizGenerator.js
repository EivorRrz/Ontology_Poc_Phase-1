/**
 * @Module Graphviz Diagram Generator
 * @Description Production-quality ERD diagrams using Graphviz
 * Handles small, medium, large, and very-large schemas (700+ columns) with adaptive quality
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

/**
 * Determine schema size category
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

/**
 * Get optimal Graphviz settings based on schema size
 */
function getGraphvizSettings(schemaSize) {
    const settings = {
        small: {
            dpi: 300,           // Maximum quality
            size: '20,30',      // Canvas size (inches)
            fontsize: 12,
            nodesep: 0.5,
            ranksep: 1.0,
            timeout: 30000,     // 30 seconds
            maxColumnsPerTable: 100
        },
        medium: {
            dpi: 250,           // High quality
            size: '30,40',      // Larger canvas
            fontsize: 11,
            nodesep: 0.4,
            ranksep: 0.8,
            timeout: 60000,     // 60 seconds
            maxColumnsPerTable: 50
        },
        large: {
            dpi: 200,           // Balanced quality
            size: '40,60',      // Extra large canvas
            fontsize: 10,
            nodesep: 0.3,
            ranksep: 0.6,
            timeout: 120000,    // 120 seconds
            maxColumnsPerTable: 40
        },
        'very-large': {
            dpi: 150,           // Lower DPI for performance
            size: '50,80',      // Extra large canvas
            fontsize: 8,        // Smaller font
            nodesep: 0.2,       // Tighter spacing
            ranksep: 0.4,
            timeout: 180000,    // 3 minutes timeout
            maxColumnsPerTable: 30  // Show only 30 columns max
        }
    };
    
    return settings[schemaSize] || settings.medium;
}

/**
 * Sanitize table/column names for Graphviz DOT format
 */
function sanitizeDotName(name) {
    if (!name) return '';
    // Escape special characters
    return name.replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');
}

/**
 * Smart column filtering for large tables
 * Shows: PKs, FKs, first N columns, then summary
 */
function filterColumnsForDisplay(columns, maxColumns = 50) {
    if (columns.length <= maxColumns) {
        return { columns, totalCount: columns.length, shownCount: columns.length, hiddenCount: 0 };
    }
    
    // Priority order: PKs → FKs → Important columns → Others
    const pkColumns = columns.filter(col => col.isPrimaryKey);
    const fkColumns = columns.filter(col => col.isForeignKey && !col.isPrimaryKey);
    const otherColumns = columns.filter(col => !col.isPrimaryKey && !col.isForeignKey);
    
    // Calculate how many we can show
    const remainingSlots = maxColumns - pkColumns.length - fkColumns.length;
    const showOthers = Math.max(0, Math.min(remainingSlots, otherColumns.length));
    
    // Combine: All PKs + All FKs + First N others
    const selectedColumns = [
        ...pkColumns,
        ...fkColumns,
        ...otherColumns.slice(0, showOthers)
    ];
    
    return {
        columns: selectedColumns,
        totalCount: columns.length,
        shownCount: selectedColumns.length,
        hiddenCount: columns.length - selectedColumns.length
    };
}

/**
 * Convert metadata to Graphviz DOT format (optimized for large schemas)
 */
function convertMetadataToDOT(metadata) {
    const tables = metadata.metadata?.tables || {};
    const schemaSize = getSchemaSize(metadata);
    const settings = getGraphvizSettings(schemaSize);
    
    let dot = 'digraph ERD {\n';
    dot += `  rankdir=LR;\n`;
    dot += `  node [shape=record, style=rounded, fontsize=${settings.fontsize}];\n`;
    dot += `  edge [color="#666666", fontsize=${Math.max(settings.fontsize - 2, 6)}];\n`;
    dot += `  nodesep=${settings.nodesep};\n`;
    dot += `  ranksep=${settings.ranksep};\n`;
    dot += `  splines=ortho;\n`;  // Orthogonal edges for cleaner look
    dot += `  concentrate=true;\n`;  // Merge parallel edges
    
    // For very large schemas, use smaller font and tighter spacing
    if (schemaSize === 'very-large') {
        dot += `  fontsize=9;\n`;
        dot += `  nodesep=0.2;\n`;
        dot += `  ranksep=0.4;\n`;
    }
    
    dot += '\n';
    
    // Add tables as nodes
    for (const [tableName, tableData] of Object.entries(tables)) {
        const sanitizedName = sanitizeDotName(tableName);
        const allColumns = tableData.columns || [];
        
        // Filter columns for display
        const columnData = filterColumnsForDisplay(allColumns, settings.maxColumnsPerTable);
        const columnsToShow = columnData.columns;
        const isFiltered = columnData.hiddenCount > 0;
        
        // Format columns for Graphviz record shape
        // Graphviz record shapes use ports: {<f0>label0|<f1>label1}
        // Record shapes don't support HTML tags - use plain text with indicators
        // Each port appears on a separate line automatically
        const headerLabel = sanitizedName;
        
        // Format columns as plain text (no HTML tags for record shapes)
        const columnLines = columnsToShow.map(col => {
            let colStr = sanitizeDotName(col.columnName);
            const colType = sanitizeDotName(col.dataType || 'VARCHAR');
            let formattedCol = `${colStr}: ${colType}`;
            
            // Use text indicators instead of HTML tags
            // * indicates Primary Key, _ indicates Foreign Key
            if (col.isPrimaryKey && col.isForeignKey) {
                formattedCol = `*_ ${formattedCol}`;  // Both PK and FK
            } else if (col.isPrimaryKey) {
                formattedCol = `* ${formattedCol}`;  // PK only
            } else if (col.isForeignKey) {
                formattedCol = `_ ${formattedCol}`;  // FK only
            }
            
            return formattedCol;
        });
        
        // Add "... +N more columns" indicator if filtered
        if (isFiltered) {
            columnLines.push(`... +${columnData.hiddenCount} more columns`);
        }
        
        // Put each column in its own port (each port = one line)
        const columnPorts = columnLines.map((col, idx) => `<f${idx + 1}>${col}`).join('|');
        
        // Create table node: header in <f0>, each column in its own port
        dot += `  "${sanitizedName}" [label="{<f0>${headerLabel}|${columnPorts}}"];\n`;
    }
    
    dot += '\n';
    
    // Add relationships (show ALL relationships, even if columns are filtered)
    for (const [tableName, tableData] of Object.entries(tables)) {
        const fromTable = sanitizeDotName(tableName);
        
        // Process ALL columns for relationships (not filtered)
        for (const col of (tableData.columns || [])) {
            if (col.isForeignKey && col.referencesTable && col.referencesColumn) {
                const toTable = sanitizeDotName(col.referencesTable);
                const fkColumn = sanitizeDotName(col.columnName);
                const refColumn = sanitizeDotName(col.referencesColumn);
                
                dot += `  "${fromTable}" -> "${toTable}" `;
                dot += `[label="${fkColumn} → ${refColumn}", `;
                dot += `headlabel="", taillabel=""];\n`;
            }
        }
    }
    
    dot += '}\n';
    return dot;
}

/**
 * Find Graphviz installation path
 * Checks common Windows installation locations
 */
function findGraphvizPath() {
    const commonPaths = [
        'dot',  // Try PATH first
        'C:\\Program Files\\Graphviz\\bin\\dot.exe',
        'C:\\Program Files (x86)\\Graphviz\\bin\\dot.exe',
        process.env.GRAPHVIZ_PATH || '',
    ].filter(Boolean);
    
    // Check if any path exists
    for (const dotPath of commonPaths) {
        if (dotPath === 'dot') {
            // Try to execute dot command
            try {
                execSync('dot -V', { stdio: 'ignore', timeout: 2000 });
                return 'dot';  // Found in PATH
            } catch {
                continue;
            }
        } else if (existsSync(dotPath)) {
            return dotPath;
        }
    }
    
    return null;
}

/**
 * Check if Graphviz is installed
 */
async function isGraphvizInstalled() {
    const graphvizPath = findGraphvizPath();
    if (!graphvizPath) {
        return false;
    }
    
    try {
        // Handle both 'dot' (in PATH) and full path
        const cmd = graphvizPath === 'dot' ? 'dot -V' : `"${graphvizPath}" -V`;
        await execAsync(cmd);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Get Graphviz command (with full path if needed)
 */
function getGraphvizCommand() {
    const graphvizPath = findGraphvizPath();
    if (!graphvizPath) {
        throw new Error('Graphviz is not installed. Install from https://graphviz.org/download/');
    }
    return graphvizPath === 'dot' ? 'dot' : graphvizPath;
}

/**
 * Generate PNG using Graphviz with retry logic
 */
export async function generateGraphvizPNG(metadata, outputPath, options = {}) {
    const maxRetries = options.retries || 3;
    let lastError = null;
    
    // Check if Graphviz is installed
    const installed = await isGraphvizInstalled();
    if (!installed) {
        throw new Error('Graphviz is not installed. Install from https://graphviz.org/download/');
    }
    
    const schemaSize = getSchemaSize(metadata);
    const settings = getGraphvizSettings(schemaSize);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info({ 
                outputPath, 
                attempt,
                schemaSize,
                settings 
            }, `Generating Graphviz PNG (attempt ${attempt}/${maxRetries})...`);
            
            // Convert metadata to DOT format
            const dotContent = convertMetadataToDOT(metadata);
            const dotPath = outputPath.replace('.png', '.dot');
            
            // Save DOT file temporarily
            await writeFile(dotPath, dotContent, 'utf-8');
            
            // Build Graphviz command with proper path (handle spaces in path)
            const dotCmd = getGraphvizCommand();
            
            // Convert Windows backslashes to forward slashes for Graphviz
            const normalizedOutputPath = outputPath.replace(/\\/g, '/');
            const normalizedDotPath = dotPath.replace(/\\/g, '/');
            
            // Build command - quote executable if path has spaces
            let command;
            if (dotCmd.includes(' ')) {
                // Full path with spaces - quote the executable
                command = `"${dotCmd}" -Tpng -Gdpi=${settings.dpi} -Gsize="${settings.size}" -o "${normalizedOutputPath}" "${normalizedDotPath}"`;
            } else {
                // Command in PATH
                command = `${dotCmd} -Tpng -Gdpi=${settings.dpi} -Gsize="${settings.size}" -o "${normalizedOutputPath}" "${normalizedDotPath}"`;
            }
            
            // Execute with timeout and shell option for Windows
            const timeoutId = setTimeout(() => {
                throw new Error(`Graphviz timeout after ${settings.timeout}ms`);
            }, settings.timeout);
            
            try {
                await execAsync(command, { 
                    timeout: settings.timeout,
                    shell: process.platform === 'win32'  // Use shell on Windows for proper path handling
                });
                clearTimeout(timeoutId);
            } catch (err) {
                clearTimeout(timeoutId);
                throw err;
            }
            
            // Clean up DOT file
            try {
                await unlink(dotPath);
            } catch (err) {
                // Ignore cleanup errors
            }
            
            // Verify file was created and has content
            if (existsSync(outputPath)) {
                const stats = statSync(outputPath);
                if (stats.size > 0) {
                    logger.info({ 
                        outputPath, 
                        size: stats.size,
                        attempt,
                        schemaSize 
                    }, '✅ Graphviz PNG generated successfully');
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
                attempt,
                maxRetries 
            }, `Graphviz PNG generation failed (attempt ${attempt}/${maxRetries})`);
            
            // Wait before retry (exponential backoff)
            if (attempt < maxRetries) {
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    throw new Error(`Graphviz PNG generation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Generate SVG using Graphviz with retry logic
 */
export async function generateGraphvizSVG(metadata, outputPath, options = {}) {
    const maxRetries = options.retries || 3;
    let lastError = null;
    
    const installed = await isGraphvizInstalled();
    if (!installed) {
        throw new Error('Graphviz is not installed');
    }
    
    const schemaSize = getSchemaSize(metadata);
    const settings = getGraphvizSettings(schemaSize);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info({ 
                outputPath, 
                attempt,
                schemaSize 
            }, `Generating Graphviz SVG (attempt ${attempt}/${maxRetries})...`);
            
            const dotContent = convertMetadataToDOT(metadata);
            const dotPath = outputPath.replace('.svg', '.dot');
            
            await writeFile(dotPath, dotContent, 'utf-8');
            
            // SVG doesn't need DPI/size settings (vector format)
            const dotCmd = getGraphvizCommand();
            
            // Convert Windows backslashes to forward slashes for Graphviz
            const normalizedOutputPath = outputPath.replace(/\\/g, '/');
            const normalizedDotPath = dotPath.replace(/\\/g, '/');
            
            // Build command - quote executable if path has spaces
            let command;
            if (dotCmd.includes(' ')) {
                // Full path with spaces - quote the executable
                command = `"${dotCmd}" -Tsvg -o "${normalizedOutputPath}" "${normalizedDotPath}"`;
            } else {
                // Command in PATH
                command = `${dotCmd} -Tsvg -o "${normalizedOutputPath}" "${normalizedDotPath}"`;
            }
            
            await execAsync(command, { 
                timeout: settings.timeout,
                shell: process.platform === 'win32'  // Use shell on Windows for proper path handling
            });
            
            // Clean up
            try {
                await unlink(dotPath);
            } catch (err) {
                // Ignore
            }
            
            if (existsSync(outputPath)) {
                const stats = statSync(outputPath);
                if (stats.size > 0) {
                    logger.info({ 
                        outputPath, 
                        size: stats.size,
                        attempt 
                    }, '✅ Graphviz SVG generated successfully');
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
            }, `Graphviz SVG generation failed (attempt ${attempt}/${maxRetries})`);
            
            if (attempt < maxRetries) {
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    throw new Error(`Graphviz SVG generation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

