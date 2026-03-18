/**
 * @Description Excel-Parser @=SheetJs.>!
 * Parse-Excel File and return  the data in the form of json..!
 */

import XLSX from "xlsx";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import logger from "../utils/logger.js";


/**
 * Parse Excel file and extract metadata
 * @param {string} filePath - Path to Excel file
 * @returns {Array} Array of normalized metadata rows
 */

export const parseExcel = async (filePath) => {
    /**
     * xlsx.readfile loads the workbook from the filePath..!
     * we will provide the file path here..!
     */
    try {
        //Resolve to absolute path..!
        const absolutePath = resolve(filePath);
        
        //log it to get the info..!
        logger.info({ filePath, absolutePath }, "Parsing-Excel-File..!");
        
        //Check if file exists..!
        if (!existsSync(absolutePath)) {
            throw new Error(`File not found: ${absolutePath}`);
        }
        
        //Read-Workbook..!
        /**
         * @description it will read the workbook using buffer (better for Windows)
         */

        //Read file as buffer first (more reliable on Windows)
        const fileBuffer = readFileSync(absolutePath);
        
        //Read-Book from buffer..!
        const workBook = XLSX.read(fileBuffer, {//read from buffer instead of file path
            type: 'buffer',
            cellDates: true,//Convert the dates to date Object..!
            cellNF: false,//Convert the numbers to number Object..!
            cellText: false,//convert the text to text-Object.!
        });

        /**
         * @abstract read the file form the path and store in workbook
         * NOW READS ALL SHEETS (not just first one!)
         */
        //===========================================
        // READ ALL SHEETS (1, 2, 3, 4, 5, 6... ALL!)
        //===========================================
        let allData = [];
        const sheetNames = workBook.SheetNames; // Get all sheet names
        
        logger.info({ 
            totalSheets: sheetNames.length, 
            sheets: sheetNames 
        }, "Found sheets in Excel file");

        // Loop through EVERY sheet
        for (let i = 0; i < sheetNames.length; i++) {
            const sheetName = sheetNames[i];
            const worksheet = workBook.Sheets[sheetName];
            
            //convert sheet to JSON-array..!
            const rawData = XLSX.utils.sheet_to_json(worksheet, {
                defval: null,//use null for empty-cells..!
                raw: false,//get formatted values..!
            });
            
            // Skip empty sheets
            if (rawData.length === 0) {
                logger.warn({ sheetName, sheetNumber: i + 1 }, "Sheet is empty, skipping");
                continue;
            }
            
            // Add source sheet info to each row
            const dataWithSource = rawData.map(row => ({
                ...row,
                _sourceSheet: sheetName,
                _sheetNumber: i + 1,
            }));
            
            logger.info({ 
                sheetName, 
                sheetNumber: i + 1,
                rowCount: rawData.length 
            }, "Parsed sheet successfully");
            
            // Combine all data
            allData = allData.concat(dataWithSource);
        }

        //return the combined response from ALL sheets..!
        logger.info({
            totalSheets: sheetNames.length,
            totalRows: allData.length,
            sheetNames: sheetNames,
        }, "Excel-Data-Parsed-Successfully (ALL SHEETS!)");

        return allData;
    } catch (error) {
        logger.error({ error, filePath }, "Error-Parsing-Excel-File");
        throw new Error(`Failed to Parse Excel-File : ${error.message}!`);
    }
}

/**
 * Detect metadata columns in the parsed Json..(like table-name,column-name-data-type-PK/FK..!)
 * Validate required columns,and produce a normalized metadata list..!
 */
//So here we have to detect the metadata format and derive the columns..!

//Guard-Clause..!
//means check if the raw-Data is there || or the length is there or not..!
export const extractMetaDataFromExcel = (rawData) => {
    if (!rawData || rawData.length === 0) {//if the rawData is not here and length==0..!
        throw new Error("No-Data-To-Extract-Metadata..!");
    }

    /**
     * takes the first-row and extracts its keys (column-names) to understand the header strcuture.!
     * raw-Data is nothing just information generated after the extraction of the excel file..!
     */
    const firstRow = rawData[0];//means the keys of it..!
    //we will take the first row object..!
    const keys = Object.keys(firstRow);//and then we will get the keys from the first row object..!


    //common column name-Patterns..!
    /**
     * The probality of all common name-patterns we can use heree..!
     * Added patterns with spaces for Excel files (e.g., "Table Name", "Column Name")
     * NEW: Added Domain, Sub-domain, Entity Description, Attribute Description patterns
     */
    const domainPatterns = ['domain', 'domain_name', 'domain name'];
    const subDomainPatterns = ['subdomain', 'sub_domain', 'sub-domain', 'sub domain', 'subdomain_name', 'sub_domain_name', 'sub domain']; // Added 'sub domain' (capital D)
    const tableNamePatterns = ['table', 'table_name', 'tablename', 'table name', 'tableName', 'entity', 'entity_name', 'entity name', 'entity name']; // Added 'entity name' (capital N)
    const entityDescPatterns = ['entity description', 'entity_description', 'entity_desc', 'table description', 'table_description', 'entity description']; // Added 'entity description' (capital D)
    const columnNamePatterns = ['column', 'column_name', 'columnname', 'column name', 'columnName', 'field', 'field_name', 'field name', 'attribute', 'attribute name', 'attribute_name', 'attribute name']; // Added 'attribute name' (capital N)
    const attributeDescPatterns = ['attribute description', 'attribute_description', 'attribute_desc', 'column description', 'column_description', 'attribute description']; // Added 'attribute description' (capital D)
    const dataTypePatterns = ['type', 'data_type', 'datatype', 'data type', 'dataType', 'column_type', 'column type', 'data type']; // Added 'data type' (capital T)
    const pkPatterns = ['pk', 'primary_key', 'primarykey', 'primary key', 'primaryKey', 'is_pk', 'isPK', 'is pk', 'pk']; // Added 'pk' (uppercase)
    const fkPatterns = ['fk', 'foreign_key', 'foreignkey', 'foreign key', 'foreignKey', 'is_fk', 'isFK', 'is fk', 'fk']; // Added 'fk' (uppercase)
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
    const domainKey = findKey(normalizedKeys, domainPatterns);
    const subDomainKey = findKey(normalizedKeys, subDomainPatterns);
    const tableNameKey = findKey(normalizedKeys, tableNamePatterns);
    const entityDescKey = findKey(normalizedKeys, entityDescPatterns);
    const columnNameKey = findKey(normalizedKeys, columnNamePatterns);
    const attributeDescKey = findKey(normalizedKeys, attributeDescPatterns);
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
     * NEW: Extracts Domain, Sub-domain, Entity Name, Entity Description, Attribute Name, Attribute Description
     */
    const metaData = rawData.map((row, index) => {

        /**
         * get the values from rows and trim it..!
         * NEW: Extract hierarchical structure fields
         */
        const domain = domainKey ? String(row[domainKey] || '').trim() : undefined;
        const subDomain = subDomainKey ? String(row[subDomainKey] || '').trim() : undefined;
        const entityName = String(row[tableNameKey] || '').trim();//GET THE ENTITY/TABLE-NAME
        const entityDescription = entityDescKey ? String(row[entityDescKey] || '').trim() : undefined;
        const attributeName = String(row[columnNameKey] || '').trim();//GET THE ATTRIBUTE/COLUMN-NAME
        const attributeDescription = attributeDescKey ? String(row[attributeDescKey] || '').trim() : undefined;
        
        // Backward compatibility: use entityName as tableName, attributeName as columnName
        // Sanitize names to remove special characters, quotes, and normalize
        const tableName = sanitizeName(entityName);
        const columnName = sanitizeName(attributeName);
        let dataType = dataTypeKey ? String(row[dataTypeKey] || '').trim() : 'VARCHAR';//GET THE DATA-TYPE or default to VARCHAR

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
                referencesTable = sanitizeName(parts[0].trim());
                referencesColumn = sanitizeName(parts[1]?.trim());
            }
        }
        
        // Normalize data type (if empty, will become VARCHAR)
        dataType = normalizeDataType(dataType);
        
        // Improve data type inference based on column name patterns
        // This will override VARCHAR defaults with better types when patterns match
        dataType = inferDataTypeFromColumnName(columnName, dataType);
        
        // Also check attribute description for type hints if dataType is still VARCHAR
        if (dataType === 'VARCHAR' && attributeDescription) {
            const descLower = String(attributeDescription).toLowerCase();
            if (descLower.includes('date') || descLower.includes('time') || descLower.includes('timestamp')) {
                dataType = 'TIMESTAMP';
            } else if (descLower.includes('amount') || descLower.includes('price') || descLower.includes('value') ||
                      descLower.includes('cost') || descLower.includes('rate') || descLower.includes('percent')) {
                dataType = 'DECIMAL';
            } else if (descLower.includes('count') || descLower.includes('quantity') || descLower.includes('number of')) {
                dataType = 'INTEGER';
            }
        }
        
        // Clean and normalize descriptions
        const cleanDescription = cleanDescriptionText(
            attributeDescription || (descKey ? String(row[descKey] || '').trim() : undefined)
        );
        const cleanEntityDescription = cleanDescriptionText(entityDescription);
        
        return {
            // NEW: Hierarchical structure fields
            domain: domain || undefined,
            subDomain: subDomain || undefined,
            entityName: tableName,
            entityDescription: cleanEntityDescription || undefined,
            attributeName: columnName,
            attributeDescription: cleanDescription || undefined,
            
            // Backward compatibility fields
            tableName,
            columnName,
            dataType,
            isPrimaryKey: parseBoolean(row[pkKey]),//either true or false...!
            isForeignKey: parseBoolean(row[fkKey]),//either true or false..!
            referencesTable,//store the referenced table
            referencesColumn,//store the referenced column
            description: cleanDescription || undefined,//Prefer attributeDescription
            nullable: row[nullableKey] !== undefined ? parseBoolean(row[nullableKey], true) : undefined,
            _sourceRow: index + 2, // Excel row number (1-indexed + header)
        };
    }).filter(row => row !== null);

    // Deduplicate: Remove duplicate table+column combinations
    const seen = new Set();
    const deduplicated = metaData.filter(col => {
        const key = `${col.tableName}::${col.columnName}`;
        if (seen.has(key)) {
            logger.debug({ table: col.tableName, column: col.columnName }, 'Removing duplicate column');
            return false;
        }
        seen.add(key);
        return true;
    });

    logger.info({
        metadataCount: deduplicated.length,
        duplicatesRemoved: metaData.length - deduplicated.length,
        tables: [...new Set(deduplicated.map(m => m.tableName))].length
    }, 'Metadata extracted from Excel');

    return deduplicated;
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

/**
 * Sanitize column/table names by removing special characters, quotes, and normalizing
 * @param {string} name - Raw name from Excel
 * @returns {string} Cleaned name
 */
function sanitizeName(name) {
    if (!name) return '';
    
    // Convert to string and trim
    let cleaned = String(name).trim();
    
    // Remove leading/trailing quotes (single or double)
    cleaned = cleaned.replace(/^['"]+|['"]+$/g, '');
    
    // Remove other special characters that shouldn't be in identifiers
    // Keep: letters, numbers, underscores, hyphens
    cleaned = cleaned.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Remove multiple consecutive underscores
    cleaned = cleaned.replace(/_+/g, '_');
    
    // Remove leading/trailing underscores
    cleaned = cleaned.replace(/^_+|_+$/g, '');
    
    // Ensure it's not empty
    if (!cleaned) return '';
    
    return cleaned;
}

/**
 * Infer better data type based on column name patterns
 * @param {string} columnName - Column name
 * @param {string} currentType - Currently inferred type
 * @returns {string} Improved data type
 */
function inferDataTypeFromColumnName(columnName, currentType) {
    if (!columnName) return currentType || 'VARCHAR';
    
    const colLower = columnName.toLowerCase();
    const typeUpper = (currentType || '').toUpperCase();
    
    // If current type is empty or default VARCHAR, be aggressive with inference
    const isDefaultType = !currentType || currentType === 'VARCHAR' || typeUpper === 'STRING' || typeUpper === 'TEXT' || currentType === '';
    
    // Date/time columns - HIGHEST PRIORITY (check first)
    if (colLower.includes('date') || colLower.includes('time') || 
        colLower === 'maturity' || colLower.includes('maturity') ||
        colLower.includes('expiry') || colLower.includes('expire') ||
        colLower.includes('created') || colLower.includes('updated') ||
        colLower.includes('start') || colLower.includes('end') ||
        colLower.includes('effective') || colLower.includes('expiration') ||
        colLower.includes('announce') || colLower.includes('settle') ||
        colLower.includes('delivery') || colLower.includes('fixdate') ||
        colLower.includes('fix_date') || colLower.includes('last_trade') ||
        colLower.includes('last trade') || colLower.includes('birth') ||
        colLower.includes('death') || colLower.includes('issue_date') ||
        colLower.includes('expiry_date') || colLower.includes('effective_date')) {
        // Always override if it's a date-related column name
        if (isDefaultType || typeUpper === 'VARCHAR' || typeUpper === 'STRING' || typeUpper === 'TEXT') {
            return 'TIMESTAMP';
        }
        // Fix incorrect types
        if (typeUpper === 'INTEGER' || typeUpper === 'BIGINT' || typeUpper === 'DECIMAL' || typeUpper === 'FLOAT') {
            return 'TIMESTAMP';
        }
    }
    
    // ID columns should typically be VARCHAR or INTEGER, not DATE
    if (colLower.endsWith('_id') || colLower.endsWith('id') || colLower === 'id') {
        // If it's incorrectly marked as DATE, change to VARCHAR (safer default for IDs)
        if (typeUpper === 'DATE' || typeUpper === 'TIMESTAMP' || typeUpper === 'TIME') {
            return 'VARCHAR';
        }
        // If no type specified or generic, default to VARCHAR for IDs
        if (isDefaultType) {
            return 'VARCHAR';
        }
    }
    
    // Boolean flags
    if (colLower.startsWith('is_') || colLower.startsWith('has_') || colLower.startsWith('can_') || 
        colLower.endsWith('_flag') || colLower === 'active' || colLower === 'enabled' ||
        colLower.includes('indicator') || colLower.includes('boolean')) {
        if (isDefaultType || typeUpper === 'VARCHAR' || typeUpper === 'STRING' || typeUpper === 'TEXT' || typeUpper === 'INTEGER') {
            return 'BOOLEAN';
        }
    }
    
    // Numeric columns - check for amount, price, value, etc.
    // BUT exclude country, currency, code fields that might contain these words
    if ((colLower.includes('count') || colLower.includes('amount') || colLower.includes('price') || 
        colLower.includes('quantity') || colLower.includes('total') || colLower.includes('balance') ||
        colLower.includes('value') || colLower.includes('cost') || colLower.includes('interest') ||
        colLower.includes('rate') || colLower.includes('yield') || colLower.includes('percent') ||
        colLower.includes('pct') || colLower.includes('fee') || colLower.includes('commission') ||
        colLower.includes('units') || colLower.includes('factor') || colLower.includes('multiplier') ||
        colLower.includes('spread') || colLower.includes('discount') || colLower.includes('premium') ||
        colLower.includes('principal') || colLower.includes('par') || colLower.includes('face') ||
        colLower.includes('coupon') || colLower.includes('dividend') || colLower.includes('nav') ||
        colLower.includes('mv') || colLower.includes('market_value') || colLower.includes('book_value') ||
        colLower.includes('commitment') || colLower.includes('contribution') || colLower.includes('distribution') ||
        colLower.includes('revenue') || colLower.includes('profit') || colLower.includes('margin') ||
        colLower.includes('gain') || colLower.includes('bonus') || colLower.includes('asset') ||
        colLower.includes('worth') || colLower.includes('income') || colLower.includes('wac') ||
        colLower.includes('wam') || colLower.includes('convexity') || colLower.includes('strike') ||
        colLower.includes('barrier') || colLower.includes('floor') || colLower.includes('cap') ||
        colLower.includes('shares') || colLower.includes('volume') || colLower.includes('vwap') ||
        colLower.includes('short_interest') || colLower.includes('shares_outstanding')) &&
        // Exclude string fields that might match numeric patterns
        !colLower.includes('country') && !colLower.includes('currency') && 
        !colLower.includes('code') && !colLower.includes('type') && 
        !colLower.includes('name') && !colLower.includes('description')) {
        // Override VARCHAR/STRING/TEXT/DATE to DECIMAL for numeric columns
        if (isDefaultType || typeUpper === 'VARCHAR' || typeUpper === 'STRING' || typeUpper === 'TEXT' || typeUpper === 'DATE') {
            return 'DECIMAL';
        }
    }
    
    // Integer-specific columns (counts, quantities that are whole numbers)
    if (colLower.includes('_count') || colLower.includes('_qty') || colLower.includes('_quantity') ||
        colLower.includes('sequence') || colLower.includes('sequence_number') ||
        colLower.includes('year') || colLower.includes('month') || colLower.includes('day') ||
        colLower.includes('age') || colLower.includes('version') || colLower.includes('level') ||
        colLower.includes('number') && !colLower.includes('account_number') && !colLower.includes('phone_number')) {
        if (isDefaultType || typeUpper === 'VARCHAR' || typeUpper === 'STRING' || typeUpper === 'TEXT') {
            return 'INTEGER';
        }
    }
    
    // String/code columns that shouldn't be numeric - HIGH PRIORITY (check before numeric)
    if (colLower.includes('code') || colLower.includes('type') || colLower.includes('method') ||
        colLower.includes('status') || colLower.includes('description') || colLower.includes('name') ||
        colLower.includes('identifier') || colLower.includes('text') || colLower.includes('comment') ||
        colLower.includes('notes') || colLower.includes('label') || colLower.includes('title') ||
        colLower.includes('category') || colLower.includes('class') || colLower.includes('sector') ||
        colLower === 'country' || colLower.includes('country') || 
        colLower.includes('currency') || colLower.includes('ccy') ||
        colLower.includes('ticker') || colLower.includes('symbol') || colLower.includes('cusip') ||
        colLower.includes('sedol') || colLower.includes('isin') || colLower.includes('ric') ||
        colLower.includes('exchange') || colLower.includes('issuer') || colLower.includes('broker') ||
        colLower.includes('trader') || colLower.includes('strategy') || colLower.includes('purpose') ||
        colLower.includes('source') || colLower.includes('channel') || colLower.includes('language') ||
        colLower.includes('document') || colLower.includes('authority') || colLower.includes('occupation') ||
        colLower.includes('branch') || colLower.includes('city') || colLower.includes('region') ||
        colLower.includes('state') || colLower.includes('province') || colLower.includes('address')) {
        // Always fix incorrect numeric/date types for string fields
        if (typeUpper === 'FLOAT' || typeUpper === 'REAL' || typeUpper === 'DOUBLE PRECISION' || 
            typeUpper === 'INTEGER' || typeUpper === 'BIGINT' || typeUpper === 'DECIMAL' ||
            typeUpper === 'DATE' || typeUpper === 'TIMESTAMP') {
            return 'VARCHAR';
        }
        // If default type and it's clearly a string field, keep as VARCHAR
        if (isDefaultType) {
            return 'VARCHAR';
        }
    }
    
    return currentType || 'VARCHAR';
}

/**
 * Clean and normalize description text
 * @param {string} text - Raw description
 * @returns {string|undefined} Cleaned description or undefined if empty
 */
function cleanDescriptionText(text) {
    if (!text) return undefined;
    
    const cleaned = String(text).trim();
    
    // Remove leading/trailing quotes
    const unquoted = cleaned.replace(/^['"]+|['"]+$/g, '').trim();
    
    // Return undefined if empty after cleaning
    if (!unquoted || unquoted === '') {
        return undefined;
    }
    
    return unquoted;
}
