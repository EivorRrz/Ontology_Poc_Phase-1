/**
 * Check Document Status Script
 * Helps debug why documents failed
 * 
 * Usage: node src/scripts/check-document-status.js <filename>
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import DocumentChunk from '../models/DocumentChunk.js';
import Schema from '../models/Schema.js';
import ChunkCypherResult from '../models/ChunkCypherResult.js';

dotenv.config();

async function checkDocumentStatus(filename) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log(`\n=== Checking Document Status: ${filename} ===\n`);
    
    // Try exact match first
    let doc = await Document.findOne({ filename }).sort({ createdAt: -1 });
    
    // If not found, try partial match (contains)
    if (!doc) {
      doc = await Document.findOne({ 
        filename: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } 
      }).sort({ createdAt: -1 });
    }
    
    // If still not found, try case-insensitive partial match
    if (!doc) {
      const searchPattern = filename.split(' ').filter(w => w.length > 0).join('.*');
      doc = await Document.findOne({ 
        filename: { $regex: searchPattern, $options: 'i' } 
      }).sort({ createdAt: -1 });
    }
    
    if (!doc) {
      console.log('❌ Document not found in database');
      console.log(`\n📋 Recent documents (last 10):`);
      
      const recentDocs = await Document.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('filename status createdAt');
      
      if (recentDocs.length === 0) {
        console.log('  No documents found in database');
      } else {
        recentDocs.forEach((d, i) => {
          console.log(`  ${i + 1}. ${d.filename} (${d.status}) - ${d.createdAt.toLocaleString()}`);
        });
        console.log(`\n💡 Tip: Use the exact filename from the list above`);
      }
      
      console.log('\nPossible reasons:');
      console.log('  - File validation failed');
      console.log('  - Document creation failed');
      console.log('  - Check file watcher logs for errors');
      process.exit(1);
    }
    
    // Show if partial match was used
    if (doc.filename !== filename) {
      console.log(`ℹ️  Found document with similar name: "${doc.filename}"\n`);
    }
    
    console.log('✅ Document Found:');
    console.log(`  ID: ${doc._id}`);
    console.log(`  Filename: ${doc.filename}`);
    console.log(`  Size: ${doc.size} bytes`);
    console.log(`  Status: ${doc.status}`);
    console.log(`  Error: ${doc.error || 'None'}`);
    console.log(`  Created: ${doc.createdAt}`);
    console.log(`  Updated: ${doc.updatedAt}`);
    
    if (doc.error) {
      console.log(`\n❌ ERROR: ${doc.error}`);
    }
    
    // Check chunks
    const chunks = await DocumentChunk.find({ docId: doc._id });
    console.log(`\n📄 Chunks: ${chunks.length}`);
    if (chunks.length > 0) {
      chunks.forEach((chunk, i) => {
        console.log(`  Chunk ${i}: ${chunk.status} (${chunk.wordCount} words)`);
        if (chunk.error) {
          console.log(`    Error: ${chunk.error}`);
        }
      });
    }
    
    // Check schema
    const schema = await Schema.findOne({ docId: doc._id });
    if (schema) {
      console.log(`\n📋 Schema Extracted:`);
      console.log(`  Node Types: ${Object.keys(schema.nodes).length}`);
      Object.keys(schema.nodes).forEach(label => {
        console.log(`    - ${label}`);
      });
      console.log(`  Relationships: ${schema.relationships.length}`);
      schema.relationships.forEach(rel => {
        console.log(`    - ${rel.from} --[${rel.type}]--> ${rel.to}`);
      });
    } else {
      console.log(`\n❌ Schema not extracted`);
    }
    
    // Check Cypher results
    const cypherResults = await ChunkCypherResult.find({ docId: doc._id });
    console.log(`\n🔧 Cypher Results: ${cypherResults.length}`);
    if (cypherResults.length > 0) {
      cypherResults.forEach((result, i) => {
        console.log(`  Result ${i}: ${result.status}`);
        console.log(`    Nodes Created: ${result.nodesCreated || 0}`);
        console.log(`    Relationships Created: ${result.relationshipsCreated || 0}`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
      });
    } else {
      console.log(`  ❌ No Cypher generated`);
    }
    
    // Summary
    console.log(`\n📊 Summary:`);
    console.log(`  Document Status: ${doc.status}`);
    console.log(`  Chunks: ${chunks.length}`);
    console.log(`  Schema Extracted: ${schema ? 'Yes' : 'No'}`);
    console.log(`  Cypher Generated: ${cypherResults.length}`);
    console.log(`  Success: ${doc.status === 'completed' ? '✅ Yes' : '❌ No'}`);
    
    if (doc.status !== 'completed') {
      console.log(`\n💡 Troubleshooting:`);
      if (!schema) {
        console.log('  - Schema extraction failed - check Azure OpenAI config (AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT)');
      }
      if (cypherResults.length === 0) {
        console.log('  - Cypher generation failed - check Azure OpenAI config');
      }
      if (doc.error) {
        console.log(`  - Document error: ${doc.error}`);
      }
    }
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Join all arguments after script name (handles filenames with spaces)
const filename = process.argv.slice(2).join(' ');

if (!filename) {
  console.error('Usage: node src/scripts/check-document-status.js <filename>');
  console.error('Example: node src/scripts/check-document-status.js test-simple.txt');
  console.error('Example: node src/scripts/check-document-status.js "sample BPM.docx"');
  process.exit(1);
}

checkDocumentStatus(filename);

