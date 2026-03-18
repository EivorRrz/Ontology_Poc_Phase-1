/**
 * @Description File Upload Middleware with Multer Configuration
 * Handles Excel/CSV file uploads with API key protection
 */

import multer from 'multer';//help to upload ..!
import express from "express";
import path, { join } from 'path';//get the path of the directory.
import { mkdir } from 'fs/promises';//help to create the dir
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import logger from '../utils/logger.js';//import the logger.
import config from '../config/index.js';//import the config.
import { parseMetadataFile } from '../parsers/index.js';
import { getInferenceStats } from '../heuristics/index.js';
import { getLLMStatus } from '../llm/index.js';
import { saveMetadata, getArtifactStatus } from '../storage/fileStorage.js';
import { generateDBML, saveDBML } from '../generators/dbmlGenerator.js';


//logic..!
const router = express.Router();

/**
 * Automatically generate Phase-2 physical models
 */
async function generatePhysicalModels(fileId) {
    return new Promise((resolve, reject) => {
        const phase2Dir = join(__dirname, '..', '..', '..', 'Phase-2');
        const phase2Script = join(phase2Dir, 'generate-complete.js');
        
        logger.info({ fileId }, '🐍 Auto-generating Phase-2: Physical Model...');
        
        const nodeProcess = spawn('node', [phase2Script, fileId], {
            cwd: phase2Dir,
            shell: true,
            env: {
                ...process.env,
                PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || 
                    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
            }
        });
        
        let stdout = '';
        let stderr = '';
        
        nodeProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        nodeProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        nodeProcess.on('close', (code) => {
            if (code === 0) {
                logger.info({ fileId }, '✅ Phase-2 physical models generated successfully');
                resolve({ success: true, output: stdout });
            } else {
                logger.warn({ fileId, code, stderr }, '⚠️ Phase-2 generation failed (non-critical)');
                resolve({ success: false, error: stderr });
            }
        });
        
        nodeProcess.on('error', (err) => {
            logger.warn({ error: err.message, fileId }, '⚠️ Failed to spawn Phase-2 process (non-critical)');
            resolve({ success: false, error: err.message });
        });
    });
}

/**
 * Generate interactive dual HTML visualization (DATA_MODEL_DUAL_ENHANCED.html)
 * This creates the interactive ERD viewer that Phase-2 expects
 */
async function generateInteractiveHTML(fileId) {
    return new Promise((resolve) => {
        const phase2Dir = join(__dirname, '..', '..', '..', 'Phase-2');
        const phase2Script = join(phase2Dir, 'generate.js');
        
        logger.info({ fileId }, '🎨 Generating interactive dual HTML visualization...');
        
        const nodeProcess = spawn('node', [phase2Script, fileId], {
            cwd: phase2Dir,
            shell: true
        });
        
        let stdout = '';
        let stderr = '';
        
        nodeProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        nodeProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        nodeProcess.on('close', (code) => {
            if (code === 0) {
                logger.info({ fileId }, '✅ Interactive dual HTML generated successfully');
                resolve({ success: true, output: stdout });
            } else {
                logger.warn({ fileId, code, stderr: stderr.substring(0, 200) }, '⚠️ Interactive HTML generation failed (non-critical)');
                resolve({ success: false, error: stderr });
            }
        });
        
        nodeProcess.on('error', (err) => {
            logger.warn({ error: err.message, fileId }, '⚠️ Failed to spawn interactive HTML generator (non-critical)');
            resolve({ success: false, error: err.message });
        });
    });
}

/**
 * Automatically generate all models (logical + physical)
 */
async function generateAllModels(fileId, metadataDocument) {
    const artifacts = {
        logical: {},
        physical: {},
        executive: {},
        errors: []
    };
    
    try {
        // Step 1: Generate Logical Model (Phase-1)
        logger.info({ fileId }, '📊 Auto-generating Logical Model...');
        
        try {
            // Generate DBML
            const dbmlContent = await generateDBML(metadataDocument);
            const dbmlPath = await saveDBML(fileId, dbmlContent);
            artifacts.logical.dbml = dbmlPath;
            logger.info({ fileId }, '✅ DBML generated');
        } catch (err) {
            logger.warn({ error: err.message, fileId }, '⚠️ DBML generation failed');
            artifacts.errors.push({ type: 'logical_dbml', error: err.message });
        }
        
        // Diagram generation removed - only Interactive HTML viewer is used
        logger.info({ fileId }, 'Skipping static diagram generation (PNG/SVG/PDF) - using Interactive HTML viewer only');
        
        // Step 2: Generate Physical Model (Phase-2)
        logger.info({ fileId }, '💾 Auto-generating Physical Model...');
        const phase2Result = await generatePhysicalModels(fileId);
        
        if (phase2Result.success) {
            artifacts.physical.generated = true;
            artifacts.physical.mysql_sql = `artifacts/${fileId}/physical/mysql.sql`;
            // ERD diagrams are generated by Phase-1 using DBML (logical/erd.png, erd.svg, erd.pdf)
            artifacts.executive.report = `artifacts/${fileId}/executive/EXECUTIVE_REPORT.html`;
            artifacts.executive.interactive = `artifacts/${fileId}/executive/erd_INTERACTIVE.html`;
        } else {
            artifacts.errors.push({ type: 'physical', error: phase2Result.error });
        }
        
    } catch (err) {
        logger.error({ error: err.message, fileId }, '❌ Model generation failed');
        artifacts.errors.push({ type: 'general', error: err.message });
    }
    
    return artifacts;
}


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
        fileSize: 50 * 1024 * 1024,  // 50MB
        files: 1,                     // Max 1 file
        fields: 10,                   // Max 10 fields
        fieldSize: 10 * 1024 * 1024,  // 10MB per field
        parts: 100,                   // Max 100 parts
        headerPairs: 2000             // Max header pairs
    },
    // Increase timeout for large files
    preservePath: false
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
// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        logger.error({ error: err.message, code: err.code, field: err.field }, 'Multer error');
        return res.status(400).json({
            error: 'Upload-Error',
            message: `File upload error: ${err.message}`,
            code: err.code,
            hint: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 50MB)' : 
                  err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field. Use field name: "file"' :
                  'Check that Content-Type is multipart/form-data and field name is "file"'
        });
    } else if (err) {
        logger.error({ 
            error: err.message, 
            code: err.code,
            stack: err.stack 
        }, 'Upload error');
        
        // Handle connection reset errors
        if (err.code === 'ECONNRESET' || err.message?.includes('ECONNRESET')) {
            return res.status(400).json({
                error: 'Connection-Error',
                message: 'Connection was reset during upload. This usually means:',
                hints: [
                    '1. Postman Body tab → Select "form-data" (NOT raw, NOT x-www-form-urlencoded)',
                    '2. Key name must be exactly: "file" (lowercase, no extra text)',
                    '3. Change dropdown from "Text" to "File"',
                    '4. Actually select a file (should show filename, not "undefined")',
                    '5. Content-Type should be multipart/form-data (Postman sets this automatically)',
                    '6. Try a smaller file first to test',
                    '7. Check server is running and accessible'
                ],
                postmanConfig: {
                    method: 'POST',
                    url: 'http://localhost:3000/upload/ingest',
                    headers: { 'x-api-key': 'test' },
                    body: {
                        type: 'form-data',
                        key: 'file',
                        typeDropdown: 'File (NOT Text)',
                        value: '[Your filename should appear here, not "undefined"]'
                    }
                }
            });
        }
        
        return res.status(400).json({
            error: 'Upload-Error',
            message: err.message,
            hint: 'Check Postman settings: Content-Type must be multipart/form-data, field name must be "file"'
        });
    }
    next();
};

router.post('/ingest', validateApiKey, (req, res, next) => {
    // Set longer timeout for file uploads (5 minutes)
    req.setTimeout(300000);
    res.setTimeout(300000);
    
    // Log request details for debugging
    const contentType = req.headers['content-type'] || '';
    const contentLength = req.headers['content-length'];
    
    logger.info({ 
        contentType,
        contentLength,
        hasBody: !!req.body,
        query: req.query,
        method: req.method,
        url: req.url,
        headers: Object.keys(req.headers)
    }, 'Upload request received');
    
    // Early validation - check Content-Type
    if (!contentType) {
        logger.warn({ headers: req.headers }, 'Missing Content-Type header');
        return res.status(400).json({
            error: 'Bad-Request',
            message: 'Content-Type header is missing. This means Postman is not sending the file correctly.',
            diagnostic: {
                receivedHeaders: Object.keys(req.headers),
                contentType: contentType || 'MISSING',
                contentLength: contentLength || 'MISSING'
            },
            fix: {
                step1: 'Open Postman Body tab',
                step2: 'Select "form-data" (NOT raw, NOT x-www-form-urlencoded)',
                step3: 'Add key: "file"',
                step4: 'Change dropdown from "Text" to "File"',
                step5: 'Click "Select Files" and choose your file',
                step6: 'Verify filename appears in Value column (NOT "undefined")',
                note: 'Postman will automatically set Content-Type to multipart/form-data when you use form-data'
            }
        });
    }
    
    if (!contentType.includes('multipart/form-data')) {
        logger.warn({ contentType, contentLength }, 'Invalid Content-Type');
        return res.status(400).json({
            error: 'Bad-Request',
            message: 'Content-Type must be multipart/form-data',
            received: contentType,
            hint: 'In Postman: Body → form-data (Postman sets Content-Type automatically)',
            fix: {
                step1: 'Go to Body tab',
                step2: 'Select "form-data"',
                step3: 'Do NOT manually set Content-Type header - Postman does this automatically',
                step4: 'Add file field and select your file'
            }
        });
    }
    
    // Check if content-length is present (indicates file is being sent)
    if (!contentLength || contentLength === '0') {
        logger.warn({ contentType, contentLength }, 'No content-length or zero length');
        return res.status(400).json({
            error: 'Bad-Request',
            message: 'No file data detected. File is not being sent.',
            diagnostic: {
                contentType,
                contentLength: contentLength || 'MISSING'
            },
            fix: {
                step1: 'In Postman Body tab → form-data',
                step2: 'Ensure key name is exactly: "file"',
                step3: 'Change dropdown to "File" (NOT Text)',
                step4: 'Actually select a file - filename should appear',
                step5: 'If you see "undefined", the file is not selected'
            }
        });
    }
    
    // Handle connection errors BEFORE multer processes (silently)
    req.on('error', (err) => {
        // Suppress ECONNRESET console errors - handle gracefully
        if (err.code === 'ECONNRESET' && !res.headersSent) {
            logger.warn({
                code: err.code,
                contentType: req.headers['content-type'] || 'none',
                contentLength: req.headers['content-length'] || 'none'
            }, 'Connection reset - handled gracefully');
            
            return res.status(400).json({
                error: 'Connection-Error',
                message: 'Connection was reset. Try the alternative endpoint.',
                alternativeEndpoint: 'POST /upload/simple',
                hints: [
                    'Use POST /upload/simple for more reliable uploads',
                    'Or check: Body → form-data → Key: file → Type: File',
                    'Ensure file is selected (filename appears)'
                ]
            });
        }
        
        // Only log non-ECONNRESET errors
        if (err.code !== 'ECONNRESET') {
            logger.error({ 
                error: err.message, 
                code: err.code
            }, 'Request error');
        }
    });
    
    // Handle premature connection close (silently)
    req.on('close', () => {
        if (!req.complete && !res.headersSent) {
            // Silent - don't log as error
        }
    });
    
    // Handle aborted requests (silently)
    req.on('aborted', () => {
        // Silent - don't log as error
    });
    
    uploadSingle(req, res, (err) => {
        if (err) {
            return handleMulterError(err, req, res, next);
        }
        next();
    });
}, async (req, res) => {
    /**
     * When we will ingest the file/upload the file we have to validate with api-key,uploadSignle..!
     */
    try {
        // Enhanced file validation with helpful error messages
        if (!req.file) {
            logger.warn({ 
                contentType: req.headers['content-type'],
                bodyKeys: Object.keys(req.body || {}),
                files: Object.keys(req.files || {})
            }, 'No file uploaded');
            
            return res.status(400).json({
                error: "Bad-Request",
                message: "No file uploaded. File field is missing or empty.",
                hints: [
                    'In Postman:',
                    '1. Go to Body tab → form-data',
                    '2. Add key named exactly: "file"',
                    '3. Change type from "Text" to "File"',
                    '4. Click "Select Files" and choose your Excel/CSV file',
                    '5. Ensure Content-Type header is: multipart/form-data (Postman sets this automatically)',
                    '6. Fix query parameter: use ?full=true (not ?full===true)'
                ],
                received: {
                    contentType: req.headers['content-type'],
                    hasBody: !!req.body,
                    bodyKeys: Object.keys(req.body || {}),
                    files: Object.keys(req.files || {})
                }
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
        
        // Transform metadata into hierarchical structure (Domain → Sub-domain → Entity → Attributes)
        const hierarchicalStructure = {};
        const tablesMap = {};
        
        metadata.forEach(col => {
            const domain = col.domain || 'Other';
            const subDomain = col.subDomain || 'General';
            const entityName = col.entityName || col.tableName;
            const entityDesc = col.entityDescription;
            
            // Build hierarchical structure
            if (!hierarchicalStructure[domain]) {
                hierarchicalStructure[domain] = {};
            }
            if (!hierarchicalStructure[domain][subDomain]) {
                hierarchicalStructure[domain][subDomain] = {};
            }
            if (!hierarchicalStructure[domain][subDomain][entityName]) {
                hierarchicalStructure[domain][subDomain][entityName] = {
                    entityName: entityName,
                    entityDescription: entityDesc,
                    attributes: []
                };
            }
            
            hierarchicalStructure[domain][subDomain][entityName].attributes.push({
                attributeName: col.attributeName || col.columnName,
                attributeDescription: col.attributeDescription || col.description,
                dataType: col.dataType,
                isPrimaryKey: col.isPrimaryKey,
                isForeignKey: col.isForeignKey,
                referencesTable: col.referencesTable,
                referencesColumn: col.referencesColumn,
                nullable: col.nullable,
                isUnique: col.isUnique,
                domain: domain,
                subDomain: subDomain
            });
            
            // Also build backward-compatible table-grouped structure
            if (!tablesMap[col.tableName]) {
                tablesMap[col.tableName] = {
                    tableName: col.tableName,
                    entityName: entityName,
                    entityDescription: entityDesc,
                    domain: domain,
                    subDomain: subDomain,
                    columns: []
                };
            }
            tablesMap[col.tableName].columns.push({
                ...col,
                attributeName: col.attributeName || col.columnName,
                attributeDescription: col.attributeDescription || col.description
            });
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
                tables: tablesMap,
                hierarchical: hierarchicalStructure  // NEW: Preserve hierarchical structure
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
        
        // Save metadata to disk (artifacts/<fileId>/json/metadata.json)
        await saveMetadata(fileId, metadataDocument);
        logger.info({ fileId, tables: Object.keys(tablesMap).length }, 'Metadata saved to artifacts folder');
        
        // Generate interactive HTML and MySQL DDL automatically (one flow)
        try {
            logger.info({ fileId }, '🎨 Generating interactive HTML and MySQL DDL automatically...');
            const result = await generateInteractiveHTML(fileId);
            if (result.success) {
                logger.info({ fileId }, '✅ Interactive HTML and MySQL DDL generated automatically');
            } else {
                logger.warn({ fileId, error: result.error }, '⚠️ Generation failed (non-critical)');
            }
        } catch (err) {
            logger.warn({ error: err.message, fileId }, '⚠️ Failed to generate artifacts (non-critical)');
        }
        
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
            metadataPath: `artifacts/${fileId}/json/metadata.json`,
            preview: metadata.slice(0, 5),
            artifacts: {
                interactiveHTML: `artifacts/${fileId}/executive/DATA_MODEL_DUAL_ENHANCED.html`,
                mysqlDDL: `artifacts/${fileId}/physical/mysql.sql`
            }
        };

        
        if (includeFullMetadata) {
            responseData.metadata.columns = metadata;  // Full array
        }

        res.status(200).json({
            success: true,
            message: "✅ File uploaded, metadata extracted, and artifacts generated! Interactive HTML and MySQL DDL are ready.",
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

/**
 * Diagnostic endpoint to test Postman configuration
 * GET /upload/test - Returns instructions for Postman setup
 */
router.get('/test', (req, res) => {
    res.json({
        message: 'Postman Upload Test Endpoint',
        instructions: {
            method: 'POST',
            url: 'http://localhost:3000/upload/ingest',
            headers: {
                'x-api-key': 'test'
            },
            body: {
                type: 'form-data',
                fields: {
                    file: {
                        type: 'File (NOT Text)',
                        description: 'Select your Excel/CSV file here'
                    }
                }
            },
            commonMistakes: [
                'Using "Text" type instead of "File" type',
                'Field name is not exactly "file"',
                'File not actually selected (shows "undefined")',
                'Using "raw" body instead of "form-data"',
                'Query parameter has === instead of ='
            ],
            stepByStep: [
                '1. Open Postman',
                '2. Create new POST request',
                '3. URL: http://localhost:3000/upload/ingest',
                '4. Headers tab → Add: x-api-key = test',
                '5. Body tab → Select "form-data"',
                '6. Add key: "file"',
                '7. Change dropdown from "Text" to "File"',
                '8. Click "Select Files" and choose your file',
                '9. Send request'
            ],
            visualGuide: {
                postmanBodyTab: {
                    step1: 'Click "Body" tab in Postman',
                    step2: 'You will see radio buttons: none | form-data | x-www-form-urlencoded | raw | binary | GraphQL',
                    step3: 'Click "form-data" radio button',
                    step4: 'You will see a table with columns: Key | Type | Value',
                    step5: 'In Key column, type: file',
                    step6: 'In Type column dropdown, change from "Text" to "File"',
                    step7: 'In Value column, click "Select Files" button',
                    step8: 'Choose your Excel/CSV file',
                    step9: 'Verify filename appears in Value column (NOT "undefined")'
                },
                whatToLookFor: {
                    correct: 'Value column shows: "yourfile.xlsx" or "data.csv"',
                    incorrect: 'Value column shows: "undefined" or empty',
                    fix: 'If you see "undefined", click "Select Files" again and choose your file'
                }
            },
            troubleshooting: {
                ifYouSeeECONNRESET: [
                    '1. Check Body tab - is "form-data" selected?',
                    '2. Check Type column - is it "File" or "Text"?',
                    '3. Check Value column - does filename appear or "undefined"?',
                    '4. Try deleting the request and creating a new one',
                    '5. Use curl command below to test if server is working'
                ],
                curlTest: 'curl -X POST http://localhost:3000/upload/ingest -H "x-api-key: test" -F "file=@C:\\path\\to\\your\\file.xlsx"'
            }
        }
    });
});

/**
 * Simple test endpoint to verify server connectivity
 * POST /upload/ping - Just returns success if server is reachable
 */
router.post('/ping', (req, res) => {
    res.json({
        success: true,
        message: 'Server is reachable!',
        receivedHeaders: Object.keys(req.headers),
        contentType: req.headers['content-type'] || 'none',
        timestamp: new Date().toISOString()
    });
});

/**
 * Alternative simpler upload endpoint - more reliable, suppresses console errors
 * POST /upload/simple - Simplified upload with better error handling
 */
router.post('/simple', validateApiKey, (req, res, next) => {
    // Set longer timeout
    req.setTimeout(300000);
    res.setTimeout(300000);
    
    logger.info({
        method: req.method,
        path: req.path,
        contentType: req.headers['content-type'] || 'none',
        contentLength: req.headers['content-length'] || 'none'
    }, 'Simple upload endpoint called');
    
    // Handle connection errors silently (no console spam)
    req.on('error', (err) => {
        if (err.code === 'ECONNRESET' && !res.headersSent) {
            // Silent warning - no console error spam
            return res.status(400).json({
                error: 'Connection-Error',
                message: 'Connection was reset. Please try again.',
                tip: 'Ensure file is properly selected in Postman (Type: File, not Text)'
            });
        }
    });
    
    uploadSingle(req, res, (err) => {
        if (err) {
            // Suppress ECONNRESET errors in console
            if (err.code === 'ECONNRESET') {
                return res.status(400).json({
                    error: 'Connection-Error',
                    message: 'Connection was reset. File may not have been sent correctly.',
                    solution: 'Check Postman: Body → form-data → Key: file → Type: File → Select file'
                });
            }
            return handleMulterError(err, req, res, next);
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: "Bad-Request",
                message: "No file uploaded.",
                instructions: {
                    step1: "Body tab → Select 'form-data'",
                    step2: "Add key: 'file'",
                    step3: "Change Type dropdown to 'File'",
                    step4: "Click 'Select Files' and choose your file",
                    step5: "Verify filename appears (not 'undefined')"
                }
            });
        }
        
        const fileInfo = {
            originalName: req.file.originalname,
            fileName: req.file.filename,
            path: req.file.path,
            size: req.file.size,
            mimetype: req.file.mimetype,
            uploadAt: new Date().toISOString(),
        };
        
        logger.info({ fileInfo }, "File-Uploaded-Successfully (Simple Endpoint)");
        
        const metadata = await parseMetadataFile(req.file.path, req.file.originalname);
        const inference = getInferenceStats(metadata);
        const fileId = req.file.filename.split('_&_')[0];
        
        // Transform metadata
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
            createdAt: new Date().toISOString()
        };
        
        await saveMetadata(fileId, metadataDocument);
        
        // Generate interactive HTML and MySQL DDL automatically (one flow)
        try {
            logger.info({ fileId }, '🎨 Generating interactive HTML and MySQL DDL automatically...');
            const result = await generateInteractiveHTML(fileId);
            if (result.success) {
                logger.info({ fileId }, '✅ Interactive HTML and MySQL DDL generated automatically');
            } else {
                logger.warn({ fileId, error: result.error }, '⚠️ Generation failed (non-critical)');
            }
        } catch (err) {
            logger.warn({ error: err.message, fileId }, '⚠️ Failed to generate artifacts (non-critical)');
        }
        
        res.status(200).json({
            success: true,
            message: "✅ File uploaded, metadata extracted, and artifacts generated! Interactive HTML and MySQL DDL are ready.",
            fileId,
            fileInfo: {
                originalName: fileInfo.originalName,
                size: fileInfo.size,
                uploadedAt: fileInfo.uploadAt
            },
            metadata: {
                rowCount: metadata.length,
                tableCount: Object.keys(tablesMap).length,
                tables: Object.keys(tablesMap)
            },
            inference: {
                primaryKeys: {
                    explicit: inference.explicitPK,
                    inferred: inference.inferredPK,
                },
                foreignKeys: {
                    explicit: inference.explicitFK,
                    inferred: inference.inferredFK,
                }
            },
            metadataPath: `artifacts/${fileId}/json/metadata.json`,
            artifacts: {
                interactiveHTML: `artifacts/${fileId}/executive/DATA_MODEL_DUAL_ENHANCED.html`,
                mysqlDDL: `artifacts/${fileId}/physical/mysql.sql`
            }
        });
        
    } catch (error) {
        // Suppress error stack in console for cleaner output
        logger.error({ error: error.message }, 'Simple upload failed');
        return res.status(500).json({
            error: "Internal-Server-Error",
            message: error.message || "Failed to process file",
        });
    }
});

export default router;