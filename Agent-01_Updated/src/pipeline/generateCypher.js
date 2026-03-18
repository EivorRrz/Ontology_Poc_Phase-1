/**
 * Cypher generation - file storage version
 */

import { callLLM, extractCypher } from '../utils/llm.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';
import { detectDocumentType, getDocumentTypePrompts } from '../utils/documentTypeDetector.js';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { formatStructuredCypher } from '../utils/formatCypher.js';
import * as storage from '../storage/fileStorage.js';

function buildCypherPrompt(schema, chunkText, docType = 'general') {
  const nodeTypes = Object.entries(schema.nodes)
    .map(([label, props]) => `  - ${label}: [${props.join(', ')}]`).join('\n');
  const relationships = schema.relationships
    .map(rel => `  - ${rel.from} --[${rel.type}]--> ${rel.to}`).join('\n');
  const typePrompts = getDocumentTypePrompts(docType);
  const maxChunkLength = chunkText.length > 5000 ? 15000 : 2000;
  const truncatedChunk = chunkText.length > maxChunkLength
    ? chunkText.substring(0, maxChunkLength) + '\n[... text continues ...]'
    : chunkText;

  return `Generate Cypher MERGE statements from this ${docType} document.

Schema:
Nodes:
${nodeTypes}
Relationships:
${relationships}

Text:
${truncatedChunk}

CRITICAL RULES - Follow exactly:
1. Use MERGE for all nodes and relationships (idempotent)
2. ONE MERGE per line. Each MERGE must be COMPLETE before the next:
   MERGE (a:Account {accountId: "1"})
   MERGE (addr:Address {street: "123 Main"})
   MERGE (a)-[:HAS_ADDRESS]->(addr)
3. Every MERGE (var:Label {props}) MUST end with }) before the next statement
4. Use the FIRST property in each node type as the unique key for MERGE (contractReference, organizationName, productCode, etc.)
5. Node labels: PascalCase. Relationship types: UPPER_SNAKE_CASE. Properties: camelCase
6. Use business-meaningful names: HELD_BY, HAS_ADDRESS - NOT CONNECTS_TO, RELATED_TO
7. Output ONLY valid Cypher - no markdown, no explanations, no code blocks

Generate Cypher:`;
}

function fixCypherSyntax(cypher) {
  if (!cypher?.trim()) return cypher;
  let fixed = cypher
    .replace(/-&gt;/g, '->').replace(/-&lt;/g, '<-')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&amp;gt;/g, '>').replace(/&amp;lt;/g, '<');
  return fixed;
}

/** Repair common LLM malformations: nested MERGE without closing }) */
function repairMalformedCypher(cypher) {
  if (!cypher?.trim()) return cypher;
  let repaired = cypher;
  // Fix: ,\nMERGE or ,\n  MERGE -> })\nMERGE (close previous node before next)
  repaired = repaired.replace(/,(\s*\n\s*)MERGE/g, '})\nMERGE');
  // Fix: {\nMERGE -> close and newline
  repaired = repaired.replace(/\{\s*\n\s*MERGE/g, '})\nMERGE');
  return repaired;
}

export async function generateCypher(docId) {
  const doc = await storage.getDocument(docId);
  if (!doc) throw new Error(`Document not found: ${docId}`);

  const schemaData = await storage.getSchema(docId);
  if (!schemaData?.nodes || Object.keys(schemaData.nodes).length === 0) {
    throw new Error(`Schema not found for document: ${docId}`);
  }
  const schema = { nodes: schemaData.nodes, relationships: schemaData.relationships || [] };

  let documentText = await storage.getFullText(docId);
  if (!documentText) throw new Error(`No text found for document ${docId}`);

  await storage.updateDocument(docId, { status: 'cypher_generating' });

  const docType = detectDocumentType(doc.filename, documentText);
  const prompt = buildCypherPrompt(schema, documentText, docType);
  const systemPrompt = 'You are a Cypher expert. Generate valid Neo4j MERGE statements only. No markdown, no explanations.';

  const generateWithRetry = async () => {
    const response = await callLLM(prompt, systemPrompt, { temperature: 0.1, maxTokens: 8192 });
    let cypher = extractCypher(response);
    if (!cypher?.trim()) throw new Error('No Cypher extracted from response');
    cypher = fixCypherSyntax(cypher);
    cypher = repairMalformedCypher(cypher);
    try {
      cypher = formatStructuredCypher(cypher, schema);
    } catch (e) {
      logger.warn('Format failed, using raw', { error: e.message });
    }
    return cypher;
  };

  try {
    const cypher = await retryWithBackoff(generateWithRetry, {
      maxRetries: 3,
      initialDelay: 2000,
      maxDelay: 30000,
      shouldRetry: isRetryableError,
    });

    const { saveCypherToFile } = await import('../utils/saveCypher.js');
    await saveCypherToFile(docId, cypher);
    await storage.updateDocument(docId, { status: 'cypher_generated' });

    logger.info('Cypher generated', { docId, cypherLength: cypher.length });
    return cypher;
  } catch (error) {
    await storage.updateDocument(docId, { status: 'error', error: error.message });
    throw error;
  }
}
