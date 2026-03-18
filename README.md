# Ontology POC Phase-1

A proof-of-concept ontology platform with two AI-powered agents: **Agent-01** builds knowledge graphs from documents, and **Agent-02** generates logical and physical data models from metadata with an interactive CLI for Q&A.

---

## Quick Start

```bash
git clone https://github.com/EivorRrz/Ontology_Poc_Phase-1.git
cd Ontology_Poc_Phase-1
```

---

## Project Structure

```
Ontology_Poc_Phase-1/
├── Agent-01_Updated/          # Knowledge graph from documents
│   ├── src/
│   ├── watch/                 # Drop files for auto-processing
│   └── package.json
│
└── Updated_Agent_02_Onto/     # Logical & physical models + CLI
    ├── Phase-1/               # Logical model (upload, metadata, DBML)
    │   ├── watch/             # Drop CSV/Excel for auto-processing
    │   └── package.json
    ├── Phase-2/               # Physical model (MySQL, ERD, reports)
    │   ├── generate.js        # Universal model generator
    │   ├── cli-qa.js          # Interactive Q&A CLI
    │   └── package.json
    └── Cli                    # Quick reference for CLI commands
```

---

## Overview

| Component | Agent-01 | Agent-02 |
|-----------|----------|----------|
| **Input** | Documents (PDF, DOCX, TXT) | CSV/Excel metadata |
| **Output** | Neo4j knowledge graph | Logical + physical models (DBML, MySQL, ERD) |
| **Interaction** | REST API, file watcher, natural language queries | REST API, file watcher, CLI Q&A |

---

## Agent-01 – Knowledge Graph from Documents

**Purpose:** Turn business documents into a Neo4j knowledge graph.

**Pipeline:**
1. **Parse** – Extract text (LlamaParse optional, or built-in parser)
2. **Extract schema** – Infer nodes and relationships from text
3. **Generate Cypher** – Create Neo4j MERGE statements
4. **Ingest to Neo4j** – Run Cypher and load the graph

**Entry points:**
- `POST /upload/ingest` – File upload → pipeline runs automatically
- `POST /agent` – Agentic flow with tools (parse → schema → cypher → ingest)
- `POST /query` – Natural language questions → Cypher + results
- **File watcher** – Drop files in `Agent-01_Updated/watch/`

**Storage:** MongoDB (metadata), Neo4j (graph)

### Run Agent-01

```bash
cd Agent-01_Updated
cp .env.example .env    # Edit with your credentials
npm install
npm start               # Server on port 4000
```

---

## Agent-02 – Logical & Physical Models + CLI

**Purpose:** Turn CSV/Excel metadata into logical and physical data models, with a CLI for Q&A.

**Phase-1 (Logical model):**
- Upload via `POST /upload/ingest` or drop files in `Phase-1/watch/`
- Outputs: DBML, logical ERD, logical JSON
- Azure OpenAI for metadata enhancement

**Phase-2 (Physical model):**
- Input: Phase-1 artifacts
- Outputs: MySQL DDL, physical ERD (PNG/SVG/PDF), executive report, interactive HTML
- Run: `node generate.js <fileId>`

**CLI (Q&A):**
- Interactive Q&A about the physical model
- Usage: `node cli-qa.js <fileId>`
- Uses precomputed lineage, impact, and graph insights; answers in plain English

### Run Agent-02

```bash
# 1. Install Phase-1
cd Updated_Agent_02_Onto/Phase-1
.\install.ps1    # or: npm install

# 2. Install Phase-2
cd ../Phase-2
npm install

# 3. Start server
cd ../Phase-1
npm start         # Server on port 3000

# 4. Generate physical model (after uploading a file)
cd ../Phase-2
node generate.js <fileId>

# 5. Interactive Q&A
node cli-qa.js <fileId>
```

---

## Environment Variables

### Agent-01 (`Agent-01_Updated/.env`)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 4000) |
| `MONGODB_URI` | MongoDB connection string |
| `NEO4J_URI` | Neo4j bolt URL |
| `NEO4J_USER` / `NEO4J_PASSWORD` | Neo4j credentials |
| `LLAMAPARSE_API_KEY` | Optional, for LlamaParse |
| `AZURE_OPENAI_*` | Azure OpenAI config |
| `CHUNK_SIZE_WORDS` / `CHUNK_OVERLAP_WORDS` | Chunking settings |

### Agent-02 Phase-1 (`Updated_Agent_02_Onto/Phase-1/.env`)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `API_KEY` / `JWT_SECRET` | Security (change in production) |
| `AZURE_OPENAI_*` | Required for LLM metadata enhancement |
| `ARTIFACTS_DIR` / `UPLOAD_DIR` / `WATCH_DIR` | Paths |
| `PUPPETEER_EXECUTABLE_PATH` | For ERD export (e.g. Edge path) |

### Agent-02 Phase-2 (`Updated_Agent_02_Onto/Phase-2/.env`)

| Variable | Description |
|----------|-------------|
| `PHASE1_ARTIFACTS_DIR` | Path to Phase-1 artifacts |
| `GENERATE_SQL` / `GENERATE_ERD` | Output toggles |
| `ERD_FORMATS` | e.g. `png,svg,pdf` |

### Agent-02 Root – Ollama (`Updated_Agent_02_Onto/.env`)

| Variable | Description |
|----------|-------------|
| `OLLAMA_URL` | Default: `http://localhost:11434` |
| `OLLAMA_MODEL` | Default: `deepseek-r1:7b` |

<details>
<summary>Full .env examples (expand)</summary>

**Agent-01:**
```txt
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/document-graph-pipeline
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o
AZURE_OPENAI_API_VERSION=2025-01-01-preview
LOG_LEVEL=info
```

**Agent-02 Phase-1:**
```txt
PORT=3000
NODE_ENV=development
API_KEY=dev-api-key-change-in-production
JWT_SECRET=dev-jwt-secret-change-in-production
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o
AZURE_OPENAI_API_VERSION=2025-01-01-preview
PUPPETEER_EXECUTABLE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
LOG_LEVEL=info
```
</details>

---
