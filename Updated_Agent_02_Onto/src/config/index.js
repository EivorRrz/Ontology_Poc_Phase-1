import dotenv from "dotenv";
import { fileURLToPath } from "url";//means to get the path of the fileS
import { dirname, join } from "path";//means to get the path of the directory


dotenv.config();

/**
 * @description this is the filename and directory  of the current file..!
 */
const __filename = fileURLToPath(import.meta.url);//import.meta.url the path of current-file..!
const __dirname = dirname(__filename);//the current directory of the current file.!


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
        artifactsDir: process.env.ARTIFACTS_DIR || join(__dirname, "../artifacts"),
        //means get the env or else get the artifacts dir from the current directory...!
        uploadDir: process.env.UPLOAD_DIR || join(__dirname, "../uploads"),
        //SIMILAR get it from the env or else make sure to take from the uploads folder from current directory.>
    },
    //LLM - Ollama with DeepSeek-R1:7B
    llm: {
        provider: "ollama",
        ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
        model: process.env.OLLAMA_MODEL || "deepseek-r1:7b",
    }
}

export default config;//export it.!