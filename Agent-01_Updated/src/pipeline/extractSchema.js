/**
 * Schema extraction - file storage version
 */

import { callLLM, extractJSON } from '../utils/llm.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';
import { detectDocumentType, getDocumentTypePrompts } from '../utils/documentTypeDetector.js';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { REFERENCE_BPM_SCHEMA } from '../config/reference-schema.js';
import * as storage from '../storage/fileStorage.js';

function buildSchemaPrompt(text, docType = 'general') {
  const typePrompts = getDocumentTypePrompts(docType);
  const maxTextLength = 10000;
  const truncatedText = text.length > maxTextLength ? text.substring(0, maxTextLength) + '\n[... document continues ...]' : text;

  let referenceSchemaHint = '';
  if (docType === 'business' || docType === 'financial') {
    const refNodeTypes = Object.entries(REFERENCE_BPM_SCHEMA.nodes)
      .map(([label, props]) => `  - ${label}: [${props.join(', ')}]`).join('\n');
    const refRelationships = REFERENCE_BPM_SCHEMA.relationships
      .map(rel => `  - ${rel.from} --[${rel.type}]--> ${rel.to}`).join('\n');
    referenceSchemaHint = `\n\nReference Schema (for guidance - adapt to your document):\nNodes:\n${refNodeTypes}\n\nRelationships:\n${refRelationships}\n\nUse this as a guide for naming conventions and structure, but extract what's actually in YOUR document.`;
  }

  return `You are a graph schema extraction expert. Analyze the following ${docType} document and extract a graph schema that represents the entities, their properties, and relationships.

Your task:
1. Identify all distinct node types (entity types) mentioned in the document
2. For each node type, identify its key properties (attributes, fields)
3. Identify relationship types between node types (how entities connect)

Output ONLY valid JSON in this exact format:
{
  "nodes": {
    "LabelName": ["property1", "property2", "property3"],
    "AnotherLabel": ["propA", "propB"]
  },
  "relationships": [
    {
      "type": "REL_TYPE_UPPER_SNAKE",
      "from": "SourceLabel",
      "to": "TargetLabel"
    }
  ]
}

CRITICAL RULES - Follow These Exactly:
1. No extra keys - only "nodes" and "relationships"
2. Empty arrays if nothing found - never null
3. No invented data - only what's in the document
4. Node labels: PascalCase. Relationship types: UPPER_SNAKE_CASE. Properties: camelCase
5. Business-meaningful relationship names (HELD_BY, HAS_ADDRESS, OWNS) - NOT generic (CONNECTS_TO, RELATED_TO)
6. Each node type MUST have a unique identifier as FIRST property: use {label}Id (contractId, partyId, productId) or natural key (contractReference, organizationName, productCode). Required for MERGE.

${(typePrompts.schemaHint || typePrompts.schemaHints) ? `\nDocument Type Hints:\n${typePrompts.schemaHint || typePrompts.schemaHints}` : ''}

Document text:
${truncatedText}${referenceSchemaHint}

Output JSON only (no markdown, no explanations):`;
}

function validateSchema(schema) {
  if (!schema || typeof schema !== 'object') throw new Error('Invalid schema format');
  if (!schema.nodes || typeof schema.nodes !== 'object') schema.nodes = {};
  if (!schema.relationships || !Array.isArray(schema.relationships)) schema.relationships = [];
  for (const [label, props] of Object.entries(schema.nodes)) {
    if (!Array.isArray(props)) schema.nodes[label] = [];
  }
  schema.relationships = schema.relationships.filter(rel => rel.type && rel.from && rel.to);
  return schema;
}

export async function extractSchema(docId) {
  const doc = await storage.getDocument(docId);
  if (!doc) throw new Error(`Document not found: ${docId}`);

  const existing = await storage.getSchema(docId);
  if (existing?.nodes && Object.keys(existing.nodes).length > 0) {
    logger.info('Using existing schema', { docId });
    return { nodes: existing.nodes, relationships: existing.relationships || [] };
  }

  await storage.updateDocument(docId, { status: 'schema_extracting' });

  let documentText = await storage.getFullText(docId);
  if (!documentText) throw new Error(`No text found for document ${docId}`);

  const docType = detectDocumentType(doc.filename, documentText);
  const prompt = buildSchemaPrompt(documentText, docType);
  const systemPrompt = 'You are a precise graph schema extraction system. Output only valid JSON, no other text.';

  const extractWithRetry = async () => {
    const response = await callLLM(prompt, systemPrompt, { temperature: 0.1 });
    let schema = extractJSON(response);
    schema = validateSchema(schema);
    return schema;
  };

  try {
    const schema = await retryWithBackoff(extractWithRetry, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      isRetryable: isRetryableError,
    });

    await storage.saveSchema(docId, {
      nodes: schema.nodes,
      relationships: schema.relationships,
      extractionModel: config.azure?.deploymentName,
      extractionProvider: 'azure',
    });
    await storage.updateDocument(docId, { status: 'schema_extracted' });

    logger.info('Schema extracted', { docId, nodeCount: Object.keys(schema.nodes).length, relCount: schema.relationships.length });
    return schema;
  } catch (error) {
    await storage.updateDocument(docId, { status: 'error', error: error.message });
    throw error;
  }
}
