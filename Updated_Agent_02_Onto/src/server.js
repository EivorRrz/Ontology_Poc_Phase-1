/**
 * @abstract Server-Entry..!
 */
import express from "express";
import multer from "multer";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import logger from "./utils/logger.js";
import config from "./config/index.js";
import uploadRouter from "./middleware/upload.js";
import generateRouter from "./routes/generate.js";//for generating the artifacts..!
import { Initializellm, getLLMStatus } from "./llm/index.js";


//Create the instance of the express.!
const app = express();

//middleware..!
app.use(express.json());//parse all the json data..!
app.use(express.urlencoded({ extended: true }));


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
    logger.error({
        err,
        path: req.path,
    }, "Unhandle-Error");

    /**
     * check if any error arise from the multer 
     * then check if the fileSize is Full..!
     */
    if (err instanceof multer.MulterError) {//means the error is from the multer.!
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({//fixed: was res.stauts
                error: "Bad-Request",
                message: "File-Too-Large..Maximun-Size:10mb"
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
app.listen(PORT, async () => {
    logger.info(`🚀 Server running on http://localhost:${PORT}`);
    logger.info(`📁 Upload directory: ${config.storage.uploadDir}`);
    logger.info(`📦 Artifacts directory: ${config.storage.artifactsDir}`);
    
    // Create artifacts directory if it doesn't exist
    if (!existsSync(config.storage.artifactsDir)) {
        await mkdir(config.storage.artifactsDir, { recursive: true });
        logger.info('✅ Artifacts directory created');
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
});

export default app;