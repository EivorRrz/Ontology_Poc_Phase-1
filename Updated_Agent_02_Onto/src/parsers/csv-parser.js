/**
 * @Description CSV-Parser using csv-parse..!
 * Parse-CSV File and return the data in the form of json..!
 */

import { parse } from "csv-parse/sync";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import logger from "../utils/logger.js";


/**
 * Parse CSV file and extract metadata
 * @param {string} filePath - Path to CSV file
 * @returns {Array} Array of normalized metadata rows
 */

export const parseCSV = async (filePath) => {
    /**
     * csv-parse reads the CSV file from the filePath..!
     * we will provide the file path here..!
     */
    try {
        //Resolve to absolute path..!
        const absolutePath = resolve(filePath);
        
        //log it to get the info..!
        logger.info({ filePath, absolutePath }, "Parsing-CSV-File..!");
        
        //Check if file exists..!
        if (!existsSync(absolutePath)) {
            throw new Error(`File not found: ${absolutePath}`);
        }
        
        //Read-File..!
        /**
         * @description it will read the CSV file and parse it into JSON array..!
         */

        //Read-File-Content..!
        let fileContent = readFileSync(absolutePath, 'utf-8');//read the file content as UTF-8 string..!
        
        //Remove BOM (Byte Order Mark) if present - common issue with Windows CSV files
        if (fileContent.charCodeAt(0) === 0xFEFF) {
            fileContent = fileContent.slice(1);
        }

        //Parse-CSV-with-headers..!
        const rawData = parse(fileContent, {
            columns: true,//use first row as headers..!
            skip_empty_lines: true,//skip empty lines..!
            trim: true,//trim whitespace..!
            relax_quotes: true,//relax quote handling..!
            relax_column_count: true,//allow different column counts..!
            cast: (value, context) => {
                //Keep as string for metadata parsing..!
                return value === '' ? null : value;
            }
        });

        //return the response..!
        logger.info({
            rowCount: rawData.length,
        }, "CSV-Data-Parsed-Successfully");

        return rawData;
    } catch (error) {
        logger.error({ error, filePath }, "Error-Parsing-CSV-File");
        throw new Error(`Failed to Parse CSV-File : ${error.message}!`);
    }
}

/**
 * Detect metadata columns in the parsed Json..(like table-name,column-name-data-type-PK/FK..!)
 * Validate required columns,and produce a normalized metadata list..!
 */
//So here we have to detect the metadata format and derive the columns..!

//Guard-Clause..!
//means check if the raw-Data is there || or the length is there or not..!
export const extractMetaDataFromCSV = (rawData) => {
    if (!rawData || rawData.length === 0) {//if the rawData is not here and length==0..!
        throw new Error("No-Data-To-Extract-Metadata..!");
    }

    /**
     * takes the first-row and extracts its keys (column-names) to understand the header strcuture.!
     * raw-Data is nothing just information generated after the extraction of the CSV file..!
     */
    const firstRow = rawData[0];//means the keys of it..!
    //we will take the first row object..!
    const keys = Object.keys(firstRow);//and then we will get the keys from the first row object..!


    //common column name-Patterns..!
    /**
     * The probality of all common name-patterns we can use heree..!
     * Added patterns with spaces for files (e.g., "Table Name", "Column Name")
     */
    const tableNamePatterns = ['table', 'table_name', 'tablename', 'table name', 'tableName', 'entity', 'entity_name', 'entity name'];
    const columnNamePatterns = ['column', 'column_name', 'columnname', 'column name', 'columnName', 'field', 'field_name', 'field name', 'attribute', 'attribute name', 'attribute_name'];
    const dataTypePatterns = ['type', 'data_type', 'datatype', 'data type', 'dataType', 'column_type', 'column type'];
    const pkPatterns = ['pk', 'primary_key', 'primarykey', 'primary key', 'primaryKey', 'is_pk', 'isPK', 'is pk'];
    const fkPatterns = ['fk', 'foreign_key', 'foreignkey', 'foreign key', 'foreignKey', 'is_fk', 'isFK', 'is fk'];
    const referencesPatterns = ['references', 'reference', 'ref', 'references_table', 'referenced_column'];
    const descPatterns = ['description', 'desc', 'comment', 'notes', 'entity description', 'attribute description'];
    const nullablePatterns = ['nullable', 'null', 'required', 'is_nullable', 'is nullable'];

    /**
     * Normalize keys to lowerCase for matching..!
     */
    //we can iterate over the keys..!
    const normalizedKeys = {};//it will contains all the normalized keys..!
    for (let key of keys) {
        const lowerKey = key.toLowerCase().trim();
        normalizedKeys[lowerKey] = key;//update it here..!
    }

    // Find matching columns
    /**
     * Uses a helper findKey to match the normalized header map against each pattern list, returning the actual header name used in the sheet.
     */
    const tableNameKey = findKey(normalizedKeys, tableNamePatterns);
    const columnNameKey = findKey(normalizedKeys, columnNamePatterns);
    const dataTypeKey = findKey(normalizedKeys, dataTypePatterns);
    const pkKey = findKey(normalizedKeys, pkPatterns);
    const fkKey = findKey(normalizedKeys, fkPatterns);
    const referencesKey = findKey(normalizedKeys, referencesPatterns);
    const descKey = findKey(normalizedKeys, descPatterns);
    const nullableKey = findKey(normalizedKeys, nullablePatterns);


    //Validate-Required-Fields..!
    // Only Table Name and Column Name are truly required
    // Data Type can be inferred/defaulted if missing
    if (!tableNameKey || !columnNameKey) {
        throw new Error(
            `Missing required columns. Found: ${keys.join(', ')}. ` +
            `Required: Table Name, Column Name`
        );
    }
    
    // Log warning if Data Type is missing
    if (!dataTypeKey) {
        logger.warn('Data Type column not found. Will use VARCHAR as default.');
    }

    // Extract metadata rows
    /**
     * means we will iterate over the rawData and return the metadata..!
     */
    const metaData = rawData.map((row, index) => {

        /**
         * get the values from rows and trim it..!
         */
        const tableName = String(row[tableNameKey] || '').trim();//GET THE TABLE-NAME
        const columnName = String(row[columnNameKey] || '').trim();//GET THE COLUMN-NAME
        const dataType = dataTypeKey ? String(row[dataTypeKey] || '').trim() : 'VARCHAR';//GET THE DATA-TYPE or default to VARCHAR

        //skip the empty-rows..!
        // Only tableName and columnName are required
        if (!tableName || !columnName) {
            return null;
        }
        
        // Parse references field (e.g., "customer.id" → table=customer, column=id)
        let referencesTable = undefined;
        let referencesColumn = undefined;
        if (referencesKey && row[referencesKey]) {
            const refValue = String(row[referencesKey]).trim();
            if (refValue && refValue.includes('.')) {
                const parts = refValue.split('.');
                referencesTable = parts[0].trim();
                referencesColumn = parts[1]?.trim();
            }
        }
        
        return {
            tableName,
            columnName,
            dataType: normalizeDataType(dataType),//COME IN LOWERcASE..!
            isPrimaryKey: parseBoolean(row[pkKey]),//✅ FIXED: was isPrimary
            isForeignKey: parseBoolean(row[fkKey]),//either true or false..!
            referencesTable,//store the referenced table
            referencesColumn,//store the referenced column
            description: row[descKey] ? String(row[descKey]).trim() : undefined,
            nullable: row[nullableKey] !== undefined ? parseBoolean(row[nullableKey], true) : undefined,
            _sourceRow: index + 2, // CSV row number (1-indexed + header)
        };
    }).filter(row => row !== null);

    logger.info({
        metadataCount: metaData.length,
        tables: [...new Set(metaData.map(m => m.tableName))].length
    }, 'Metadata extracted from CSV');

    return metaData;
}

//helper-function to find key matching patterns..!
function findKey(normalizedKeys, patterns) {
    //it will take to match all pattern in normalized key to  common-Patterns..!
    for (const pattern of patterns) {
        if (normalizedKeys[pattern]) {
            return normalizedKeys[pattern];
        }
    }
    return null;//return null if no pattern matches..!
}

//Helper-Function to parse boolean values..!
function parseBoolean(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    //if the value is there then convert it to the string and trim->toLowerCase()->Trim();
    const str = String(value).trim().toLowerCase();
    return str === 'true' || str === 'yes' || str === '1' || str === 'y' || str === 'pk' || str === 'fk';
}

/**
 * Helper-function to normalize data-type-string..!
 */

function normalizeDataType(dataType) {
    if (!dataType) return 'VARCHAR';

    const normalized = String(dataType).toUpperCase().trim();

    //cOMMON mappings.!
    const typeMap = {
        'STRING': 'VARCHAR',
        'TEXT': 'VARCHAR',
        'CHAR': 'VARCHAR',
        'INT': 'INTEGER',
        'INTEGER': 'INTEGER',
        'BIGINT': 'BIGINT',
        'FLOAT': 'REAL',
        'DOUBLE': 'DOUBLE PRECISION',
        'DECIMAL': 'DECIMAL',
        'NUMERIC': 'NUMERIC',
        'BOOLEAN': 'BOOLEAN',
        'BOOL': 'BOOLEAN',
        'DATE': 'DATE',
        'TIME': 'TIME',
        'DATETIME': 'TIMESTAMP',
        'TIMESTAMP': 'TIMESTAMP',
        'UUID': 'UUID',
        'JSON': 'JSONB',
        'JSONB': 'JSONB',
    };
    return typeMap[normalized] || normalized;//either return the typeMap[normalized] or the normalized itself..!
}
