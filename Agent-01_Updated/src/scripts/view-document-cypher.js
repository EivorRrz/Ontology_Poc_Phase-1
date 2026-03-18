/**
 * View Document Cypher
 * Shows the generated Cypher for a specific document
 * 
 * Usage: node src/scripts/view-document-cypher.js <filename>
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import ChunkCypherResult from '../models/ChunkCypherResult.js';

dotenv.config();

async function viewDocumentCypher(filename) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log(`\n=== Cypher for: ${filename} ===\n`);
    
    // Find document
    let doc = await Document.findOne({ filename }).sort({ createdAt: -1 });
    
    if (!doc) {
      // Try partial match
      doc = await Document.findOne({ 
        filename: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } 
      }).sort({ createdAt: -1 });
    }
    
    if (!doc) {
      console.log('❌ Document not found');
      const recentDocs = await Document.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('filename status createdAt');
      
      if (recentDocs.length > 0) {
        console.log('\n📋 Recent documents:');
        recentDocs.forEach((d, i) => {
          console.log(`  ${i + 1}. ${d.filename} (${d.status})`);
        });
      }
      
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log(`✅ Document Found: ${doc.filename}`);
    console.log(`   ID: ${doc._id}`);
    console.log(`   Status: ${doc.status}\n`);
    
    // Get Cypher results
    const cypherResults = await ChunkCypherResult.find({ docId: doc._id })
      .sort({ createdAt: 1 });
    
    if (cypherResults.length === 0) {
      console.log('❌ No Cypher generated for this document');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📋 GENERATED CYPHER:\n');
    
    cypherResults.forEach((result, i) => {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`\nChunk ${i + 1} (Status: ${result.status})`);
      console.log(`Model: ${result.generationModel || 'N/A'} (${result.generationProvider || 'N/A'})`);
      if (result.error) {
        console.log(`Error: ${result.error}`);
      }
      console.log(`\nCypher:`);
      console.log(result.generatedCypher);
      console.log('');
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📊 Summary:');
    console.log(`  Total Chunks: ${cypherResults.length}`);
    console.log(`  Successful: ${cypherResults.filter(r => r.status === 'executed' || r.status === 'generated').length}`);
    console.log(`  Errors: ${cypherResults.filter(r => r.status === 'error').length}`);
    console.log('');
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('MongoDB') || error.message.includes('whitelist')) {
      console.error('\n💡 MongoDB Connection Issue:');
      console.error('   1. Fix IP whitelist in MongoDB Atlas');
      console.error('   2. Or use: node src/scripts/show-schema-only.js (shows Neo4j data)');
    }
    process.exit(1);
  }
}

const filename = process.argv.slice(2).join(' ');
if (!filename) {
  console.error('Usage: node src/scripts/view-document-cypher.js <filename>');
  console.error('Example: node src/scripts/view-document-cypher.js "sample BPM.pdf"');
  process.exit(1);
}

viewDocumentCypher(filename);

