/**
 * Show Document Schema
 * Gets the exact schema extracted for a specific document from MongoDB
 * 
 * Usage: node src/scripts/show-document-schema.js <filename>
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import Schema from '../models/Schema.js';

dotenv.config();

async function showDocumentSchema(filename) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log(`\n=== Schema for: ${filename} ===\n`);
    
    // Find document by filename (try exact match, then partial)
    let doc = await Document.findOne({ filename }).sort({ createdAt: -1 });
    
    if (!doc) {
      // Try partial match
      doc = await Document.findOne({ 
        filename: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } 
      }).sort({ createdAt: -1 });
    }
    
    if (!doc) {
      console.log('❌ Document not found');
      console.log('\n📋 Recent documents:');
      const recentDocs = await Document.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('filename status createdAt');
      
      recentDocs.forEach((d, i) => {
        console.log(`  ${i + 1}. ${d.filename} (${d.status})`);
      });
      
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log(`✅ Document Found: ${doc.filename}`);
    console.log(`   ID: ${doc._id}`);
    console.log(`   Status: ${doc.status}\n`);
    
    // Get schema for this document
    const schema = await Schema.findOne({ docId: doc._id });
    
    if (!schema) {
      console.log('❌ No schema found for this document');
      console.log('   Schema extraction may have failed');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    // Display Node Types
    console.log('📋 Node Types:');
    const nodeEntries = Object.entries(schema.nodes);
    nodeEntries.forEach(([label, props], i) => {
      const propsList = Array.isArray(props) ? props.join(', ') : '[]';
      console.log(`  ${i + 1}. ${label}`);
      if (props && props.length > 0) {
        console.log(`     Properties: [${propsList}]`);
      }
    });
    
    // Display Relationships
    console.log('\n🔗 Relationships:');
    schema.relationships.forEach((rel, i) => {
      console.log(`  ${i + 1}. ${rel.from} --[${rel.type}]--> ${rel.to}`);
    });
    
    // Summary
    console.log('\n📊 Schema Summary:');
    console.log(`  Node Types: ${nodeEntries.length}`);
    console.log(`  Relationship Types: ${schema.relationships.length}`);
    
    // Display in JSON format
    console.log('\n📄 Schema Structure (JSON):');
    console.log(JSON.stringify({
      nodes: schema.nodes,
      relationships: schema.relationships
    }, null, 2));
    
    console.log('\n✅ Schema retrieved successfully!\n');
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('MongoDB')) {
      console.error('\n💡 MongoDB Connection Issue:');
      console.error('   1. Check your IP is whitelisted in MongoDB Atlas');
      console.error('   2. Or use: node src/scripts/show-schema-only.js (shows all data in Neo4j)');
    }
    process.exit(1);
  }
}

const filename = process.argv.slice(2).join(' ');
if (!filename) {
  console.error('Usage: node src/scripts/show-document-schema.js <filename>');
  console.error('Example: node src/scripts/show-document-schema.js "sample BPM.pdf"');
  process.exit(1);
}

showDocumentSchema(filename);

