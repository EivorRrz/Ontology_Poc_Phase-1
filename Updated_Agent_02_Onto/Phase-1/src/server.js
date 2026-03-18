/**
 * @abstract Server-Entry..!
 */
import express from "express";
import multer from "multer";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "./utils/logger.js";
import config from "./config/index.js";
import uploadRouter from "./middleware/upload.js";
import generateRouter from "./routes/generate.js";//for generating the artifacts..!
import { Initializellm, getLLMStatus } from "./llm/index.js";
import { startFileWatcher } from "./utils/fileWatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


//Create the instance of the express.!
const app = express();

//middleware..!
app.use(express.json({ limit: '50mb' }));//parse all the json data..!
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Increase request timeout for file uploads (5 minutes)
app.use((req, res, next) => {
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000); // 5 minutes

    // Log all requests for debugging
    if (req.path.includes('/upload')) {
        logger.info({
            method: req.method,
            path: req.path,
            contentType: req.headers['content-type'] || 'none',
            contentLength: req.headers['content-length'] || 'none',
            hasBody: !!req.body
        }, 'Request received');
    }

    next();
});

// Serve artifacts directory
const artifactsDir = config.storage.artifactsDir;
app.use('/artifacts', express.static(artifactsDir));

//health-Check..!
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timeStamp: new Date().toISOString()
    })
});


//Routes..!
app.use('/upload', uploadRouter);
app.use('/generate', generateRouter);//for generating artifacts..!


//Error-Handling-Middleware..!
app.use((err, req, res, next) => {
    // Suppress ECONNRESET errors in console - they're handled gracefully
    if (err.code === 'ECONNRESET' || err.message?.includes('ECONNRESET')) {
        // Log silently without stack trace
        logger.warn({
            code: err.code,
            path: req.path,
            contentType: req.headers['content-type'] || 'none'
        }, 'Connection reset - handled gracefully');

        if (!res.headersSent) {
            return res.status(400).json({
                error: "Connection-Error",
                message: "Connection was reset during upload.",
                solution: "Try using the alternative upload endpoint: POST /upload/simple",
                hints: [
                    "1. Use POST /upload/simple endpoint (simpler, more reliable)",
                    "2. Or check Postman: Body → form-data → Key: file → Type: File",
                    "3. Ensure file is actually selected (filename appears, not 'undefined')",
                    "4. Try a smaller file first"
                ],
                alternativeEndpoint: {
                    method: "POST",
                    url: "http://localhost:3000/upload/simple",
                    headers: { "x-api-key": "test" },
                    body: {
                        type: "form-data",
                        key: "file",
                        typeDropdown: "File"
                    }
                }
            });
        }
        return; // Don't log error if response already sent
    }

    logger.error({
        err,
        path: req.path,
    }, "Unhandle-Error");

    /**
     * Handle busboy parsing errors
     */
    if (err.message && err.message.includes('Malformed part header')) {
        logger.error('Busboy parsing error - malformed multipart data');
        return res.status(400).json({
            error: "Bad-Request",
            message: "Invalid file upload format. Ensure you're using multipart/form-data with field name 'file'",
            hint: "Use: curl -F 'file=@yourfile.xlsx' or Postman with Body > form-data > file"
        });
    }

    /**
     * check if any error arise from the multer 
     * then check if the fileSize is Full..!
     */
    if (err instanceof multer.MulterError) {//means the error is from the multer.!
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({//fixed: was res.stauts
                error: "Bad-Request",
                message: "File-Too-Large. Maximum-Size: 50MB"
            });
        }
        //handle other multer errors..!
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({
                error: "Bad-Request",
                message: "Unexpected file field. Use 'file' as field name."
            });
        }
    }

    //handle file filter errors..!
    if (err.message && err.message.includes('Invalid File-type')) {
        return res.status(400).json({
            error: "Bad-Request",
            message: err.message
        });
    }

    res.status(err.status || 500).json({
        error: err.message || "Internal-Server-Error",
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
});


/**
 * 404-Handler..!
 */

app.use((req, res) => {
    res.status(404).json({
        error: "Not-Found",
        message: `Route.......${req.method} ${req.path} not Found....!`
    });
});


/**
 * Gather the port for server..!
 */
//Start-Server..!
const PORT = config.server.port;
//0.0.0.0 means listen on all interfaces
app.listen(PORT, '0.0.0.0', async () => {
    logger.info(`🚀 Server running on http://localhost:${PORT}`);
    logger.info(`📁 Upload directory: ${config.storage.uploadDir}`);
    logger.info(`📦 Artifacts directory: ${config.storage.artifactsDir}`);
    logger.info(`👀 Watch directory: ${config.storage.watchDir}`);

    // Create artifacts directory if it doesn't exist
    if (!existsSync(config.storage.artifactsDir)) {
        await mkdir(config.storage.artifactsDir, { recursive: true });
        logger.info('✅ Artifacts directory created');
    }

    // Create upload directory if it doesn't exist
    if (!existsSync(config.storage.uploadDir)) {
        await mkdir(config.storage.uploadDir, { recursive: true });
        logger.info('✅ Upload directory created');
    }

    // Initialize LLM on startup (optional - won't crash if model missing)
    try {
        logger.info("🧠 Initializing LLM...");
        await Initializellm();
        const status = getLLMStatus();
        logger.info({ status }, "✅ LLM initialized successfully!");
    } catch (err) {
        logger.warn({ error: err.message }, "⚠️ LLM not available - running in heuristics-only mode");
        logger.info("To enable LLM, download a GGUF model to: " + config.llm.modelPath);
    }

    // Start file watcher for automatic processing
    try {
        await startFileWatcher();
    } catch (err) {
        logger.error({ error: err.message }, "❌ Failed to start file watcher");
    }
});

export default app;