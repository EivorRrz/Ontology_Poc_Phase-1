/**
 * Load environment variables from Phase-1 before any other imports
 * This must be imported FIRST in any file that needs Azure OpenAI config
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from Phase-1 (where Azure OpenAI config is)
const phase1EnvPath = path.join(__dirname, '..', 'Phase-1', '.env');
dotenv.config({ path: phase1EnvPath });

// Also try loading from Phase-2 directory if it exists
dotenv.config();

// Export a function to verify env is loaded
export function verifyEnv() {
    return {
        hasApiKey: !!process.env.AZURE_OPENAI_API_KEY,
        hasEndpoint: !!process.env.AZURE_OPENAI_ENDPOINT,
        apiKey: process.env.AZURE_OPENAI_API_KEY ? '***' + process.env.AZURE_OPENAI_API_KEY.slice(-4) : 'missing',
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'missing'
    };
}
