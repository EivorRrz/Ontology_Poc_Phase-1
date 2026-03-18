/**
 * Schema Extraction Service
 * Extracts graph schema from document text using LLM
 */

import { callLLM, extractJSON } from '../../utils/llm.js';
import { logger } from '../../utils/logger.js';
import config from '../../config/index.js';
import Document from '../../models/Document.js';
import Schema from '../../models/Schema.js';
import { detectDocumentType, getDocumentTypePrompts } from '../../utils/documentTypeDetector.js';
import { retryWithBackoff, isRetryableError } from '../../utils/retry.js';
import { REFERENCE_BPM_SCHEMA } from '../../config/reference-schema.js';

/**
 * Build schema extraction prompt
 * @param {string} text - Document text
 * @param {string} docType - Document type (business, financial, technical, etc.)
 */
function buildSchemaPrompt(text, docType = 'general') {
  const typePrompts = getDocumentTypePrompts(docType);
  
  // Truncate text if too long (keep it focused)
  const maxTextLength = 10000;
  const truncatedText = text.length > maxTextLength 
    ? text.substring(0, maxTextLength) + '\n[... document continues ...]'
    : text;

  // Build reference schema examples for business documents
  let referenceSchemaHint = '';
  if (docType === 'business' || docType === 'financial') {
    const refNodeTypes = Object.entries(REFERENCE_BPM_SCHEMA.nodes)
      .map(([label, props]) => `  - ${label}: [${props.join(', ')}]`)
      .join('\n');
    const refRelationships = REFERENCE_BPM_SCHEMA.relationships
      .map(rel => `  - ${rel.from} --[${rel.type}]--> ${rel.to}`)
      .join('\n');
    
    referenceSchemaHint = `\n\nReference Schema (for guidance - adapt to your document):
Nodes:
${refNodeTypes}

Relationships:
${refRelationships}

Use this as a guide for naming conventions and structure, but extract what's actually in YOUR document.`;
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

1. ✅ No extra keys:
   - Do not include any keys other than "nodes" and "relationships"
   - Output ONLY these two keys in the JSON object
   - No additional metadata, comments, or extra fields

2. ✅ Empty arrays if nothing found:
   - If no properties are found for a node, use empty array: "LabelName": []
   - If no relationships are found, use empty array: "relationships": []
   - Never use null - always use empty arrays
   - Empty arrays indicate "nothing found" not "error"

3. ✅ No invented data:
   - Only include properties and relationships explicitly mentioned or clearly implied in the document
   - Do not invent properties or relationships that are not present
   - Be conservative - if uncertain, exclude it
   - Only extract what you can confidently identify from the document text

4. ✅ One relationship per logical connection:
   - Do not duplicate relationships unless they represent distinct semantics
   - Each unique relationship type between two node types should appear only once
   - If the same relationship appears multiple times with different semantics, use different relationship types
   - Example: Account → Party can have HELD_BY (ownership) and MANAGED_BY (management) as distinct types

5. ✅ Clear and deterministic naming conventions:
   - Node labels must be PascalCase (e.g., "Account", "Party", "Security")
   - Relationship types must be UPPER_SNAKE_CASE (e.g., "HELD_BY", "HAS_ADDRESS", "EXECUTED_TRADE")
   - Property names should be camelCase (e.g., "accountId", "partyId", "securityId")
   - Use business-meaningful relationship names (HELD_BY, HAS_ADDRESS, OWNS, ADVISES)
   - NOT generic names (CONNECTS_TO, RELATED_TO, LINKS_TO)

6. ✅ Business-meaningful relationships:
   - Relationships should reflect real business semantics
   - Use domain-specific names: OWNS, ADVISES, MANAGES, REPORTS_TO, etc.
   - Avoid generic placeholder names

7. ✅ Comprehensive but safe - Accuracy requirements:
   - Relationships must have clear direction (from → to)
   - Be comprehensive but accurate - only extract what you can confidently identify
   - Only include properties that are explicitly mentioned or clearly implied
   - When in doubt, exclude rather than guess

${typePrompts.schemaHints ? `\nDocument Type Hints:\n${typePrompts.schemaHints}` : ''}

Document text:
${truncatedText}${referenceSchemaHint}

Output JSON only (no markdown, no explanations):`;
}

/**
 * Validate extracted schema structure
 * @param {object} schema - Extracted schema
 * @returns {object} - Validated schema
 */
function validateSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('Invalid schema format: schema must be an object');
  }

  if (!schema.nodes || typeof schema.nodes !== 'object') {
    if (Array.isArray(schema.nodes)) {
      throw new Error('Invalid schema format: nodes should be an object, not an array');
    }
    logger.warn('Missing nodes in schema, using empty object');
    schema.nodes = {};
  }

  if (!schema.relationships || !Array.isArray(schema.relationships)) {
    logger.warn('Missing relationships in schema, using empty array');
    schema.relationships = [];
  }

  // Validate node structure
  for (const [label, props] of Object.entries(schema.nodes)) {
    if (!Array.isArray(props)) {
      logger.warn(`Node ${label} properties should be an array, converting`);
      schema.nodes[label] = [];
    }
  }

  // Validate relationship structure
  for (let i = 0; i < schema.relationships.length; i++) {
    const rel = schema.relationships[i];
    if (!rel.type || !rel.from || !rel.to) {
      logger.warn(`Invalid relationship at index ${i}, removing`, { rel });
      schema.relationships.splice(i, 1);
      i--;
    }
  }

  return schema;
}

/**
 * Extract schema from document
 * @param {string} docId - MongoDB document ID
 * @returns {Promise<object>} - Extracted schema
 */
export async function extractSchema(docId) {
  const doc = await Document.findById(docId);
  if (!doc) {
    throw new Error(`Document not found: ${docId}`);
  }

  // Check if schema already exists
  const existingSchema = await Schema.findOne({ docId });
  if (existingSchema) {
    logger.info('Using existing schema', { docId, schemaId: existingSchema._id });
    return {
      nodes: existingSchema.nodes,
      relationships: existingSchema.relationships
    };
  }

  logger.info('Extracting schema', { docId, filename: doc.filename });

  // Get document text from chunks or full text
  let documentText = '';
  if (doc.fullText) {
    documentText = doc.fullText;
  } else {
    // Try to get from chunks
    const DocumentChunk = (await import('../../models/DocumentChunk.js')).default;
    const chunks = await DocumentChunk.find({ docId }).sort({ chunkIndex: 1 });
    if (chunks.length > 0) {
      documentText = chunks.map(c => c.text).join('\n\n');
    } else {
      throw new Error(`No text found for document ${docId}`);
    }
  }

  // Detect document type
  const docType = detectDocumentType(doc.filename, documentText);

  // Build prompt
  const prompt = buildSchemaPrompt(documentText, docType);
  const systemPrompt = 'You are a precise graph schema extraction system. Output only valid JSON, no other text.';

  // Call LLM with retry logic
  const extractSchemaWithRetry = async () => {
    logger.info('Calling Azure OpenAI for schema extraction', { docId });

    const response = await callLLM(prompt, systemPrompt, { temperature: 0.1 });

    logger.info('Schema extraction LLM response received', {
      docId,
      responseLength: response?.length || 0
    });

    // Extract JSON from response
    let schema;
    try {
      schema = extractJSON(response);
    } catch (error) {
      logger.error('Failed to extract JSON from schema response', {
        docId,
        error: error.message,
        responsePreview: response?.substring(0, 500)
      });
      throw new Error(`Failed to extract JSON from schema response: ${error.message}`);
    }

    // Validate schema structure
    schema = validateSchema(schema);

    logger.info('Schema extracted successfully', {
      docId,
      nodeCount: Object.keys(schema.nodes).length,
      relationshipCount: schema.relationships.length
    });

    return schema;
  };

  try {
    const schema = await retryWithBackoff(extractSchemaWithRetry, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      isRetryable: isRetryableError
    });

    // Save schema to MongoDB
    const schemaDoc = new Schema({
      docId,
      nodes: schema.nodes,
      relationships: schema.relationships,
      rawResponse: null, // Don't store raw response to save space
      extractionModel: config.azure.deploymentName,
      extractionProvider: 'azure'
    });

    await schemaDoc.save();

    logger.info('Schema saved to MongoDB', {
      docId,
      schemaId: schemaDoc._id,
      nodeCount: Object.keys(schema.nodes).length,
      relationshipCount: schema.relationships.length
    });

    return schema;
  } catch (error) {
    logger.error('Schema extraction failed', {
      docId,
      error: error.message,
      stack: error.stack
    });

    // Save error state
    try {
      const errorSchema = new Schema({
        docId,
        nodes: {},
        relationships: [],
        rawResponse: `ERROR: ${error.message}`,
        extractionModel: config.azure.deploymentName,
        extractionProvider: 'azure'
      });
      await errorSchema.save();
    } catch (saveError) {
      logger.error('Failed to save error schema', { docId, error: saveError.message });
    }

    throw error;
  }
}

