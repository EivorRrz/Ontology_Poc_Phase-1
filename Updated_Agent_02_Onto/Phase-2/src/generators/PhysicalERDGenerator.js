/**
 * Physical ERD Diagram Generator
 * Generates PNG and SVG ERD diagrams for physical models
 * Uses Graphviz (primary) → DBML CLI (fallback) approach
 */

import path from 'path';
import { existsSync, statSync } from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import config from '../config.js';
import { mapToMySQLType } from './typeMapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

/**
 * Find Graphviz dot.exe path
 */
function findGraphvizPath() {
    const commonPaths = [
        'C:\\Program Files\\Graphviz\\bin\\dot.exe',
        'C:\\Program Files (x86)\\Graphviz\\bin\\dot.exe',
        'dot.exe' // In PATH
    ];
    
    for (const dotPath of commonPaths) {
        try {
            execSync(`"${dotPath}" -V`, { stdio: 'ignore' });
            return dotPath;
        } catch (err) {
            // Try next path
        }
    }
    
    return null;
}

/**
 * Check if Graphviz is installed
 */
function isGraphvizInstalled() {
    const dotPath = findGraphvizPath();
    return dotPath !== null;
}

/**
 * Get schema size for adaptive quality
 */
function getSchemaSize(metadata) {
    const tableCount = metadata.tableCount || 0;
    const totalColumns = metadata.totalColumns || 0;
    const tablesArray = Array.from(metadata.tables.values());
    const maxColumnsPerTable = Math.max(...tablesArray.map(t => t.columns.length), 0);
    
    if (maxColumnsPerTable >= 500) return 'very-large';
    if (tableCount <= 10 && totalColumns <= 100) return 'small';
    if (tableCount <= 30 && totalColumns <= 500) return 'medium';
    return 'large';
}

/**
 * Get Graphviz settings based on schema size
 */
function getGraphvizSettings(schemaSize) {
    const settings = {
        small: { dpi: 300, size: '20,30', fontsize: 12, nodesep: 0.5, ranksep: 1, timeout: 30000 },
        medium: { dpi: 300, size: '40,60', fontsize: 11, nodesep: 0.4, ranksep: 0.8, timeout: 60000 },
        large: { dpi: 200, size: '80,120', fontsize: 10, nodesep: 0.3, ranksep: 0.6, timeout: 120000 },
        'very-large': { dpi: 150, size: '120,180', fontsize: 9, nodesep: 0.2, ranksep: 0.4, timeout: 180000 }
    };
    
    return settings[schemaSize] || settings.medium;
}

/**
 * Filter columns for display in very large tables
 */
function filterColumnsForDisplay(columns, maxColumns = 20) {
    if (columns.length <= maxColumns) return columns;
    
    const pkColumns = columns.filter(c => c.isPrimaryKey);
    const fkColumns = columns.filter(c => c.isForeignKey && !c.isPrimaryKey);
    const otherColumns = columns.filter(c => !c.isPrimaryKey && !c.isForeignKey);
    
    const displayColumns = [
        ...pkColumns,
        ...fkColumns,
        ...otherColumns.slice(0, Math.max(0, maxColumns - pkColumns.length - fkColumns.length))
    ];
    
    return displayColumns;
}

/**
 * Convert metadata to Graphviz DOT format for Physical ERD
 * Shows exact SQL types, constraints, and physical implementation details
 */
function convertMetadataToDOT(metadata, settings) {
    const maxColumnsPerTable = settings.maxColumnsPerTable || 100;

    // Helpers (mirror MySQLGenerator display rules)
    const cleanName = (name) => String(name || '').replace(/^_+/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const isEmailUnique = (n) => n.toLowerCase() === 'email';
    const shouldBeNotNull = (col, n) => {
        if (col.isPrimaryKey) return true;
        if (col.isForeignKey) return true;
        const nn = n.toLowerCase();
        if (['name','email','order_date','total','price','quantity'].includes(nn)) return true;
        return col.isNullable === false;
    };
    const getCheck = (n) => {
        const nn = n.toLowerCase();
        if (nn === 'quantity') return `${n} > 0`;
        if (nn === 'price' || nn === 'total') return `${n} >= 0`;
        return null;
    };
    const getDefault = (n, type) => {
        const nn = n.toLowerCase();
        const tt = String(type).toUpperCase();
        if (nn === 'created_at') return 'CURRENT_TIMESTAMP';
        if (nn === 'updated_at') return 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP';
        if (nn === 'order_date' && tt === 'DATE') return 'CURRENT_DATE';
        return null;
    };
    
    let dot = 'digraph PhysicalERD {\n';
    dot += `  graph [dpi=${settings.dpi}, size="${settings.size}", nodesep=${settings.nodesep}, ranksep=${settings.ranksep}];\n`;
    dot += `  node [shape=record, fontsize=${settings.fontsize}];\n`;
    dot += `  edge [fontsize=${settings.fontsize - 2}];\n\n`;
    
    // Add tables
    const tablesArray = Array.from(metadata.tables.values());
    for (const table of tablesArray) {
        const tableName = table.name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
        const columns = filterColumnsForDisplay(table.columns, maxColumnsPerTable);
        const filteredCount = table.columns.length - columns.length;
        
        let label = `{<header>${table.name}`;
        
        for (const col of columns) {
            const colName = cleanName(col.name);
            const exactType = col._llmExactType || mapToMySQLType(col.dataType || 'VARCHAR', col.isPrimaryKey);
            const physicalType = String(exactType)
                .replace(/INTEGER\b/gi, 'INT')
                .replace(/\s*AUTO_INCREMENT\s*/gi, '')
                .replace(/\s*DEFAULT\s+CURRENT_TIMESTAMP\s*/gi, '')
                .trim();
            
            const isPk = !!col.isPrimaryKey;
            const isFk = !!col.isForeignKey;
            const notNull = shouldBeNotNull(col, colName);
            const isEmailUq = isEmailUnique(colName);
            const defVal = getDefault(colName, physicalType);
            const checkExpr = getCheck(colName);
            
            let colLabel = `${colName}: ${physicalType}`;
            if (isPk) colLabel = `*${colLabel}`;           // PK marker
            if (isFk) colLabel = `_${colLabel}`;           // FK marker
            if (notNull) colLabel += ' [NN]';              // NOT NULL
            if (isPk) colLabel += ' [AI]';                 // Auto Increment (for PKs)
            if (isEmailUq) colLabel += ' [UQ]';            // only email unique
            if (defVal) colLabel += ` [DEF=${defVal}]`;    // defaults
            if (checkExpr) colLabel += ` [CHK=${checkExpr}]`; // checks
            
            // Escape record label special chars to avoid Graphviz parse errors
            const colLabelSafe = colLabel.replace(/([{}|<>])/g, '\\$1');
            
            label += `|${colLabelSafe}`;
        }
        
        if (filteredCount > 0) {
            label += `|... +${filteredCount} more columns`;
        }
        
        label += '}';
        
        dot += `  "${tableName}" [label="${label.replace(/"/g, '\\"')}"];\n`;
    }
    
    dot += '\n';
    
    // Add relationships with referential actions
    for (const table of tablesArray) {
        const tableName = table.name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
        
        for (const col of table.columns) {
            if (col.isForeignKey && col.referencesTable && col.referencesColumn) {
                const refTable = col.referencesTable.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
                const cleanFkName = col.name.replace(/^_+/, '');
                
                // Determine referential action for label
                const isChildTable = table.name.toLowerCase().includes('item') || table.name.toLowerCase().includes('detail');
                const deleteAction = isChildTable ? 'CASCADE' : 'RESTRICT';
                
                dot += `  "${refTable}" -> "${tableName}" [` +
                       `label="${cleanFkName}\\nON DELETE ${deleteAction}\\nON UPDATE CASCADE", ` +
                       `taillabel="1", headlabel="N", labeldistance=2, labelfontsize=${settings.fontsize - 2}` +
                       `];\n`;
            }
        }
    }
    
    dot += '}\n';
    
    return dot;
}

/**
 * Generate PNG using Graphviz
 */
export async function generatePhysicalERDPNG(metadata, outputPath, options = {}) {
    const maxRetries = options.retries || 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const schemaSize = getSchemaSize(metadata);
            const settings = getGraphvizSettings(schemaSize);
            settings.maxColumnsPerTable = options.maxColumnsPerTable || 100;
            
            const dotContent = convertMetadataToDOT(metadata, settings);
            const dotPath = outputPath.replace('.png', '.dot');
            
            const { writeFile } = await import('fs/promises');
            await writeFile(dotPath, dotContent, 'utf-8');
            
            const dotExe = findGraphvizPath();
            if (!dotExe) {
                throw new Error('Graphviz is not installed. Install from https://graphviz.org/download/');
            }
            
            const dotPathQuoted = `"${dotPath}"`;
            const outputPathQuoted = `"${outputPath}"`;
            const command = `"${dotExe}" -Tpng -Gdpi=${settings.dpi} -Gsize="${settings.size}" -o ${outputPathQuoted} ${dotPathQuoted}`;
            
            await Promise.race([
                execAsync(command, { shell: true }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), settings.timeout)
                )
            ]);
            
            // Clean up DOT file
            const { unlink } = await import('fs/promises');
            await unlink(dotPath).catch(() => {});
            
            if (existsSync(outputPath)) {
                const stats = statSync(outputPath);
                if (stats.size > 0) {
                    logger.info({ outputPath, size: stats.size, attempt }, '✅ Physical ERD PNG generated');
                    return outputPath;
                }
            }
            
            throw new Error('PNG file was not created');
            
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw new Error(`Physical ERD PNG generation failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Generate SVG using Graphviz
 */
export async function generatePhysicalERDSVG(metadata, outputPath, options = {}) {
    const maxRetries = options.retries || 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const schemaSize = getSchemaSize(metadata);
            const settings = getGraphvizSettings(schemaSize);
            settings.maxColumnsPerTable = options.maxColumnsPerTable || 100;
            
            const dotContent = convertMetadataToDOT(metadata, settings);
            const dotPath = outputPath.replace('.svg', '.dot');
            
            const { writeFile } = await import('fs/promises');
            await writeFile(dotPath, dotContent, 'utf-8');
            
            const dotExe = findGraphvizPath();
            if (!dotExe) {
                throw new Error('Graphviz is not installed. Install from https://graphviz.org/download/');
            }
            
            const dotPathQuoted = `"${dotPath}"`;
            const outputPathQuoted = `"${outputPath}"`;
            const command = `"${dotExe}" -Tsvg -Gdpi=${settings.dpi} -Gsize="${settings.size}" -o ${outputPathQuoted} ${dotPathQuoted}`;
            
            await Promise.race([
                execAsync(command, { shell: true }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), settings.timeout)
                )
            ]);
            
            // Clean up DOT file
            const { unlink } = await import('fs/promises');
            await unlink(dotPath).catch(() => {});
            
            if (existsSync(outputPath)) {
                const stats = statSync(outputPath);
                if (stats.size > 0) {
                    logger.info({ outputPath, size: stats.size, attempt }, '✅ Physical ERD SVG generated');
                    return outputPath;
                }
            }
            
            throw new Error('SVG file was not created');
            
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw new Error(`Physical ERD SVG generation failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Generate physical ERD diagrams (PNG + SVG)
 * DISABLED: Only Interactive HTML viewer is used now
 */
export async function generatePhysicalERDDiagrams(metadata, outputDir) {
    // Diagram generation removed - only Interactive HTML viewer is used
    logger.info({ outputDir }, 'Skipping static diagram generation (PNG/SVG) - using Interactive HTML viewer only');
    
    return {
        png: null,
        svg: null,
        generator: null,
        errors: [],
        note: 'Static diagrams disabled - use Interactive HTML viewer instead'
    };
}

