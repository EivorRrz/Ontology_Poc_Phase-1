import { AzureOpenAI } from "openai";//get the import AzureOpenAI from openai..!
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from parent directory (Phase-1 root) FIRST, before any other imports
const envPath = resolve(__dirname, '..', '.env');
console.log("📁 Loading .env from:", envPath);
const envResult = dotenv.config({ path: envPath });

if (envResult.error) {
    console.warn("⚠️  Warning: Could not load .env file:", envResult.error.message);
    console.log("   Trying to use environment variables directly...\n");
} else {
    console.log("✅ .env file loaded successfully\n");
}

// Now import config (which will use the loaded env vars)
import config from "../src/config/index.js";

/**
 * Test Azure OpenAI connection
 */

async function testAzureOpenAi() {
    console.log("🧪 Testing Azure OpenAI with Official SDK...\n");

    // Check environment variables directly first
    const apiKey = process.env.AZURE_OPENAI_API_KEY || config.azure?.apiKey;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT || config.azure?.endpoint;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || config.azure?.deploymentName || "gpt-4o";
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || config.azure?.apiVersion || "2025-01-01-preview";

    // Validate config
    if (!apiKey) {
        console.error("❌ AZURE_OPENAI_API_KEY is missing!");
        console.error("   Checked process.env.AZURE_OPENAI_API_KEY:", !!process.env.AZURE_OPENAI_API_KEY);
        console.error("   Checked config.azure.apiKey:", !!config.azure?.apiKey);
        console.error("   .env file path:", envPath);
        throw new Error("Missing AZURE_OPENAI_API_KEY. Check your .env file.");
    }
    if (!endpoint) {
        throw new Error("❌ AZURE_OPENAI_ENDPOINT is missing! Check your .env file.");
    }

    console.log("📋 Configuration:");
    console.log("   Endpoint:", endpoint);
    console.log("   Deployment:", deploymentName);
    console.log("   API Version:", apiVersion);
    console.log("   API Key:", apiKey ? `${apiKey.substring(0, 10)}...` : "MISSING");
    console.log("   .env Path:", envPath);
    console.log("");

    const client = new AzureOpenAI({
        //create the instance here..!
        //calling out all the endpoints here..!
        endpoint: endpoint,
        apiKey: apiKey,
        apiVersion: apiVersion,
    });

    /**
     * Test the connection
     */
    try {
        console.log("🚀 Sending test request to Azure OpenAI...\n");
        
        const response = await client.chat.completions.create({
            model: deploymentName, // Use deploymentName as the model parameter
            messages: [
                //two roles and one will be the system and anothe will be the user..!
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Say 'Hello! Azure OpenAI SDK connection successful!' in one sentence." }
            ],
            max_tokens: 100,//the 100k-Token..!
            temperature: 0.7,
        });
        
        console.log("✅ SUCCESS!");
        console.log("Response:", response.choices[0].message.content);
        console.log("\n📊 Response Details:");
        console.log("   Model:", response.model);
        console.log("   Tokens Used:", response.usage?.total_tokens || "N/A");
    } catch (error) {
        console.error("\n❌ ERROR:");
        console.error("   Message:", error.message);
        console.error("   Code:", error.code || "N/A");
        if (error.cause) {
            console.error("   Cause:", error.cause.message || error.cause);
        }
        if (error.response) {
            console.error("   Status:", error.response.status);
            console.error("   Status Text:", error.response.statusText);
        }
        console.error("\n💡 Troubleshooting:");
        console.error("   1. Check your .env file has correct AZURE_OPENAI_API_KEY");
        console.error("   2. Verify endpoint URL:", endpoint);
        console.error("   3. Check Azure Portal network/firewall settings");
        console.error("   4. Ensure deployment name is correct:", deploymentName);
        console.error("   5. .env file location:", envPath);
    }
}
//call the Function here..!
testAzureOpenAi();
