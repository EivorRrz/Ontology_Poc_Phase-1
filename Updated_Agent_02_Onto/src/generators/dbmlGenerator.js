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

/**
 * Generate DBML from metadata
 * @param {Object} metadata - Metadata object from storage
 * @returns {Promise<string>} Generated DBML content
 */
export async function generateDBML(metadata) {
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

        //add all the things i want to see in the dbml..!
        /**
         * Add everything i want to see in the dbml..!
         */
        let dbml = `//Database-Schema:${metadata.originalName}\n`;
        dbml += `// Generated: ${new Date().toISOString()}\n`;
        dbml += `// Tables: ${metadata.metadata.tableCount}\n`;
        dbml += `// total-Columns:${metadata.metadata.rowCount}\n\n`;

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
    let dbml = `Table ${sanitizeTableName(tableName)} {\n`;
    //the sanitize means some optimize Table-Names..!

    //add the columns..!
    for (const column of tableData.columns) {
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
    const datatype = column.dataType || "VARCHAR";

    let line = `${colName} ${datatype}`;
    //the line will have the col-name and datatype..!

    //add the attributes..!
    const attributes = [];

    if (column.isPrimaryKey) {
        attributes.push('pk');
    }

    if (column.nullable === false) {
        attributes.push('not null');
    }

    if (column.description) {
        attributes.push(`note: '${sanitizeString(column.description)}'`);
    }

    if (attributes.length > 0) {
        //if the attributes array is > 1 then we have to join for the description part..!
        //like Yes,no-null,Description..!
        line += ` [${attributes.join(', ')}]`;
    }

    return line;
}

/**
 * Generate relationships for a table
 */
function generateRelationshipsDBML(tableName, tableData) {
    let dbml = "";
    /**
     * As the relationship means here the flow from source to destination..!
     * From-table-column->to-Table->Column...!
     */

    for (const column of tableData.columns) {
        //iterate over the column..!
        //and create the Relationship..!
        if (column.isForeignKey && column.referencesTable && column.referencesColumn) {
            const fromTable = sanitizeTableName(tableName);
            const fromColumn = sanitizeColumnName(column.columnName);
            const toTable = sanitizeTableName(column.referencesTable);
            const toColumn = sanitizeColumnName(column.referencesColumn);

            dbml += `Ref: ${fromTable}.${fromColumn} > ${toTable}.${toColumn}\n`;
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
        const artifactDir = join(config.storage.artifactsDir, fileId);
        const dbmlPath = join(artifactDir, 'schema.dbml');

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
