/**
 * Pipeline Orchestrator
 * Coordinates the full document-to-graph pipeline
 */

import { parseDocument } from './parsing/index.js';
import { extractSchema } from './schemaExtraction/index.js';
import { generateCypherForAllChunks, generateCypherForFullDocument } from './cypherGeneration/index.js';
import { ingestAllChunks, createConstraints } from './neo4jIngest/index.js';
import { chunkText } from '../utils/chunking.js';
import { logger } from '../utils/logger.js';
import Document from '../models/Document.js';
import DocumentChunk from '../models/DocumentChunk.js';
import Schema from '../models/Schema.js';
import ChunkCypherResult from '../models/ChunkCypherResult.js';
import { recordMetrics, recordDocumentCompletion } from './metrics.js';
import { askYesNo } from '../utils/prompt.js';
import { saveCypherToFile } from '../utils/saveCypher.js';
import { formatStructuredCypher } from '../utils/formatCypher.js';
import config from '../config/index.js';

/**
 * Run the complete pipeline for a document
 * @param {string} docId - MongoDB document ID
 * @param {object} options - Pipeline options
 * @returns {Promise<object>} - Pipeline results
 */
export async function runPipeline(docId, options = {}) {
  const {
    useLlamaParse = !!process.env.LLAMAPARSE_API_KEY,
    createNeo4jConstraints = true,
    useFullDocument = true // Default to full document mode (no chunking)
  } = options;

  const doc = await Document.findById(docId);
  if (!doc) {
    throw new Error(`Document not found: ${docId}`);
  }

  await doc.updateOne({ 
    processingStartedAt: new Date(),
    status: 'parsing'
  });

  logger.info('Starting pipeline', { docId, filename: doc.filename });

  const pipelineStartTime = Date.now();

  try {
    // Step 1: Parse document
    logger.info('Step 1: Parsing document', { docId });
    const parseStartTime = Date.now();
    const fullText = await parseDocument(docId, useLlamaParse);
    const parseTime = Date.now() - parseStartTime;
    await recordMetrics({ stage: 'parsing', success: true, processingTime: parseTime, docId });

    // Step 2: Chunk document (only if not using full document mode)
    if (!useFullDocument) {
    logger.info('Step 2: Chunking document', { docId });
    const chunks = chunkText(fullText);
    
    // Store chunks in MongoDB
    await DocumentChunk.deleteMany({ docId }); // Clear old chunks if re-running
    
    const chunkDocs = [];
    for (const chunk of chunks) {
      const chunkDoc = new DocumentChunk({
        docId,
        chunkIndex: chunk.chunkIndex,
        rawText: chunk.text,
        wordCount: chunk.wordCount,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        status: 'pending'
      });
      await chunkDoc.save();
      chunkDocs.push(chunkDoc);
    }

    await doc.updateOne({
      totalChunks: chunks.length,
      processedChunks: 0
    });

    logger.info('Document chunked', { docId, chunkCount: chunks.length });
    } else {
      logger.info('Step 2: Using full document mode (no chunking)', { docId });
      await doc.updateOne({
        totalChunks: 1,
        processedChunks: 0
      });
    }

    // Step 3: Extract schema
    logger.info('Step 3: Extracting schema', { docId });
    const schemaStartTime = Date.now();
    const schema = await extractSchema(docId);
    const schemaTime = Date.now() - schemaStartTime;
    await recordMetrics({ stage: 'schemaExtraction', success: true, processingTime: schemaTime, docId });
    
    // Get full schema object for formatting
    const schemaDoc = await Schema.findOne({ docId });
    const fullSchema = schemaDoc ? {
      nodes: schemaDoc.nodes,
      relationships: schemaDoc.relationships
    } : schema;

    // Step 4: Create Neo4j constraints (optional)
    if (createNeo4jConstraints) {
      logger.info('Step 4: Creating Neo4j constraints', { docId });
      try {
        await createConstraints(schema);
      } catch (error) {
        logger.warn('Failed to create constraints', { docId, error: error.message });
        // Don't fail the pipeline if constraints fail
      }
    }

    // Step 5: Generate Cypher (full document or chunks)
    await doc.updateOne({ status: 'cypher_generating' });
    const cypherStartTime = Date.now();
    
    let fullCypher = '';
    let cypherResultsDocs = [];
    let chunkCount = 0;
    let successfulCypher = 0;
    let failedCypher = 0;
    
    if (useFullDocument) {
      // Generate Cypher for full document
      logger.info('Step 5: Generating Cypher for full document', { docId });
      fullCypher = await generateCypherForFullDocument(docId);
      
      // Save as a single ChunkCypherResult for consistency
      // For full document mode, chunkId is optional (null)
      const cypherResultData = {
        docId,
        chunkId: null, // Explicitly set to null for full document
        generatedCypher: fullCypher,
        status: 'generated',
        generationModel: config.azure.deploymentName,
        generationProvider: 'azure'
      };
      
      logger.debug('Creating ChunkCypherResult for full document', { 
        docId, 
        chunkId: cypherResultData.chunkId,
        hasCypher: !!cypherResultData.generatedCypher 
      });
      
      const cypherResult = new ChunkCypherResult(cypherResultData);
      
      // Validate before save to catch any issues early
      const validationError = cypherResult.validateSync();
      if (validationError) {
        logger.error('ChunkCypherResult validation failed', { 
          docId, 
          errors: Object.keys(validationError.errors || {}),
          errorMessages: Object.values(validationError.errors || {}).map(e => e.message),
          chunkId: cypherResult.chunkId,
          chunkIdType: typeof cypherResult.chunkId,
          data: cypherResultData
        });
        throw validationError;
      }
      
      await cypherResult.save();
      cypherResultsDocs = [cypherResult];
      chunkCount = 1;
      successfulCypher = 1;
      failedCypher = 0;
      
      logger.info('Cypher generation completed for full document', { docId });
    } else {
      // Generate Cypher for all chunks
      logger.info('Step 5: Generating Cypher for chunks', { docId });
      const cypherResults = await generateCypherForAllChunks(docId);
      successfulCypher = cypherResults.filter(r => r.success).length;
      failedCypher = cypherResults.length - successfulCypher;

      logger.info('Cypher generation completed', { 
        docId, 
        successful: successfulCypher,
        failed: failedCypher
      });

      if (successfulCypher === 0) {
        throw new Error('No Cypher was successfully generated for any chunk');
      }

      // Get all Cypher results
      cypherResultsDocs = await ChunkCypherResult.find({ docId }).sort({ createdAt: 1 });
      fullCypher = cypherResultsDocs.map(r => r.generatedCypher).join('\n\n');
      chunkCount = cypherResultsDocs.length;
      
      // Format Cypher in structured format for chunked mode too
      if (fullCypher && fullSchema) {
        try {
          fullCypher = formatStructuredCypher(fullCypher, fullSchema);
          // Update the results with formatted Cypher
          for (const result of cypherResultsDocs) {
            result.generatedCypher = formatStructuredCypher(result.generatedCypher, fullSchema);
            await result.save();
          }
        } catch (formatError) {
          logger.warn('Failed to format chunked Cypher', { error: formatError.message });
        }
      }
    }
    
    const cypherTime = Date.now() - cypherStartTime;
    await recordMetrics({ 
      stage: 'cypherGeneration', 
      success: fullCypher.length > 0, 
      processingTime: cypherTime, 
      docId 
    });
    
    // Save Cypher to file in codebase folder
    const cypherFilePath = await saveCypherToFile(docId, cypherResultsDocs);
    logger.info('Cypher saved to file', { docId, filePath: cypherFilePath });
    
    // Display generated Cypher (only in interactive mode)
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
    if (isInteractive) {
      console.log('\n========================================================');
      console.log('CYPHER SAVED TO FILE:');
      console.log(`   ${cypherFilePath}`);
      console.log('========================================================\n');
      
      console.log('\n========================================================');
      console.log('GENERATED CYPHER - Review Below');
      console.log('========================================================\n');
      
      // Fix HTML entities before displaying
      let displayCypher = fullCypher;
      displayCypher = displayCypher.replace(/-&gt;/g, '->');
      displayCypher = displayCypher.replace(/-&lt;/g, '<-');
      displayCypher = displayCypher.replace(/&gt;/g, '>');
      displayCypher = displayCypher.replace(/&lt;/g, '<');
      displayCypher = displayCypher.replace(/&amp;gt;/g, '>');
      displayCypher = displayCypher.replace(/&amp;lt;/g, '<');
      
      console.log(displayCypher);
      console.log('\n========================================================\n');
    }
    
    // Ask for confirmation to save to MongoDB (only if running interactively)
    let shouldSaveToMongoDB = true;
    let shouldIngest = true;
    
    if (isInteractive && !process.env.SKIP_CYPHER_CONFIRMATION) {
      // First ask: Do you want to save this Cypher to MongoDB?
      shouldSaveToMongoDB = await askYesNo('Do you like this Cypher? Save to MongoDB?');
      
      if (!shouldSaveToMongoDB) {
        logger.info('User chose to skip saving to MongoDB - deleting MongoDB records', { docId });
        
        // Delete Cypher results from MongoDB since user doesn't want them saved
        await ChunkCypherResult.deleteMany({ docId });
        logger.info('Deleted Cypher results from MongoDB', { docId, count: cypherResultsDocs.length });
        
        if (isInteractive) {
          console.log('\nSkipping MongoDB save. Cypher results deleted from MongoDB.');
          console.log(`   Cypher file saved in: ${cypherFilePath}`);
          console.log('   You can review it and process later.\n');
        }
        
        await doc.updateOne({ 
          status: 'cypher_generated',
          processingCompletedAt: new Date()
        });
        
        return {
          success: true,
          docId,
          chunkCount: chunkCount,
          schema: {
            nodeTypes: Object.keys(schema.nodes).length,
            relationshipTypes: schema.relationships.length
          },
          cypherGeneration: {
            successful: successfulCypher,
            failed: failedCypher,
            filePath: cypherFilePath
          },
          mongodb: {
            skipped: true,
            reason: 'User chose to skip MongoDB save - records deleted',
            deleted: true
          },
          ingestion: {
            skipped: true,
            reason: 'Skipped because MongoDB save was skipped'
          }
        };
      }
      
      if (isInteractive) {
        console.log('\nCypher will be saved to MongoDB.\n');
      }
      
      // Second ask: Do you want to ingest to Neo4j?
      shouldIngest = await askYesNo('Do you want to ingest this Cypher into Neo4j?');
      
      if (!shouldIngest) {
        logger.info('User chose to skip ingestion', { docId });
        if (isInteractive) {
          console.log('\nSkipping ingestion. Cypher saved in MongoDB and file.');
          console.log(`   File: ${cypherFilePath}`);
          console.log('   You can ingest later using the API or by reprocessing.\n');
        }
        
        await doc.updateOne({ 
          status: 'cypher_generated',
          processingCompletedAt: new Date()
        });
        
        return {
          success: true,
          docId,
          chunkCount: chunkCount,
          schema: {
            nodeTypes: Object.keys(schema.nodes).length,
            relationshipTypes: schema.relationships.length
          },
          cypherGeneration: {
            successful: successfulCypher,
            failed: failedCypher,
            filePath: cypherFilePath
          },
          ingestion: {
            skipped: true,
            reason: 'User chose to skip ingestion'
          }
        };
      }
      
      if (isInteractive) {
        console.log('\nProceeding with ingestion...\n');
      }
    }

    // Step 6: Ingest to Neo4j
    logger.info('Step 6: Ingesting to Neo4j', { docId });
    const ingestionStartTime = Date.now();
    const ingestionResults = await ingestAllChunks(docId);
    const ingestionTime = Date.now() - ingestionStartTime;
    await recordMetrics({ 
      stage: 'ingestion', 
      success: ingestionResults.successCount > 0, 
      processingTime: ingestionTime, 
      docId 
    });

    const totalTime = Date.now() - pipelineStartTime;

    logger.info('Pipeline completed successfully', { 
      docId,
      totalNodes: ingestionResults.totalNodes,
      totalRelationships: ingestionResults.totalRelationships,
      successCount: ingestionResults.successCount,
      errorCount: ingestionResults.errorCount,
      totalTimeMs: totalTime
    });

    // Record document completion
    await recordDocumentCompletion(docId, true);

    return {
      success: true,
      docId,
      chunkCount: chunkCount,
      schema: {
        nodeTypes: Object.keys(schema.nodes).length,
        relationshipTypes: schema.relationships.length
      },
      cypherGeneration: {
        successful: successfulCypher,
        failed: failedCypher
      },
      ingestion: ingestionResults
    };

  } catch (error) {
    const totalTime = Date.now() - pipelineStartTime;
    
    await doc.updateOne({
      status: 'error',
      error: error.message
    });
    
    // Record failure metrics
    await recordDocumentCompletion(docId, false);
    
    logger.error('Pipeline failed', { docId, error: error.message, totalTimeMs: totalTime });
    throw error;
  }
}

/**
 * Get pipeline status for a document
 */
export async function getPipelineStatus(docId) {
  const doc = await Document.findById(docId);
  if (!doc) {
    return null;
  }

  const chunks = await DocumentChunk.find({ docId });
  const schema = await Schema.findOne({ docId });
  const cypherResults = await ChunkCypherResult.find({ docId });

  const chunkStatuses = chunks.reduce((acc, chunk) => {
    acc[chunk.status] = (acc[chunk.status] || 0) + 1;
    return acc;
  }, {});

  return {
    document: {
      id: doc._id,
      filename: doc.filename,
      status: doc.status,
      error: doc.error,
      uploadTimestamp: doc.uploadTimestamp,
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt
    },
    chunks: {
      total: chunks.length,
      byStatus: chunkStatuses
    },
    schema: schema ? {
      extracted: true,
      nodeTypes: Object.keys(schema.nodes).length,
      relationshipTypes: schema.relationships.length
    } : {
      extracted: false
    },
    cypher: {
      generated: cypherResults.filter(r => r.status === 'executed').length,
      total: cypherResults.length
    }
  };
}

