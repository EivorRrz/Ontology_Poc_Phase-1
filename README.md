# Ontology_Poc_Phase-1

Proof-of-concept for ontology.

## Clone

```bash
git clone https://github.com/EivorRrz/Ontology_Poc_Phase-1.git
cd Ontology_Poc_Phase-1
```

## Environment Variables

### Agent-01 (`Agent-01_Updated`)

Create `.env` in `Agent-01_Updated/`:

```txt
# Server
PORT=4000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/document-graph-pipeline
# MONGODB_USE_LOCAL=true   # Use when Atlas is unreachable

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password-here

# LlamaParse (optional)
LLAMAPARSE_API_KEY=your-llamaparse-api-key

# Azure OpenAI
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o
AZURE_OPENAI_API_VERSION=2025-01-01-preview

# Chunking
CHUNK_SIZE_WORDS=1000
CHUNK_OVERLAP_WORDS=100

# Paths (optional)
DATA_DIR=./data
UPLOAD_DIR=./uploads
WATCH_FOLDER=./watch

# Logging
LOG_LEVEL=info
```

### Agent-02 (`Updated_Agent_02_Onto`)

#### Phase-1 – create `.env` in `Updated_Agent_02_Onto/Phase-1/`:

```txt
# Server
PORT=3000
NODE_ENV=development

# Security (change in production)
API_KEY=dev-api-key-change-in-production
JWT_SECRET=dev-jwt-secret-change-in-production

# Azure OpenAI (required for LLM metadata enhancement)
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o
AZURE_OPENAI_API_VERSION=2025-01-01-preview

# LLM enhancement (optional)
LLM_ENHANCEMENT_ENABLED=true
LLM_BATCH_SIZE=50
LLM_MAX_RETRIES=3
LLM_TIMEOUT=30000

# Paths (optional)
ARTIFACTS_DIR=./artifacts
UPLOAD_DIR=./uploads
WATCH_DIR=./watch

# Graphviz / Puppeteer (optional, for ERD generation)
GRAPHVIZ_PATH=
PUPPETEER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

# Logging
LOG_LEVEL=info
```

#### Phase-2 – create `.env` in `Updated_Agent_02_Onto/Phase-2/` (or use Phase-1 `.env`):

```txt
# Phase-2 reads Azure config from Phase-1/.env by default

# Paths
PHASE1_ARTIFACTS_DIR=../Phase-1/artifacts

# Output
GENERATE_SQL=true
GENERATE_ERD=true
ERD_FORMATS=png,svg,pdf

# Puppeteer (for ERD export)
PUPPETEER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

# Logging
LOG_LEVEL=info
```

#### Root Agent-02 (Ollama) – create `.env` in `Updated_Agent_02_Onto/`:

```txt
# Server
PORT=3000
NODE_ENV=development

# Ollama (local LLM)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:7b

# Security
API_KEY=dev-api-key-change-in-production
JWT_SECRET=dev-jwt-secret-change-in-production

# Paths
ARTIFACTS_DIR=./artifacts
UPLOAD_DIR=./uploads

# Logging
LOG_LEVEL=info
```
