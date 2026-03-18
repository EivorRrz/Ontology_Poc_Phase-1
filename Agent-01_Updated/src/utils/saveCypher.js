/**
 * Utility to save generated Cypher - only .cypher file output
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DOCUMENTS_DIR = path.join(DATA_DIR, 'documents');

const CYPHER_FILENAME = 'generated.cypher';

/**
 * Save Cypher to the only output: data/documents/{docId}/generated.cypher
 * @param {string} docId - Document ID
 * @param {string|Array} cypherOrResults - Raw Cypher string, or array of {generatedCypher} (legacy)
 * @returns {Promise<string>} - Path to the saved file
 */
export async function saveCypherToFile(docId, cypherOrResults) {
  let cypher = typeof cypherOrResults === 'string' ? cypherOrResults : null;
  if (!cypher && Array.isArray(cypherOrResults) && cypherOrResults.length > 0) {
    const first = cypherOrResults.find(r => !r.chunkId) || cypherOrResults[0];
    cypher = first?.generatedCypher || '';
    if (cypherOrResults.length > 1) {
      cypher = cypherOrResults.map(r => r.generatedCypher || '').filter(Boolean).join('\n\n');
    }
  }
  const cypherPath = path.join(DOCUMENTS_DIR, docId, CYPHER_FILENAME);
  await fs.mkdir(path.dirname(cypherPath), { recursive: true });

  let content = (cypher || '').trim();
  if (!content) throw new Error('No Cypher to save');
  content = content.replace(/-&gt;/g, '->').replace(/-&lt;/g, '<-');
  content = content.replace(/&gt;/g, '>').replace(/&lt;/g, '<');
  content = content.replace(/&amp;gt;/g, '>').replace(/&amp;lt;/g, '<');

  await fs.writeFile(cypherPath, content, 'utf-8');
  logger.info('Cypher saved', { docId, path: cypherPath });
  return cypherPath;
}

/**
 * Get path to generated.cypher for a document
 */
export function getCypherFilePath(docId) {
  return path.join(DOCUMENTS_DIR, docId, CYPHER_FILENAME);
}

/**
 * Read Cypher from file
 */
export async function readCypherFromFile(docId) {
  try {
    const p = getCypherFilePath(docId);
    return await fs.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

