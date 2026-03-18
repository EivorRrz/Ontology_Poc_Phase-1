/**
 * File-based storage (replaces MongoDB)
 * Data stored in ./data/documents/{docId}/
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DOCUMENTS_DIR = path.join(DATA_DIR, 'documents');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const DOC_STATUSES = [
  'uploaded', 'parsing', 'parsed', 'schema_extracting', 'schema_extracted',
  'cypher_generating', 'cypher_generated', 'ingesting', 'completed', 'error'
];

/**
 * Ensure data directories exist
 */
export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
  try {
    await fs.readFile(INDEX_FILE, 'utf-8');
  } catch {
    await fs.writeFile(INDEX_FILE, JSON.stringify({ docIds: [], lastUpdated: new Date().toISOString() }, null, 2));
  }
}

/**
 * Generate unique docId
 */
export function generateDocId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get document directory path
 */
function docDir(docId) {
  return path.join(DOCUMENTS_DIR, docId);
}

/**
 * Read JSON file, return null if not found
 */
async function readJSON(filePath, defaultValue = null) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
}

/**
 * Write JSON file
 */
async function writeJSON(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Document ─────────────────────────────────────────────────────────────

/**
 * Create document record (optionally copy file to doc dir)
 */
export async function createDocument({ filename, mimetype, size, filePath }) {
  await ensureDataDir();
  const docId = generateDocId();
  const dir = docDir(docId);
  await fs.mkdir(dir, { recursive: true });

  let storedFilePath = filePath;
  if (filePath) {
    try {
      const ext = path.extname(filename) || path.extname(filePath) || '';
      const destPath = path.join(dir, `original${ext}`);
      await fs.copyFile(filePath, destPath);
      storedFilePath = destPath;
    } catch (err) {
      storedFilePath = filePath;
    }
  }

  const meta = {
    docId,
    filename,
    mimetype,
    size,
    filePath: storedFilePath,
    status: 'uploaded',
    error: null,
    fullText: null,
    uploadTimestamp: new Date().toISOString(),
    processingStartedAt: null,
    processingCompletedAt: null,
    totalChunks: 1,
    processedChunks: 0,
  };

  await writeJSON(path.join(dir, 'meta.json'), meta);

  const index = await readJSON(INDEX_FILE, { docIds: [] });
  if (!index.docIds) index.docIds = [];
  index.docIds.unshift(docId);
  index.lastUpdated = new Date().toISOString();
  await writeJSON(INDEX_FILE, index);

  return { ...meta, _id: docId };
}

/**
 * Get document by ID
 */
export async function getDocument(docId) {
  const meta = await readJSON(path.join(docDir(docId), 'meta.json'));
  if (!meta) return null;
  return { ...meta, _id: meta.docId || docId };
}

/**
 * Update document
 */
export async function updateDocument(docId, updates) {
  const dir = docDir(docId);
  const meta = await readJSON(path.join(dir, 'meta.json'));
  if (!meta) throw new Error(`Document not found: ${docId}`);

  const updated = { ...meta, ...updates };
  await writeJSON(path.join(dir, 'meta.json'), updated);
  return { ...updated, _id: docId };
}

/**
 * List documents
 */
export async function listDocuments(limit = 50, skip = 0) {
  await ensureDataDir();
  const index = await readJSON(INDEX_FILE, { docIds: [] });
  const docIds = (index.docIds || []).slice(skip, skip + limit);
  const documents = [];
  for (const id of docIds) {
    const doc = await getDocument(id);
    if (doc) documents.push(doc);
  }
  const total = (index.docIds || []).length;
  return { documents, total, limit, skip };
}

// ─── Full Text ────────────────────────────────────────────────────────────

export async function getFullText(docId) {
  try {
    return await fs.readFile(path.join(docDir(docId), 'fullText.txt'), 'utf-8');
  } catch {
    return null;
  }
}

export async function saveFullText(docId, text) {
  await fs.writeFile(path.join(docDir(docId), 'fullText.txt'), text, 'utf-8');
}

// ─── Schema ───────────────────────────────────────────────────────────────

export async function getSchema(docId) {
  return readJSON(path.join(docDir(docId), 'schema.json'));
}

export async function saveSchema(docId, schema) {
  const data = {
    docId,
    version: schema.version ?? 1,
    nodes: schema.nodes || {},
    relationships: schema.relationships || [],
    rawResponse: schema.rawResponse ?? null,
    extractionModel: schema.extractionModel ?? null,
    extractionProvider: schema.extractionProvider ?? 'azure',
    savedAt: new Date().toISOString(),
  };
  await writeJSON(path.join(docDir(docId), 'schema.json'), data);
  return data;
}

// Cypher is stored only in generated.cypher - see utils/saveCypher.js
