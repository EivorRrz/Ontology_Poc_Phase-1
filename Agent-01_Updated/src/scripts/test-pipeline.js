/**
 * Test Pipeline Script
 * End-to-end test of the document-to-graph pipeline
 * 
 * Usage:
 *   node src/scripts/test-pipeline.js <path-to-document>
 * 
 * Example:
 *   node src/scripts/test-pipeline.js ./test-docs/sample.pdf
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectMongoDB, getNeo4jDriver } from '../config/database.js';
import Document from '../models/Document.js';
import { runPipeline, getPipelineStatus } from '../services/orchestrator.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function testPipeline(documentPath) {
  try {
    logger.info('Starting pipeline test', { documentPath });

    // Check if file exists
    try {
      await fs.access(documentPath);
    } catch (error) {
      throw new Error(`File not found: ${documentPath}`);
    }

    // Connect to databases
    await connectMongoDB();
    getNeo4jDriver();

    // Get file info
    const stats = await fs.stat(documentPath);
    const filename = path.basename(documentPath);
    const mimetype = getMimeType(filename);

    logger.info('File info', { filename, size: stats.size, mimetype });

    // Create document record
    const doc = new Document({
      filename,
      mimetype,
      size: stats.size,
      filePath: documentPath,
      status: 'uploaded'
    });
    await doc.save();

    logger.info('Document created', { docId: doc._id });

    // Run pipeline
    logger.info('Running pipeline...');
    const startTime = Date.now();
    
    const result = await runPipeline(doc._id.toString(), {
      useLlamaParse: false,
      createNeo4jConstraints: true
    });

    const duration = Date.now() - startTime;

    logger.info('Pipeline completed', {
      docId: doc._id,
      duration: `${(duration / 1000).toFixed(2)}s`,
      result
    });

    // Get final status
    const status = await getPipelineStatus(doc._id.toString());
    logger.info('Final status', { status });

    // Print summary
    console.log('\n=== Pipeline Test Summary ===');
    console.log(`Document: ${filename}`);
    console.log(`Document ID: ${doc._id}`);
    console.log(`Status: ${status.document.status}`);
    console.log(`Chunks: ${status.chunks.total}`);
    console.log(`Schema - Node Types: ${status.schema.nodeTypes}, Relationships: ${status.schema.relationshipTypes}`);
    console.log(`Cypher Generated: ${status.cypher.generated}/${status.cypher.total}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log('\n=== Success! ===\n');

    process.exit(0);
  } catch (error) {
    logger.error('Pipeline test failed', { error: error.message, stack: error.stack });
    console.error('\n=== Pipeline Test Failed ===');
    console.error(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Get document path from command line
const documentPath = process.argv[2];

if (!documentPath) {
  console.error('Usage: node src/scripts/test-pipeline.js <path-to-document>');
  console.error('Example: node src/scripts/test-pipeline.js ./test-docs/sample.pdf');
  process.exit(1);
}

testPipeline(documentPath);

