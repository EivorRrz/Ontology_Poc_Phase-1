/**
 * @Module PK/FK Inference Heuristics
 * @Description Auto-detect Primary Keys and Foreign Keys using pattern matching
 */

import logger from "../utils/logger.js";

/**
 * Main function to infer PK/FK relationships
 * @param {Array} metadata - Array of column metadata objects
 * @returns {Array} Enhanced metadata with inferred PK/FK
 */

//as the metadata will be the array of columns and we have to infer the pk/fk relationships..!

export const inferPkFK = function (metadata) {
    //as we have to take the pk-fk 
    //we have to get the metadata from the columns..!
    if (!metadata || metadata.length === 0) {
        return metadata;
    };
    //if the table is there..!
    //group metadata by tables..!
    /**
     * @description so here the metadata can be the array of colomuns of any bussiness model..!
     */
    const tableGroups = groupByTable(metadata);
    /**
     * so it will be in Object-Format like this..!
     * {
     *  table1:[column1,column2,column3],
     *  table2:[column4,column5,column6],
     * }
     * @abstract as all this are in the key-value-pairs so we can take the key from it..!
     */

    //track inference statistics..!
    const stats = {
        totalColumns: metadata.length,
        /**
         * explicit means already mentioned by the user..!
         * inferred means automatically inferred by the system..!
         */
        explicitPK: 0,
        inferredPK: 0,
        explicitFK: 0,
        inferredFK: 0,
    };
    //GET THE all table names for fk matching..!
    const tableNames = Object.keys(tableGroups);

    //process each table..!
    //process each-Table and we can push the columns with pk-fk inferred into the enhancedMetaData..!
    const enhancedMetaData = [];

    for (const tableName of tableNames) {
        //infer pk-fk for the current table..!
        //means for the current table we have to infer the pk-fk relationships..!
        /**
         * @abstract as the tableName is the part of metadata so we can take the columns from it..!
         */
        const columns = tableGroups[tableName];
        
        //First infer PKs, then FKs on the same columns
        inferPrimaryKeys(columns, stats);
        inferForeignKeys(columns, tableNames, tableGroups, stats);
        
        //Add processed columns to result
        enhancedMetaData.push(...columns);
    };
    logger.info({
        stats,
        tables: tableNames.length,//as much tablesNames means that much table..!
        enhancedMetaData_length: enhancedMetaData.length,//means the length of the enhancedMetaData..!
    }, "PK/FK inference Completed..!")

    //Return the enhanced metadata with inferred PK/FK
    //Attach stats to metadata for later retrieval
    enhancedMetaData._inferenceStats = stats;
    return enhancedMetaData;
}

/**
 * Get inference statistics from processed metadata
 * @param {Array} metadata - Processed metadata with inference
 * @returns {Object} Statistics about PK/FK inference
 */
export function getInferenceStats(metadata) {
    if (metadata && metadata._inferenceStats) {
        return metadata._inferenceStats;
    }
    
    // Calculate stats if not cached
    const stats = {
        totalColumns: metadata ? metadata.length : 0,
        explicitPK: 0,
        inferredPK: 0,
        explicitFK: 0,
        inferredFK: 0,
    };
    
    if (metadata) {
        for (const col of metadata) {
            if (col.isPrimaryKey) {
                if (col._pkSource === 'explicit') stats.explicitPK++;
                else stats.inferredPK++;
            }
            if (col.isForeignKey) {
                if (col._fkSource === 'explicit' || col._fkSource === 'explicit_reference') stats.explicitFK++;
                else stats.inferredFK++;
            }
        }
    }
    
    return stats;
}
/**
 * @description Helper-Funtion to group the metaData by Tables..!
 */

function groupByTable(metadata) {
    //as this function will take metadata..!
    /**
     * the Example where it took the metaData({tableNames})
     * And infer the pk/fk ..!
     */
    const groups = {};
    /**
     * we are iterating over the metadata and group the columns by the table-name..!
     */
    for (const col of metadata) {
        const table = col.tableName || col.table_name || "unknown";
        if (!groups[table]) {
            /**
             * as the group will contain the tables that has been-Group-BY(metadata..!)
             */
            groups[table] = [];//means the table is not there so we have to create it..!
        }
        //or else..!
        //if the table is there then we have to push the column into the table..!
        groups[table].push({ ...col })
    }
    return groups;
}
/**
 * Infer Primary Keys for a table'
 * @description This helper-Function will take the columns of the table and infer the primary key..!
 */

function inferPrimaryKeys(columns, stats) {
    /**
     * Already it has all the primary-Keys there..!
     */
    //check if any column already has explicitly mentioned as primary key..!
    const explicitPK = columns.filter(col => col.isPrimaryKey === true);

    //so if it has been mentioned then we have to increment the stats..!
    if (explicitPK.length > 0) {
        //count explicit PKs..!
        columns.forEach(col => {
            if (col.isPrimaryKey === true) {
                col._pkSource = "explicit";
                if (stats) stats.explicitPK++;
            }
        });
        return; // Already has explicit PKs, no need to infer
    }
    //No explicit PK - try to infer
    let pkFound = false;

    //Method-1 look for column-Based 'id or {tablename}_id'  or "{tablename}id"
    /**
     * So here iterating over each column of table..!
     * converting columna name and table name to lowerCase..!
     * trying to infer a primary key using naming-conversion like..!
     * id
     * {tablename}_id
     * {tablename}id
     * if any columns matches mark it as primary-Key..!
     * 
     * 
     */

    for (const col of columns) {
        //first iterate overa all the columns & Table  and then lowerCase it..!
        //here the columnName is the name of the column and tableName is the name of the table..!
        const collower = col.columnName.toLowerCase();
        const tableName = (col.tableName || "").toLowerCase()

        //the rules-Based-logic..!
        if (
            /**
             * This means its checking if any of this case passes..!
             */
            collower === "id" ||
            collower === `${tableName}_id` ||
            collower === `${tableName}id`
        ) {
            //so..!
            col.isPrimaryKey = true;
            col._pkSource = 'inferred_id_pattern';
            if (stats) stats.inferredPK++;
            pkFound = true;
            logger.debug({
                table: col.tableName,
                columns: col.columnName
            }, "Inferred PK using id-Pattern..!")
            break;

        }
    };
    //step-2..!
    //look for column ending with _id and Id that matches the table_Name..!
    if (!pkFound) {
        for (const col of columns) {
            //iterate over columns..!
            const collower = col.columnName.toLowerCase();
            if (collower.endsWith('_id') || collower.endsWith('id')) {
                //check if its a likely a Pk (not referencing another table)
                /**
                 * the role of prefix here is to remove the _id or id from the column name..!
                 * then we will compare the prefix with the table name..!
                 * means the prefix and tablename is equal means its a primary-Key..!
                 * 
                 */
                //take the Table name and replace the id with emopty string.
                //and match with the columns..!
                const prefix = collower.replace(/_?id$/i, '');//means removing the _id or id from the column name..!
                const tableLower = (col.tableName || "").toLowerCase();
                /** 
                 * SO for tables Users
                 * it has the Column like User_id,User_id,userId
                 * so here the prefix will be User and tableLower will be users
                 * so its a primary-Key..!
                 */
                //or even if the prefix === ""
                //if we compare them we can make it primary-Key..!


                if (prefix === tableLower || prefix === "") {
                    col.isPrimaryKey = true;
                    col._pkSource = 'inferred_suffix_pattern'; //✅ FIXED: added underscore
                    if (stats) stats.inferredPK++;
                    pkFound = true;
                    logger.debug({
                        table: col.tableName,
                        columns: col.columnName
                    }, "Inferred PK using suffix-Pattern..!")
                    break;
                }
            }
        }
    }
    //step-3...!
    //first-Column if it looks like an Id-Type..!s
    if (!pkFound) {
        const firstCol = columns[0];//get the first-column(as[0])..!
        if (firstCol) {
            //if the firstCOl is there..!
            //means we will check whts the dataType is the first column..!
            //so here we will get the typeData in the first Column..!
            //the column-Name is the name of the column and dataType is the type of the column..!
            const typeLower = (firstCol.dataType || "").toLowerCase();
            const nameLower = firstCol.columnName.toLowerCase();

            ///if the first-column is integer or contains === Id..!
            if (typeLower.includes("int") ||
                typeLower.includes("serial") ||
                typeLower.includes("number") ||
                nameLower.includes("id")//if the the column name contains id means its a primary-Key..!
            ) //so here serial is the type of the column and it is a primary-Key..!
            {
                firstCol.isPrimaryKey = true;
                firstCol._pkSource = 'inferred_id_type';
                if (stats) stats.inferredPK++;
                pkFound = true;
                logger.debug({
                    table: firstCol.tableName,
                    columns: firstCol.columnName
                }, "Inferred PK using id-Type..!")

            }

        }
    }
    //return the columns..!
    return columns;

}

/**
 * Infer Foreign Keys for a table'
 * @description This helper-Function will take the columns of the table and infer the foreign key..!
 */

function inferForeignKeys(columns, allTableNames, tableGroups, stats) {
    /**
     * we will take the parameter as columns,allTableNames,TableGroup-Stats..!
     */

    for (const col of columns) {
        //skip if already pk..!
        if (col.isPrimaryKey) continue;//means if the column is a primary-Key then skip it..!

        //check if explicit fk..!
        if (col.isForeignKey === true) {
            col._fkSource = "explicit";
            if (stats) stats.explicitFK++;
            // Keep existing referencesTable/referencesColumn from parser
            continue;
        }
        //check for dotted reference..!
        //customer.id in orders table..!
        // Note: referencesTable and referencesColumn are now parsed by the parser
        if (col.references && col.references.includes(".")) {
            col.isForeignKey = true;
            col._fkSource = "explicit_reference";
            col.referencesTable = col.references.split(".")[0];
            col.referencesColumn = col.references.split(".")[1];
            if (stats) stats.explicitFK++; //✅ FIXED: was inferredPK
            continue;
        }

        //try to infer pk..!
        const collower = col.columnName.toLowerCase();

        //step-1 column Name matches pattern..!({table})
        for (const otherTable of allTableNames) {
            if (otherTable === col.tableName) continue;
            //skip if its the same table..!
            const otherTableLower = otherTable.toLowerCase();

            if (
                /**
                 * even if it matches any thing like _id or id or _fk or fk_ means its a foreign key..!
                 */
                collower === `${otherTableLower}_id` ||
                collower === `${otherTableLower}id` ||
                collower === `${otherTableLower}_fk` ||
                collower === `fk_${otherTableLower}`
            ) {
                //find the pk of referenced table...!
                const refTableCols = tableGroups[otherTable] || [];//means group the table with this parameter.>!
                const refPK = refTableCols.find(c => c.isPrimaryKey)

                //response.!
                col.isForeignKey = true;
                col._fkSource = 'inferred_pattern';
                col.referencesTable = otherTable;
                col.referencesColumn = refPK ? refPK.columnName : 'id';
                col.references = `${otherTable}.${col.referencesColumn}`;
                if (stats) stats.inferredFK++;

                //on to monitoring.>!
                logger.debug({
                    table: col.tableName,
                    columns: col.columnName,
                    references: col.references,

                }, "Inferred FK using pattern..!")
                break;


            }
        }
        // Strategy 2: Column ends with _id and prefix matches a table
        if (!col.isForeignKey && (collower.endsWith('_id') || collower.endsWith('id'))) {
            const prefix = collower.replace(/_?id$/i, '');

            // Check if prefix matches any table name
            for (const otherTable of allTableNames) {
                if (otherTable === col.tableName) continue;

                const otherTableLower = otherTable.toLowerCase();

                // Check for singular/plural matches
                if (
                    prefix === otherTableLower ||
                    prefix === otherTableLower + 's' ||
                    prefix + 's' === otherTableLower ||
                    prefix === otherTableLower.slice(0, -1) // Remove trailing 's'
                ) {
                    const refTableCols = tableGroups[otherTable] || [];
                    const refPK = refTableCols.find(c => c.isPrimaryKey);

                    col.isForeignKey = true;
                    col._fkSource = 'inferred_prefix_match';
                    col.referencesTable = otherTable;
                    col.referencesColumn = refPK ? refPK.columnName : 'id';
                    col.references = `${otherTable}.${col.referencesColumn}`;
                    if (stats) stats.inferredFK++;

                    logger.debug({
                        table: col.tableName,
                        column: col.columnName,
                        references: col.references
                    }, 'Inferred FK by prefix match');
                    break;
                }
            }
        }
    }

    return columns;
}

