/**
 * Pipeline orchestrator - file storage version
 * Runs: parse -> schema -> cypher -> ingest
 */

import { parseDocument } from './parseDocument.js';
import { extractSchema } from './extractSchema.js';
import { generateCypher } from './generateCypher.js';
import { ingestToNeo4j } from './ingestToNeo4j.js';
import * as storage from '../storage/fileStorage.js';
import { logger } from '../utils/logger.js';

export async function runPipeline(docId, options = {}) {
  const { useLlamaParse = false, createNeo4jConstraints = true } = options;

  const doc = await storage.getDocument(docId);
  if (!doc) throw new Error(`Document not found: ${docId}`);

  const startTime = Date.now();
  await storage.updateDocument(docId, { processingStartedAt: new Date().toISOString() });

  try {
    logger.info('Step 1: Parsing', { docId });
    await parseDocument(docId, useLlamaParse);

    logger.info('Step 2: Extracting schema', { docId });
    const schema = await extractSchema(docId);

    if (createNeo4jConstraints) {
      try {
        const { createConstraints } = await import('../services/neo4jIngest/index.js');
        await createConstraints(schema);
      } catch (e) {
        logger.warn('Constraints failed', { error: e.message });
      }
    }

    logger.info('Step 3: Generating Cypher', { docId });
    await generateCypher(docId);

    logger.info('Step 4: Ingesting to Neo4j', { docId });
    const ingestResult = await ingestToNeo4j(docId, { createConstraints: false });

    const totalTime = Date.now() - startTime;
    logger.info('Pipeline completed', { docId, totalTimeMs: totalTime, ...ingestResult });

    const { getCypherFilePath } = await import('../utils/saveCypher.js');
    return {
      success: true,
      docId,
      cypherFilePath: getCypherFilePath(docId),
      schema: { nodeTypes: Object.keys(schema.nodes).length, relationshipTypes: schema.relationships.length },
      ingestion: ingestResult,
    };
  } catch (error) {
    await storage.updateDocument(docId, { status: 'error', error: error.message });
    logger.error('Pipeline failed', { docId, error: error.message });
    throw error;
  }
}

export async function getPipelineStatus(docId) {
  const doc = await storage.getDocument(docId);
  if (!doc) return null;

  const schema = await storage.getSchema(docId);
  const { readCypherFromFile } = await import('../utils/saveCypher.js');
  const cypher = await readCypherFromFile(docId);

  return {
    document: {
      id: doc.docId,
      filename: doc.filename,
      status: doc.status,
      error: doc.error,
      uploadTimestamp: doc.uploadTimestamp,
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt,
    },
    schema: schema ? { extracted: true, nodeTypes: Object.keys(schema.nodes || {}).length, relationshipTypes: (schema.relationships || []).length } : { extracted: false },
    cypher: { generated: !!cypher?.trim(), executed: doc.status === 'completed' },
  };
}
