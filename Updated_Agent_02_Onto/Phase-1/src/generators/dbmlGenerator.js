/**
 * @Module DBML Generator
 * @Description Generate DBML (Database Markup Language) from metadata
 * Creates logical data model in DBML format
 */

/**
 * Imports files are here..!
 */
import { writeFile } from "fs/promises";
import path, { join } from "path";
import logger from '../utils/logger.js';
import config from "../config/index.js";
import { ensureFolders } from '../utils/folderOrganizer.js';
import { mapToLogicalType, generateEnhancedDescription } from './logicalTypeMapper.js';
import { enhanceLogicalModelWithLLM } from './LLMLogicalEnhancer.js';

/**
 * Generate DBML from metadata
 * @param {Object} metadata - Metadata object from storage
 * @returns {Promise<string>} Generated DBML content
 */
export async function generateDBML(metadata, useLLM = true) {
    //so it will take the metadata here and try to get the dbml..!
    /**
     * we are creating the dbml template here..!
     * The instance of the dbml..!
     */
    try {
        //try to log it....!
        //the field-Id..!
        logger.info({
            fileId: metadata.fileId
        },
            'Generating DBML from metadata..!');

        // Enhance with LLM for logical model details (relationships, cardinalities, descriptions)
        if (useLLM) {
            try {
                logger.info('Enhancing logical model with LLM...');
                metadata = await enhanceLogicalModelWithLLM(metadata);
            } catch (error) {
                logger.warn({ error: error.message }, 'LLM enhancement failed, using heuristics only');
            }
        }

        //add all the things i want to see in the dbml..!
        /**
         * Add everything i want to see in the dbml..!
         */
        let dbml = `// Logical Data Model (LDM)\n`;
        dbml += `// Database Schema: ${metadata.originalName}\n`;
        dbml += `// Generated: ${new Date().toISOString()}\n`;
        dbml += `// Entities: ${metadata.metadata.tableCount}\n`;
        dbml += `// Attributes: ${metadata.metadata.rowCount}\n`;
        dbml += `// NOTE: This is a LOGICAL model - no physical implementation details\n\n`;

        //generate the table defination..!
        //generate the table defination for the each table..!
        //inside the metadata-Object-Metadata-Nested-one we have to find the tables..!
        const tables = metadata.metadata.tables;

        //check if tables exist..!
        if (!tables || Object.keys(tables).length === 0) {
            throw new Error('No tables found in metadata');
        }

        //get the tableName and tableDATA..!PUSH IT..!
        for (const [tableName, tableData] of Object.entries(tables)) {
            dbml += generateTableDBML(tableName, tableData);
        }

        // Generate relationships section
        dbml += `// Relationships:\n`;
        for (const [tableName, tableData] of Object.entries(tables)) {
            dbml += generateRelationshipsDBML(tableName, tableData);
        }

        logger.info({
            fileId: metadata.fileId,
            length: dbml.length,
        },
            'DBML-Generated-Successfully..!');

        return dbml;

    } catch (error) {
        logger.error({
            error: error.message,
            stack: error.stack,
            fileId: metadata?.fileId,//if metada is there then fileId is there..!
        }, 'Failed to generate DBML');
        throw error;
    }
}

/**
 * Generate DBML for a single table
 */
function generateTableDBML(tableName, tableData) {
    // Use entity name (singular, business-focused) if LLM-enhanced
    const entityName = sanitizeTableName(tableName);
    let dbml = `Table ${entityName} {\n`;
    
    // Add entity description if available (LLM-enhanced)
    if (tableData.description || tableData._llmDescription) {
        const desc = tableData.description || tableData._llmDescription;
        dbml += `  Note: '${sanitizeString(desc)}'\n`;
    }
    
    //the sanitize means some optimize Table-Names..!

    const allColumns = tableData.columns || [];
    const columnCount = allColumns.length;
    
    // For very large tables (700+ columns), add a note
    if (columnCount > 500) {
        dbml += `  // Large entity: ${columnCount} attributes total\n`;
        dbml += `  // All attributes included below\n`;
    }

    //add the columns..!
    // Show ALL columns in DBML (complete schema)
    // Filter out derived attributes if they shouldn't be stored
    for (const column of allColumns) {
        // Skip derived attributes that are computed (not stored)
        if (column._llmIsDerived && column._llmIsDerived === true) {
            // Still include but mark as derived
        }
        
        const columLine = generateColumnDBML(column);//so here we are iterating over the columns and generating the dbml for each column..!
        dbml += `  ${columLine}\n`;//means pushing it..!
    }

    dbml += `}\n\n`;
    return dbml;
}

/**
 * Generate DBML for a single column
 */
/**
 * So basically we are creating the column-line for the dbml..!
 * The column-line will have the column-name and datatype..!
 * Then we wil have the attributes where it can have the primary-key,not-null,description..!
 */
function generateColumnDBML(column) {
    const colName = sanitizeColumnName(column.columnName);
    
    // Use LLM-enhanced logical type if available, otherwise map from physical type
    // Logical types ONLY: TEXT, NUMBER, DATE, BOOLEAN (NO INT, VARCHAR, DECIMAL)
    let logicalType = column._llmLogicalType || mapToLogicalType(column.dataType || "VARCHAR");
    
    // Ensure we're using logical types only (filter out any physical types)
    const logicalTypes = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN'];
    if (!logicalTypes.includes(logicalType)) {
        logicalType = 'TEXT'; // Default to TEXT if invalid type
    }

    let line = `${colName} ${logicalType}`;
    //the line will have the col-name and logical datatype..!

    //add the attributes..!
    const attributes = [];

    if (column.isPrimaryKey) {
        attributes.push('pk');
    }

    // Optional vs Mandatory (not null = mandatory)
    // In logical model, this represents optionality of relationship
    if (column.nullable === false) {
        attributes.push('not null');  // Mandatory attribute/relationship
    }

    // Enhanced description with business rules (prioritize LLM-enhanced)
    let enhancedDesc = column._llmDescription || generateEnhancedDescription(column);
    
    // Add business rule if available
    if (column._llmBusinessRule) {
        enhancedDesc = enhancedDesc 
            ? `${enhancedDesc}. Business rule: ${column._llmBusinessRule}`
            : `Business rule: ${column._llmBusinessRule}`;
    }
    
    if (enhancedDesc) {
        attributes.push(`note: '${sanitizeString(enhancedDesc)}'`);
    }

    // Unique constraint (business rule, not SQL constraint)
    if (column.isUnique && !column.isPrimaryKey) {
        attributes.push('unique');
    }
    
    // Mark derived attributes
    if (column._llmIsDerived) {
        attributes.push('note: \'Derived attribute (computed, not stored)\'');
    }

    if (attributes.length > 0) {
        //if the attributes array is > 1 then we have to join for the description part..!
        //like Yes,no-null,Description..!
        line += ` [${attributes.join(', ')}]`;
    }

    return line;
}

/**
 * Generate relationships for a table with cardinality notation
 * DBML supports: > (one-to-many), - (one-to-one), < (many-to-one)
 * Optional relationships: >? (optional one-to-many), -? (optional one-to-one)
 */
function generateRelationshipsDBML(tableName, tableData) {
    let dbml = "";
    /**
     * As the relationship means here the flow from source to destination..!
     * From-table-column->to-Table->Column...!
     * 
     * Cardinality notation:
     * - > = one-to-many (parent > child)
     * - < = many-to-one (child < parent)
     * - - = one-to-one
     * - >? = optional one-to-many
     * - <? = optional many-to-one
     */

    // Use LLM-enhanced relationships if available
    const llmRelationships = tableData._llmRelationships || [];
    
    if (llmRelationships.length > 0) {
        // Use LLM-enhanced relationships with proper cardinality and optionality
        for (const rel of llmRelationships) {
            const fromTable = sanitizeTableName(tableName);
            const toTable = sanitizeTableName(rel.targetEntity);
            
            // Map cardinality to DBML notation
            let cardinalitySymbol = '';
            if (rel.cardinality === '1-N') {
                cardinalitySymbol = rel.optionality === 'optional' ? '>?' : '>';
            } else if (rel.cardinality === 'N-1') {
                cardinalitySymbol = rel.optionality === 'optional' ? '<?' : '<';
            } else if (rel.cardinality === '1-1') {
                cardinalitySymbol = rel.optionality === 'optional' ? '-?' : '-';
            } else {
                cardinalitySymbol = '<'; // Default
            }
            
            // Find the FK column for this relationship
            const fkColumn = tableData.columns?.find(c => 
                c.isForeignKey && 
                c.referencesTable?.toLowerCase() === rel.targetEntity.toLowerCase()
            );
            
            if (fkColumn) {
                const fromColumn = sanitizeColumnName(fkColumn.columnName);
                const toColumn = sanitizeColumnName(fkColumn.referencesColumn || 'id');
                
                // Add relationship with cardinality and optionality
                dbml += `Ref: ${fromTable}.${fromColumn} ${cardinalitySymbol} ${toTable}.${toColumn}\n`;
                
                // Add relationship name and description
                if (rel.relationshipName) {
                    dbml += `  // Relationship: "${rel.relationshipName}"\n`;
                }
                if (rel.description) {
                    dbml += `  // ${rel.description}\n`;
                }
                if (rel.optionality === 'optional') {
                    dbml += `  // Optional: ${fromTable} can exist without ${toTable}\n`;
                } else {
                    dbml += `  // Mandatory: ${fromTable} must have ${toTable}\n`;
                }
            }
        }
    } else {
        // Fallback to heuristic-based relationships
        for (const column of tableData.columns || []) {
            //iterate over the column..!
            //and create the Relationship..!
            if (column.isForeignKey && column.referencesTable && column.referencesColumn) {
                const fromTable = sanitizeTableName(tableName);
                const fromColumn = sanitizeColumnName(column.columnName);
                const toTable = sanitizeTableName(column.referencesTable);
                const toColumn = sanitizeColumnName(column.referencesColumn);

                // Determine cardinality and optionality
                // FK column means: many (fromTable) -> one (toTable)
                // If nullable FK, it's optional relationship
                const isOptional = column.nullable !== false;
                const cardinalitySymbol = isOptional ? '<?' : '<';  // many-to-one (FK side)
                
                // Add relationship with cardinality
                dbml += `Ref: ${fromTable}.${fromColumn} ${cardinalitySymbol} ${toTable}.${toColumn}\n`;
                
                // Add business rule note if applicable
                if (isOptional) {
                    dbml += `  // Optional relationship: ${fromTable} can exist without ${toTable}\n`;
                } else {
                    dbml += `  // Mandatory relationship: ${fromTable} must have ${toTable}\n`;
                }
            }
        }
    }

    return dbml;
}

/**
 * Sanitize Table Name for DBML;
 */
function sanitizeTableName(name) {
    // Handle spaces and special characters
    if (name.includes(' ') || name.includes('-')) {
        return `"${name}"`;
    }
    return name;
}

/**
 * Sanitize Column Name for DBML;
 */
function sanitizeColumnName(name) {
    // Handle spaces and special characters
    if (name.includes(' ') || name.includes('-')) {
        return `"${name}"`;
    }
    return name;
}

/**
 * Sanitize string for DBML notes
 */
function sanitizeString(str) {
    if (!str) return '';//if no string return empty...!
    //if yes..!
    return str.replace(/'/g, "\\'").substring(0, 200);//means replace the single quote with the double quote..!
    //// Limit to 200 chars
}

/**
 * Save DBML to file
 */
export async function saveDBML(fileId, dbmlContent) {
    //we have to write it for the saving part..!
    try {
        // Create organized folders
        const paths = await ensureFolders(fileId);
        
        // Save DBML in dbml/ folder
        const dbmlPath = join(paths.dbml, 'schema.dbml');

        //write it.!
        await writeFile(dbmlPath, dbmlContent, "utf-8");

        logger.info({
            fileId,
            path: dbmlPath
        }, 'DBML-Saved-Successfully..!');
        return dbmlPath;//means return the path of the dbml file..!

    } catch (error) {
        logger.error({
            error: error.message,
            fileId
        }, 'Failed-to-Save-DBML..!');
        throw error;
    }
}
