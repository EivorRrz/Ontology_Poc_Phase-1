import dotenv from "dotenv";
import { fileURLToPath } from "url";//means to get the path of the fileS
import { dirname, join } from "path";//means to get the path of the directory


dotenv.config();

/**
 * @description this is the filename and directory  of the current file..!
 */
const __filename = fileURLToPath(import.meta.url);//import.meta.url the path of current-file..!
const __dirname = dirname(__filename);//the current directory of the current file.!

// Default paths - resolve relative to Phase-1 root (go up from src/config to Phase-1)
const defaultArtifactsDir = join(__dirname, '..', '..', 'artifacts');
const defaultUploadDir = join(__dirname, '..', '..', 'uploads');
const defaultWatchDir = join(__dirname, '..', '..', 'watch');

const config = {
    //all the configs of the root..!
    server: {
        port: parseInt(process.env.PORT || "3000", 10),//so here the 10 means the base of the number system.
        env: process.env.NODE_ENV || "development",
    },
    security: {
        apiKey: process.env.API_KEY || "dev-api-key-change-in-production",//default for development..!
        jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret-change-in-production",//fixed: was env
    },
    storage: {
        //artifacts all the resource that the agent generates..!
        artifactsDir: process.env.ARTIFACTS_DIR || defaultArtifactsDir,
        //means get the env or else get the artifacts dir from the current directory...!
        uploadDir: process.env.UPLOAD_DIR || defaultUploadDir,
        //SIMILAR get it from the env or else make sure to take from the uploads folder from current directory.>
        // Watch directory for automatic file processing
        watchDir: process.env.WATCH_DIR || defaultWatchDir,
    },
    //LLM - Azure OpenAI only
    llm: {
        provider: "azure", // Always Azure OpenAI
        // Metadata enhancement settings
        metadataEnhancement: {
            enabled: process.env.LLM_ENHANCEMENT_ENABLED !== "false", // Default: true
            batchSize: parseInt(process.env.LLM_BATCH_SIZE || "50", 10),
            maxRetries: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
            retryDelay: parseInt(process.env.LLM_RETRY_DELAY || "1000", 10),
            timeout: parseInt(process.env.LLM_TIMEOUT || "30000", 10), // 30 seconds
            minConfidence: parseFloat(process.env.LLM_MIN_CONFIDENCE || "0.7", 10),
        }
    },
    // Azure OpenAI Configuration
    azure: {
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o",
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-01-01-preview",
    }
}

export default config;//export it.!

