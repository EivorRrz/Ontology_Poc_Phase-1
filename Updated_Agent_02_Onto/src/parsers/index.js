/**
 * @Main-Parser-..!
 */

import { extname } from "path";
import logger from "../utils/logger.js";
import { parseExcel, extractMetaDataFromExcel } from "./excelParser.js";
import { parseCSV, extractMetaDataFromCSV } from "./csv-parser.js";
import { inferPKFK } from "../heuristics/index.js";
import { analyzeMetadata, isLlmReady } from "../llm/index.js";

/**
 * Parse file and extract normalized metadata
 * @description Main Parser - Routes to appropriate parser based on fil
 * @param {string} filePath - Path to file
 * @param {string} originalName - Original filename
 * @returns {Promise<Array>} Normalized metadata array
 */


export async function parseMetadataFile(filePath, originalName) {
    try {
        // use the try/catch block..!
        const ext = extname(originalName).toLowerCase();//extname  means get the extension of the file..!
        //just adding the extname with the original name right..!

        logger.info({
            filePath,
            originalName,
            ext,
        }, "Parsing-Metadata-File..!");

        /**
         * So after we can match the extension so based on that we can route to the appropriate parser..!
         */
        //init the variables.!

        let rawData;//make the var for the rawData.!
        let metadata;//make the var for the metaData

        //Route to  appropriate Parser..!
        if (ext === ".xlsx" || ext === ".xls") {
            //we are just forwarding the file-Path to the parseExcel function..!
            rawData = await parseExcel(filePath);
            metadata = extractMetaDataFromExcel(rawData);//like after parsing the excel we can get the metadata from the excel file..!
        } else if (ext === ".csv") {
            //if csv..!
            rawData = await parseCSV(filePath);
            metadata = extractMetaDataFromCSV(rawData);//metdata..!
        } else {
            throw new Error(`Unsupported-File-Type: ${ext} , Supported-Types: .xlsx, .xls, .csv`)
        }

        //validate the metadata..!
        if (!metadata || metadata.length === 0) {
            throw new Error("No-Metadata-Extracted-From-File..!");
        };
        /**
         * Add here the Apply PK/FK inference..!
         */
        //so after the metadata we have got we can send it for the inference..!
        try {
            metadata = inferPKFK(metadata);//so after the inference we can get the metadata with the pk/fk relationships..!
        } catch (inferError) {
            logger.error({ 
                error: inferError.message, 
                stack: inferError.stack 
            }, 'PK/FK inference failed, returning metadata without inference');
            // Return metadata without inference if it fails
        }

        //===========================================
        // LLM Enhancement (if available)
        //===========================================
        try {
            if (isLlmReady()) {
                logger.info("LLM is ready, enhancing with AI analysis...");
                metadata = await analyzeMetadata(metadata);
                logger.info("LLM enhancement completed successfully!");
            } else {
                logger.info("LLM not initialized, using heuristics only");
            }
        } catch (llmError) {
            logger.warn({ 
                error: llmError.message 
            }, 'LLM analysis failed, using heuristics only');
            // Continue with heuristics-only results
        }

        logger.info({
            metadataCount: metadata.length,
            /**
             * Assume metadata in array of object format..!
             * Use map to transform the array into new array containing only the tablename values from each obeject..!
             * Got m is each index we iterate with tablename 
             * wrap with set to remove the duplicates..!
             * ... new set converts back the set to array and get the length of the array..!
             */
            tables: [...new Set(metadata.map(m => m.tableName))].length
        }, "Metadata-Extracted-Successfully..!");
        return metadata;


    } catch (error) {
        logger.error({
            error,
            filePath,
            originalName,
        }, 'Failed-To-Parse-Metadata-File..!');
        throw error;//re-throw the error so it can be handled upstream..!
    }
}

/**
 * Get-File Type From Extension..!
 */

export function getFileType(filename) {
    const ext = extname(filename).toLowerCase();//get the extension of the file..!
    if (ext === '.xlsx' || ext === '.xls') return 'excel';//use it for to get the file type..!
    if (ext === '.csv') return 'csv';
    return 'unknown';
}

