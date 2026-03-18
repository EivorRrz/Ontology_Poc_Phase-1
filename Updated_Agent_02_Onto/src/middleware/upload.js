/**
 * @Description File Upload Middleware with Multer Configuration
 * Handles Excel/CSV file uploads with API key protection
 */

import multer from 'multer';//help to upload ..!
import express from "express";
import { join } from 'path';//get the path of the directory.
import { mkdir } from 'fs/promises';//help to create the dir
import logger from '../utils/logger.js';//import the logger.
import config from '../config/index.js';//import the config.
import { parseMetadataFile } from '../parsers/index.js';
import { getInferenceStats } from '../heuristics/index.js';
import { getLLMStatus } from '../llm/index.js';
import { saveMetadata, getArtifactStatus } from '../storage/fileStorage.js';


//logic..!
const router = express.Router();


/**
 * Ensure Upload directory exists..!
 */

(async () => {
    try {
        //create the upload directory..!
        //so wait until it has created the directory..!
        //recursive:true means it will create the directory and all the sub-directories..!
        await mkdir(config.storage.uploadDir, { recursive: true });
        logger.info({ uploadDir: config.storage.uploadDir }, "Upload directory ready..!")
    } catch (error) {
        logger.error({ error }, "Error to Create upload directory..!")
    }
})();//fixed: added () to invoke IIFE

/**
 * Configure Multer Storage
 * Stores files on disk with timestamped filenames
 */
/**
 * the format for the multer is 
 * destination:directory path
 * filename:function(req,file,cb)
 */
const storage = multer.diskStorage({
    //we will send the file in multer instance after that it will get into the..!
    //
    destination: async (req, file, cb) => {
        //as the destination will have a directory...!
        try {
            //ensure the upload directory exists..!
            await mkdir(config.storage.uploadDir, {
                recursive: true
            });
            //if the upload directory is created successfullt 
            cb(null, config.storage.uploadDir);
        } catch (error) {
            logger.error({ error }, "Error to Create Upload SuccessFully...!");
            //as callback means it will return the error and null..!
            cb(error, null);
        }
    },
    //and the file-nAME..!
    filename: (req, file, cb) => {
        //generate a unique filename with timestamp and original extension
        const timeStamp = Date.now();
        //means while getting the originalName we can replace the special characters with _
        const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');//sanitize filename..!
        //example: sample_file.xlsx
        const fileName = `${timeStamp}_&_${originalName}`
        //example: 1736361600_&_sample_file.xlsx
        cb(null, fileName)
    }
});

//file-Filter..!
const fileFilter = (req, file, cb) => {//fixed: removed async
    //allowed-MIME-Types..!
    const allowedMimes = [
        //these are the custom-filters..!
        /**
         * File-Filter -> Only allow Excel and Csv-Files..!
         */
        'application/vnd.ms-excel',//old excel format..!
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',//new excel format..!
        'text/csv',//csv format..!
        'application/csv',//alternative csv format..!

    ];

    //allowed-file-extensions..!
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    //this list contains which file extension is allowed here...!
    //only the excel files and csv 
    const ext = file.originalname.toLowerCase().substring(
        //so here get the last index of the .
        //so we can get the extension of the file..!
        file.originalname.lastIndexOf('.')//first make it string..
        //then take the last index of (.)
        //so we can get the extension of the file..!
    );

    //check if files types are allowed or not..!
    /**
     * @description so when we send a file in the form-data
     * Browser->Client decides the mime-type..!
     * it sends it in the request header likt his..!
     * content-Type:->application/vnd.ms-excel
     */
    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
        cb(null, true)
    } else {
        cb(new Error(`Invalid File-type-Allowed: ${allowedMimes.join(', ')}`), false)//fixed: added false parameter
    }
};
/**
 * Create Multer Instance
 * Configured with storage, fileFilter, and file size limit
 */

/**
 * As when we need to call the multer..!
 * we should have the two things are the storage and file-filter..!
 * as the storage will have the destination and filename..!
 * and the file-filter will have the file-types and file-extensions..!
 */
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024,//10mb
    },
});


/**
 * Middleware for single file upload
 * Field name must be 'file' in multipart/form-data
 */
//so here we have to send the single file to the server...!
/**
 * @description So here we have to send the single file to the server...!
 * after the file is being uploaded
 */
export const uploadSingle = upload.single('file')


/**
 * Api-Key validation middleware..!
 * validates api-key from header or query parameter..!
 */

export const validateApiKey = (req, res, next) => {
    //get the api-key from header or query-parameter..!
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    //check if api key is provided..!
    if (!apiKey) {
        logger.warn({
            path: req.path
        }, 'No-Api-Key-Provided...!');
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Api-Key-is-Required...'
        });
    }

    //validate API key against config..!
    //Accept "test" as a simple dev key, or the configured key
    if (apiKey !== config.security.apiKey && apiKey !== 'test') {
        logger.warn({ path: req.path }, 'Invalid API key attempted');
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid API key',
        });
    }

    //if api-key is valid..!
    next();

};
/**
 * POst/ingest..!
 * upload excel/csv metadata-file..
 * protected with api-key..!
 */
router.post('/ingest', validateApiKey, uploadSingle, async (req, res) => {
    /**
     * When we will ingest the file/upload the file we have to validate with api-key,uploadSignle..!
     */
    try {
        

        /**
         * check with file if not..!
         * return the error and message..!
         */
        
        
        if (!req.file) {
            //check if th file is coming from req.body or not..1
            return res.status(400).json({
                error: "Bad-Request..!",
                message: "No-File-Uploaded..."
            });
        }
        //if yes..!
        const fileInfo = {
            //get the file-info..!s
            originalName: req.file.originalname,
            fileName: req.file.filename,
            path: req.file.path,
            size: req.file.size,
            mimetype: req.file.mimetype,
            uploadAt: new Date().toISOString(),
        };
        //response-it..!
        logger.info({ fileInfo }, "File-Uploaded-Successfully...!");

        const metadata = await parseMetadataFile(req.file.path, req.file.originalname);
        const inference = getInferenceStats(metadata);

        // Extract fileId from filename (timestamp part before '_&_')
        const fileId = req.file.filename.split('_&_')[0];
        
        // Transform metadata into table-grouped structure for storage
        const tablesMap = {};
        metadata.forEach(col => {
            if (!tablesMap[col.tableName]) {
                tablesMap[col.tableName] = {
                    tableName: col.tableName,
                    columns: []
                };
            }
            tablesMap[col.tableName].columns.push(col);
        });
        
        // Prepare metadata document
        const metadataDocument = {
            fileId,
            originalName: req.file.originalname,
            uploadedAt: fileInfo.uploadAt,
            fileSize: req.file.size,
            filePath: req.file.path,
            metadata: {
                rowCount: metadata.length,
                tableCount: Object.keys(tablesMap).length,
                tables: tablesMap
            },
            inference,
            llmStatus: getLLMStatus(),
            artifacts: {
                dbml: { generated: false },
                sql_postgres: { generated: false },
                sql_snowflake: { generated: false },
                erd_png: { generated: false },
                erd_svg: { generated: false }
            },
            createdAt: new Date().toISOString()
        };
        
        // Save metadata to disk (artifacts/<fileId>/metadata.json)
        await saveMetadata(fileId, metadataDocument);
        logger.info({ fileId, tables: Object.keys(tablesMap).length }, 'Metadata saved to artifacts folder');
        
        const includeFullMetadata = req.query.full === 'true' || req.query.full === '1';

        const responseData = {
            fileId,  // Use extracted fileId (timestamp)
            originalName: req.file.originalname,
            size: req.file.size,
            uploadedAt: fileInfo.uploadAt,
            metadata: {
                rowCount: metadata.length,
                tableCount: [...new Set(metadata.map(m => m.tableName))].length,
                tables: [...new Set(metadata.map(m => m.tableName))],
            },
            inference:{
                primaryKeys:{
                    explicit:inference.explicitPK,
                    inferred:inference.inferredPK,
                },
                foreignKeys:{
                    explicit:inference.explicitFK,
                    inferred:inference.inferredFK,
                }
            },
            llmStatus: getLLMStatus(),
            artifacts: {
                metadataPath: `artifacts/${fileId}/metadata.json`,
                available: ['dbml', 'sql', 'erd']  // Can generate these
            },
            preview: metadata.slice(0, 5),
        };

        
        if (includeFullMetadata) {
            responseData.metadata.columns = metadata;  // Full array
        }

        res.status(200).json({
            success: true,
            message: "File uploaded, parsed, and metadata saved successfully!",
            data: responseData,
        });

    } catch (error) {
        logger.error({ error }, 'File-Upload-Failed..!');//fixed: simplified error logging
        return res.status(500).json({
            error: "Internal-Server-Error",
            message: error.message || "Failed-To-Upload-File..!",
            ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
        });
    }
});

export default router;