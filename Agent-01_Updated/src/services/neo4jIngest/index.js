/**
 * Neo4j Ingestion Service
 * Executes generated Cypher in Neo4j with proper transactions
 */

import { getNeo4jSession } from '../../config/database.js';
import neo4j from 'neo4j-driver';
import { logger } from '../../utils/logger.js';
import ChunkCypherResult from '../../models/ChunkCypherResult.js';
import DocumentChunk from '../../models/DocumentChunk.js';
import Document from '../../models/Document.js';
import { retryWithBackoff, isRetryableError } from '../../utils/retry.js';

/**
 * Strip leading block and line comments from Cypher statements.
 * Enables processing of statements that start with comment blocks.
 */
function stripLeadingComments(statement) {
  let s = statement.trim();
  // Remove block comments
  while (s.startsWith('/*')) {
    const end = s.indexOf('*/', 2);
    if (end === -1) break;
    s = s.substring(end + 2).trim();
  }
  // Remove line comments at start
  while (s.startsWith('--')) {
    const nl = s.indexOf('\n');
    if (nl === -1) return '';
    s = s.substring(nl + 1).trim();
  }
  return s;
}

/**
 * Split Cypher into individual statements
 * Handles semicolon-separated statements
 */
function splitCypherStatements(cypher) {
  if (!cypher || cypher.trim().length === 0) {
    return [];
  }

  // Split by semicolon, but preserve semicolons inside strings/quotes
  const statements = [];
  let current = '';
  let inString = false;
  let stringChar = null;

  for (let i = 0; i < cypher.length; i++) {
    const char = cypher[i];
    const prevChar = i > 0 ? cypher[i - 1] : null;

    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
    }

    if (char === ';' && !inString) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }
  }

  // Add last statement if any
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements.filter(s => s.length > 0);
}

/**
 * Check if a Cypher statement is a schema modification
 * Schema modifications: CREATE CONSTRAINT, CREATE INDEX, DROP CONSTRAINT, DROP INDEX
 */
function isSchemaModification(statement) {
  const upperStatement = statement.trim().toUpperCase();
  return upperStatement.startsWith('CREATE CONSTRAINT') ||
         upperStatement.startsWith('CREATE INDEX') ||
         upperStatement.startsWith('DROP CONSTRAINT') ||
         upperStatement.startsWith('DROP INDEX');
}

/**
 * Separate schema modification statements from write statements
 * Strips leading comments so statements with leading comment blocks are processed
 * @param {Array<string>} statements - Array of Cypher statements
 * @returns {Object} - { schemaStatements: Array, writeStatements: Array }
 */
function separateSchemaAndWriteStatements(statements) {
  const schemaStatements = [];
  const writeStatements = [];

  for (const statement of statements) {
    const stripped = stripLeadingComments(statement);
    if (!stripped) continue;

    if (isSchemaModification(stripped)) {
      schemaStatements.push(statement);
    } else {
      writeStatements.push(statement);
    }
  }

  return { schemaStatements, writeStatements };
}

/**
 * Validate Cypher syntax using EXPLAIN
 * @param {string} cypher - Cypher query to validate
 * @param {object} session - Neo4j session
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateCypher(cypher, session) {
  if (!cypher || cypher.trim().length === 0) {
    return { valid: false, error: 'Empty Cypher' };
  }

  try {
    // Split into statements and validate each
    const statements = splitCypherStatements(cypher);
    
    for (const statement of statements) {
      // Use EXPLAIN to check syntax without executing
      await session.run(`EXPLAIN ${statement}`);
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Execute Cypher for a single chunk
 * @param {string} chunkId - MongoDB chunk ID
 * @returns {Promise<{nodesCreated: number, relationshipsCreated: number}>}
 */
export async function ingestChunkCypher(chunkId) {
  const result = await ChunkCypherResult.findOne({ chunkId });
  if (!result) {
    throw new Error(`Cypher result not found for chunk: ${chunkId}`);
  }

  if (result.status === 'executed') {
    logger.info('Cypher already executed for chunk', { chunkId });
    return {
      nodesCreated: result.nodesCreated || 0,
      relationshipsCreated: result.relationshipsCreated || 0
    };
  }

  const chunk = await DocumentChunk.findById(chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }

  // Validate Cypher before ingestion
  const validationSession = getNeo4jSession(neo4j.session.READ);
  try {
    const validationResult = await validateCypher(result.generatedCypher, validationSession);
    if (!validationResult.valid) {
      await validationSession.close();
      throw new Error(`Cypher validation failed: ${validationResult.error}`);
    }
    logger.info('Cypher validated successfully', { chunkId });
  } catch (validationError) {
    await validationSession.close();
    logger.error('Cypher validation error', { chunkId, error: validationError.message });
    throw validationError;
  } finally {
    await validationSession.close();
  }

  await chunk.updateOne({ status: 'ingesting' });
  await result.updateOne({ status: 'validated' });

  const session = getNeo4jSession(neo4j.session.WRITE);
  const startTime = Date.now();
  let tx = null;

  try {
    logger.info('Executing Cypher for chunk', { chunkId, cypherLength: result.generatedCypher.length });

    // Split into individual statements
    const statements = splitCypherStatements(result.generatedCypher);

    if (statements.length === 0) {
      throw new Error('No valid Cypher statements found');
    }

    // Separate schema modifications from write operations
    const { schemaStatements, writeStatements } = separateSchemaAndWriteStatements(statements);

    logger.info('Split Cypher into statements', { 
      chunkId, 
      totalStatements: statements.length,
      schemaStatements: schemaStatements.length,
      writeStatements: writeStatements.length
    });

    // Step 1: Execute schema modifications first (if any) in separate transactions
    if (schemaStatements.length > 0) {
      logger.info('Executing schema modifications for chunk', { chunkId, count: schemaStatements.length });
      const schemaSession = getNeo4jSession(neo4j.session.WRITE);
      try {
        for (const schemaStatement of schemaStatements) {
          try {
            await schemaSession.run(schemaStatement);
            logger.debug('Schema statement executed', { 
              chunkId, 
              statement: schemaStatement.substring(0, 100) 
            });
          } catch (schemaError) {
            // Ignore "already exists" errors for constraints
            const errorMsg = schemaError.message?.toLowerCase() || '';
            if (!errorMsg.includes('already exists') && 
                !errorMsg.includes('equivalent') &&
                !errorMsg.includes('duplicate')) {
              logger.warn('Schema statement failed', { 
                chunkId, 
                statement: schemaStatement.substring(0, 100),
                error: schemaError.message 
              });
              // Don't throw - continue with other schema statements
            }
          }
        }
      } finally {
        await schemaSession.close();
      }
    }

    // Step 2: Execute write operations in a transaction
    if (writeStatements.length === 0) {
      logger.warn('No write statements to execute', { chunkId });
      return { nodesCreated: 0, relationshipsCreated: 0 };
    }

    tx = session.beginTransaction();

    let nodesCreated = 0;
    let relationshipsCreated = 0;

    let hasErrors = false;
    let lastError = null;

    for (const statement of writeStatements) {
      try {
        const cypherResult = await tx.run(statement);
        
        // Try to count created nodes/relationships from summary
        const summary = cypherResult.summary;
        if (summary && summary.counters) {
          const stats = summary.counters;
          try {
            // Handle both function and property access (Neo4j driver version differences)
            const nodesCreatedCount = typeof stats.nodesCreated === 'function' 
              ? stats.nodesCreated() 
              : (stats.nodesCreated || 0);
            const relationshipsCreatedCount = typeof stats.relationshipsCreated === 'function'
              ? stats.relationshipsCreated()
              : (stats.relationshipsCreated || 0);
            nodesCreated += nodesCreatedCount || 0;
            relationshipsCreated += relationshipsCreatedCount || 0;
          } catch (statsError) {
            // If stats access fails, log but don't fail the transaction
            logger.warn('Could not read stats from summary', { 
              chunkId,
              error: statsError.message,
              statsKeys: Object.keys(stats || {})
            });
          }
        }
      } catch (error) {
        logger.error('Failed to execute Cypher statement', { 
          chunkId, 
          statement: statement.substring(0, 200),
          error: error.message 
        });
        hasErrors = true;
        lastError = error;
        // Transaction is rolled back - break out of loop
        break;
      }
    }

    if (hasErrors) {
      // Transaction already rolled back by Neo4j when statement failed
      throw lastError;
    }

    await tx.commit();
    tx = null;

    const executionTime = Date.now() - startTime;

    // Update result
    await result.updateOne({
      status: 'executed',
      executionTimeMs: executionTime,
      nodesCreated,
      relationshipsCreated
    });

    await chunk.updateOne({ status: 'ingested' });

    logger.info('Cypher executed successfully', { 
      chunkId, 
      nodesCreated, 
      relationshipsCreated,
      executionTimeMs: executionTime
    });

    return { nodesCreated, relationshipsCreated };

  } catch (error) {
    // Handle transaction cleanup
    if (tx) {
      try {
        // Try to rollback - safe even if already rolled back
        await tx.rollback();
      } catch (rollbackError) {
        // If rollback fails because transaction was already rolled back, that's expected
        // Only log unexpected errors
        const errorMsg = rollbackError.message?.toLowerCase() || '';
        if (!errorMsg.includes('rolled back') && 
            !errorMsg.includes('terminated') &&
            !errorMsg.includes('already')) {
          logger.error('Failed to rollback transaction', { error: rollbackError.message });
        }
      }
    }
    
    await result.updateOne({
      status: 'error',
      error: error.message
    });

    await chunk.updateOne({
      status: 'error',
      error: error.message
    });

    logger.error('Cypher execution failed', { chunkId, error: error.message });
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Ingest Cypher for full document (no chunks)
 * @param {string} docId - Document ID
 * @returns {Promise<{nodesCreated: number, relationshipsCreated: number}>}
 */
export async function ingestFullDocumentCypher(docId) {
  const cypherResult = await ChunkCypherResult.findOne({ docId, chunkId: null });
  if (!cypherResult) {
    throw new Error(`Cypher result not found for document: ${docId}`);
  }

  if (cypherResult.status === 'executed') {
    logger.info('Cypher already executed for document', { docId });
    return {
      nodesCreated: cypherResult.nodesCreated || 0,
      relationshipsCreated: cypherResult.relationshipsCreated || 0
    };
  }

  // Validate Cypher before ingestion
  const validationSession = getNeo4jSession(neo4j.session.READ);
  try {
    const validationResult = await validateCypher(cypherResult.generatedCypher, validationSession);
    if (!validationResult.valid) {
      await validationSession.close();
      throw new Error(`Cypher validation failed: ${validationResult.error}`);
    }
    logger.info('Cypher validated successfully', { docId });
  } catch (validationError) {
    await validationSession.close();
    logger.error('Cypher validation error', { docId, error: validationError.message });
    throw validationError;
  } finally {
    await validationSession.close();
  }

  await cypherResult.updateOne({ status: 'validated' });

  const session = getNeo4jSession(neo4j.session.WRITE);
  const startTime = Date.now();
  let tx = null;

  try {
    logger.info('Executing Cypher for full document', { docId, cypherLength: cypherResult.generatedCypher.length });

    // Split into individual statements
    const statements = splitCypherStatements(cypherResult.generatedCypher);

    if (statements.length === 0) {
      throw new Error('No valid Cypher statements found');
    }

    // Separate schema modifications from write operations
    const { schemaStatements, writeStatements } = separateSchemaAndWriteStatements(statements);

    logger.info('Split Cypher into statements', { 
      docId, 
      totalStatements: statements.length,
      schemaStatements: schemaStatements.length,
      writeStatements: writeStatements.length
    });

    // Step 1: Execute schema modifications first (if any) in separate transactions
    if (schemaStatements.length > 0) {
      logger.info('Executing schema modifications', { docId, count: schemaStatements.length });
      const schemaSession = getNeo4jSession(neo4j.session.WRITE);
      try {
        for (const schemaStatement of schemaStatements) {
          try {
            await schemaSession.run(schemaStatement);
            logger.debug('Schema statement executed', { 
              docId, 
              statement: schemaStatement.substring(0, 100) 
            });
          } catch (schemaError) {
            // Ignore "already exists" errors for constraints
            const errorMsg = schemaError.message?.toLowerCase() || '';
            if (!errorMsg.includes('already exists') && 
                !errorMsg.includes('equivalent') &&
                !errorMsg.includes('duplicate')) {
              logger.warn('Schema statement failed', { 
                docId, 
                statement: schemaStatement.substring(0, 100),
                error: schemaError.message 
              });
              // Don't throw - continue with other schema statements
            }
          }
        }
      } finally {
        await schemaSession.close();
      }
    }

    // Step 2: Execute write operations in a transaction
    if (writeStatements.length === 0) {
      logger.warn('No write statements to execute', { docId });
      return { nodesCreated: 0, relationshipsCreated: 0 };
    }

    tx = session.beginTransaction();

    let nodesCreated = 0;
    let relationshipsCreated = 0;

    let hasErrors = false;
    let lastError = null;

    for (const statement of writeStatements) {
      try {
        const cypherResult_run = await tx.run(statement);
        
        // Try to count created nodes/relationships from summary
        const summary = cypherResult_run.summary;
        if (summary && summary.counters) {
          const stats = summary.counters;
          try {
            // Handle both function and property access (Neo4j driver version differences)
            const nodesCreatedCount = typeof stats.nodesCreated === 'function' 
              ? stats.nodesCreated() 
              : (stats.nodesCreated || 0);
            const relationshipsCreatedCount = typeof stats.relationshipsCreated === 'function'
              ? stats.relationshipsCreated()
              : (stats.relationshipsCreated || 0);
            nodesCreated += nodesCreatedCount || 0;
            relationshipsCreated += relationshipsCreatedCount || 0;
          } catch (statsError) {
            // If stats access fails, log but don't fail the transaction
            logger.warn('Could not read stats from summary', { 
              docId,
              error: statsError.message,
              statsKeys: Object.keys(stats || {})
            });
          }
        }
      } catch (error) {
        logger.error('Failed to execute Cypher statement', { 
          docId, 
          statement: statement.substring(0, 200),
          error: error.message 
        });
        hasErrors = true;
        lastError = error;
        // Transaction is rolled back - break out of loop
        break;
      }
    }

    if (hasErrors) {
      // Transaction already rolled back by Neo4j when statement failed
      throw lastError;
    }

    await tx.commit();
    tx = null;

    const executionTime = Date.now() - startTime;

    // Update result
    await cypherResult.updateOne({
      status: 'executed',
      executionTimeMs: executionTime,
      nodesCreated,
      relationshipsCreated
    });

    logger.info('Cypher executed successfully', { 
      docId, 
      nodesCreated, 
      relationshipsCreated,
      executionTimeMs: executionTime
    });

    return { nodesCreated, relationshipsCreated };

  } catch (error) {
    // Handle transaction cleanup
    if (tx) {
      try {
        // Try to rollback - safe even if already rolled back
        await tx.rollback();
      } catch (rollbackError) {
        // If rollback fails because transaction was already rolled back, that's expected
        // Only log unexpected errors
        const errorMsg = rollbackError.message?.toLowerCase() || '';
        if (!errorMsg.includes('rolled back') && 
            !errorMsg.includes('terminated') &&
            !errorMsg.includes('already')) {
          logger.error('Failed to rollback transaction', { error: rollbackError.message });
        }
      }
    }
    
    await cypherResult.updateOne({
      status: 'error',
      error: error.message
    });

    logger.error('Cypher execution failed', { docId, error: error.message });
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Ingest all Cypher for a document (handles both chunked and full document modes)
 */
export async function ingestAllChunks(docId) {
  const doc = await Document.findById(docId);
  if (!doc) {
    throw new Error(`Document not found: ${docId}`);
  }

  await doc.updateOne({ status: 'ingesting' });

  // Check if this is a full document (no chunks) or chunked mode
  const fullDocumentResult = await ChunkCypherResult.findOne({ docId, chunkId: null });
  const chunks = await DocumentChunk.find({ docId }).sort({ chunkIndex: 1 });

  let totalNodes = 0;
  let totalRelationships = 0;
  let successCount = 0;
  let errorCount = 0;

  // Prioritize full document mode if it exists (even if chunks exist from previous runs)
  if (fullDocumentResult) {
    // Full document mode - ingest complete Cypher
    logger.info('Ingesting full document Cypher', { docId });
    
    try {
      // Retry ingestion with exponential backoff
      const result = await retryWithBackoff(
        () => ingestFullDocumentCypher(docId),
        {
          maxRetries: 3,
          initialDelay: 2000,
          maxDelay: 30000,
          shouldRetry: (error) => isRetryableError(error),
          context: `ingestion-document-${docId}`
        }
      );
      totalNodes = result.nodesCreated;
      totalRelationships = result.relationshipsCreated;
      successCount = 1;
    } catch (error) {
      logger.error('Failed to ingest full document Cypher after retries', { 
        docId, 
        error: error.message 
      });
      errorCount = 1;
    }
  } else if (chunks.length > 0) {
    // Chunked mode - process chunks
    logger.info('Ingesting chunked Cypher', { docId, chunkCount: chunks.length });

    for (const chunk of chunks) {
      try {
        // Retry ingestion with exponential backoff
        const result = await retryWithBackoff(
          () => ingestChunkCypher(chunk._id),
          {
            maxRetries: 3,
            initialDelay: 2000,
            maxDelay: 30000,
            shouldRetry: (error) => {
              // Retry on retryable errors or if chunk status is 'error'
              return isRetryableError(error) || chunk.status === 'error';
            },
            context: `ingestion-chunk-${chunk._id}`
          }
        );
        totalNodes += result.nodesCreated;
        totalRelationships += result.relationshipsCreated;
        successCount++;
      } catch (error) {
        logger.error('Failed to ingest chunk after retries', { 
          chunkId: chunk._id, 
          error: error.message 
        });
        errorCount++;
      }
    }
  } else {
    throw new Error(`No Cypher results found for document: ${docId}`);
  }

  // Update document status
  const finalStatus = errorCount === 0 ? 'completed' : 
                     (successCount > 0 ? 'completed' : 'error');
  
  await doc.updateOne({
    status: finalStatus,
    processedChunks: successCount,
    processingCompletedAt: new Date()
  });

  logger.info('Ingestion completed', { 
    docId, 
    totalNodes, 
    totalRelationships,
    successCount,
    errorCount
  });

  return {
    totalNodes,
    totalRelationships,
    successCount,
    errorCount
  };
}

/**
 * Create uniqueness constraints for common node labels
 * Should be run once during setup
 */
export async function createConstraints(schema) {
  const session = getNeo4jSession(neo4j.session.WRITE);

  try {
    logger.info('Creating Neo4j constraints', { nodeTypes: Object.keys(schema.nodes).length });

    const constraints = [];

    // For each node type, create constraints ONLY on true ID properties
    // True IDs are: {label}Id (e.g., accountId for Account, tradeId for Trade)
    // NOT foreign keys like accountId in Trade (that's a reference, not a unique ID)
    for (const [label, props] of Object.entries(schema.nodes)) {
      // Find true ID property - must match the pattern {label}Id (case-insensitive)
      // Examples: Account -> accountId, Trade -> tradeId, Position -> positionId
      const labelLower = label.toLowerCase();
      const trueIdPattern = new RegExp(`^${labelLower}id$|^${labelLower}_id$`, 'i');
      
      const trueIdProps = props.filter(p => {
        const lowerProp = p.toLowerCase();
        // Match exact pattern: {label}Id (e.g., accountId for Account, tradeId for Trade)
        return trueIdPattern.test(lowerProp);
      });

      // Create constraint ONLY on true ID properties (not foreign keys)
      for (const idProp of trueIdProps) {
        const constraintName = `${label.toLowerCase()}_${idProp}_unique`;
        
        try {
          const cypher = `
            CREATE CONSTRAINT ${constraintName} IF NOT EXISTS
            FOR (n:${label})
            REQUIRE n.${idProp} IS UNIQUE
          `;
          
          await session.run(cypher);
          constraints.push({ label, property: idProp });
          logger.info('Created constraint on true ID', { label, property: idProp });
        } catch (error) {
          // Ignore if constraint already exists
          if (!error.message.includes('already exists') && !error.message.includes('EquivalentConstraint')) {
            logger.warn('Failed to create constraint', { label, property: idProp, error: error.message });
          }
        }
      }
      
      // If no true ID found, check for generic id/uuid properties
      if (trueIdProps.length === 0) {
        const genericIdProps = props.filter(p => {
          const lowerProp = p.toLowerCase();
          return /^(id|_id|uuid)$/.test(lowerProp);
        });
        
        for (const idProp of genericIdProps) {
          const constraintName = `${label.toLowerCase()}_${idProp}_unique`;
          
          try {
            const cypher = `
              CREATE CONSTRAINT ${constraintName} IF NOT EXISTS
              FOR (n:${label})
              REQUIRE n.${idProp} IS UNIQUE
            `;
            
            await session.run(cypher);
            constraints.push({ label, property: idProp });
            logger.info('Created constraint on generic ID', { label, property: idProp });
          } catch (error) {
            if (!error.message.includes('already exists') && !error.message.includes('EquivalentConstraint')) {
              logger.warn('Failed to create constraint', { label, property: idProp, error: error.message });
            }
          }
        }
      }
    }

    return constraints;
  } finally {
    await session.close();
  }
}

/**
 * Execute Cypher string (no Mongoose - for file storage pipeline)
 * @param {string} cypher - Raw Cypher to execute
 * @returns {Promise<{nodesCreated: number, relationshipsCreated: number}>}
 */
export async function executeCypherString(cypher) {
  const statements = splitCypherStatements(cypher);
  if (statements.length === 0) throw new Error('No valid Cypher statements found');

  const { schemaStatements, writeStatements } = separateSchemaAndWriteStatements(statements);

  // Validate combined write (relationship MERGEs reference variables from node MERGEs)
  const combinedWrite = writeStatements.length > 0 ? writeStatements.join('\n') : '';
  if (combinedWrite) {
    const validationSession = getNeo4jSession(neo4j.session.READ);
    try {
      const validationResult = await validateCypher(combinedWrite, validationSession);
      if (!validationResult.valid) {
        await validationSession.close();
        throw new Error(`Cypher validation failed: ${validationResult.error}`);
      }
    } finally {
      await validationSession.close();
    }
  }

  if (schemaStatements.length > 0) {
    const schemaSession = getNeo4jSession(neo4j.session.WRITE);
    try {
      for (const stmt of schemaStatements) {
        try {
          await schemaSession.run(stmt);
        } catch (e) {
          const msg = (e.message || '').toLowerCase();
          if (!msg.includes('already exists') && !msg.includes('equivalent') && !msg.includes('duplicate')) {
            logger.warn('Schema statement failed', { error: e.message });
          }
        }
      }
    } finally {
      await schemaSession.close();
    }
  }

  if (writeStatements.length === 0) return { nodesCreated: 0, relationshipsCreated: 0 };

  const session = getNeo4jSession(neo4j.session.WRITE);
  const tx = session.beginTransaction();
  let nodesCreated = 0;
  let relationshipsCreated = 0;

  try {
    const result = await tx.run(combinedWrite);
    const summary = result.summary;
    if (summary?.counters) {
      const s = summary.counters;
      // Driver v5+: counters.updates() returns { nodesCreated, relationshipsCreated }
      const updates = typeof s.updates === 'function' ? s.updates() : null;
      if (updates) {
        nodesCreated = updates.nodesCreated || 0;
        relationshipsCreated = updates.relationshipsCreated || 0;
      } else {
        nodesCreated = (typeof s.nodesCreated === 'function' ? s.nodesCreated() : s.nodesCreated) || 0;
        relationshipsCreated = (typeof s.relationshipsCreated === 'function' ? s.relationshipsCreated() : s.relationshipsCreated) || 0;
      }
    }
    await tx.commit();
    return { nodesCreated, relationshipsCreated };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    await session.close();
  }
}

