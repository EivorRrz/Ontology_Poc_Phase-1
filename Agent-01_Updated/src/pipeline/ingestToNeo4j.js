/**
 * Neo4j ingestion - reads from generated.cypher file only
 */

import { executeCypherString, createConstraints } from '../services/neo4jIngest/index.js';
import { logger } from '../utils/logger.js';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import { readCypherFromFile } from '../utils/saveCypher.js';
import * as storage from '../storage/fileStorage.js';

export async function ingestToNeo4j(docId, options = { createConstraints: true }) {
  const doc = await storage.getDocument(docId);
  if (!doc) throw new Error(`Document not found: ${docId}`);

  const cypher = await readCypherFromFile(docId);
  if (!cypher?.trim()) {
    throw new Error(`No Cypher found for document: ${docId}. Run generateCypher first.`);
  }

  if (doc.status === 'completed') {
    logger.info('Cypher already executed', { docId });
    return {
      nodesCreated: 0,
      relationshipsCreated: 0,
      successCount: 1,
      errorCount: 0,
      totalNodes: 0,
      totalRelationships: 0,
    };
  }

  await storage.updateDocument(docId, { status: 'ingesting' });

  if (options.createConstraints) {
    const schema = await storage.getSchema(docId);
    if (schema?.nodes && Object.keys(schema.nodes).length > 0) {
      try {
        await createConstraints({ nodes: schema.nodes, relationships: schema.relationships || [] });
      } catch (e) {
        logger.warn('Constraints creation failed', { error: e.message });
      }
    }
  }

  const executeWithRetry = async () => {
    return executeCypherString(cypher);
  };

  try {
    const { nodesCreated, relationshipsCreated } = await retryWithBackoff(executeWithRetry, {
      maxRetries: 3,
      initialDelay: 2000,
      maxDelay: 30000,
      shouldRetry: isRetryableError,
    });

    await storage.updateDocument(docId, {
      status: 'completed',
      processingCompletedAt: new Date().toISOString(),
    });

    logger.info('Ingestion completed', { docId, nodesCreated, relationshipsCreated });

    return {
      nodesCreated,
      relationshipsCreated,
      successCount: 1,
      errorCount: 0,
      totalNodes: nodesCreated,
      totalRelationships: relationshipsCreated,
    };
  } catch (error) {
    await storage.updateDocument(docId, { status: 'error', error: error.message });
    throw error;
  }
}
