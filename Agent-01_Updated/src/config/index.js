/**
 * Agent-01 Configuration
 * Azure OpenAI - Full Ontology (aligned with Agent-02)
 */

import dotenv from 'dotenv';
dotenv.config();

const config = {
  azure: {
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
  },
};

export default config;
