/**
 * Show Schema Only
 * Displays just the graph schema (node types and relationships) from Neo4j
 * Infers schema from existing data
 */

import dotenv from 'dotenv';
import { getNeo4jSession } from '../config/database.js';
import neo4j from 'neo4j-driver';

dotenv.config();

async function showSchemaOnly() {
  const session = getNeo4jSession(neo4j.session.READ);
  
  try {
    console.log('\n=== Graph Schema from sample BPM.pdf ===\n');
    
    // Get all unique node labels
    const labelResult = await session.run(`
      MATCH (n)
      WITH DISTINCT labels(n) as labels, n
      UNWIND labels as label
      RETURN DISTINCT label
      ORDER BY label ASC
    `);
    
    const nodeLabels = [];
    labelResult.records.forEach(record => {
      nodeLabels.push(record.get('label'));
    });
    
    // Get all unique relationship types
    const relTypeResult = await session.run(`
      MATCH ()-[r]->()
      RETURN DISTINCT type(r) as type
      ORDER BY type ASC
    `);
    
    const relTypes = [];
    relTypeResult.records.forEach(record => {
      relTypes.push(record.get('type'));
    });
    
    // Get relationship patterns (from -> to)
    const relPatternResult = await session.run(`
      MATCH (a)-[r]->(b)
      RETURN DISTINCT labels(a)[0] as fromLabel, 
             type(r) as relType,
             labels(b)[0] as toLabel
      ORDER BY fromLabel, relType, toLabel
    `);
    
    const relationships = [];
    relPatternResult.records.forEach(record => {
      relationships.push({
        from: record.get('fromLabel'),
        type: record.get('relType'),
        to: record.get('toLabel')
      });
    });
    
    // Display Node Types
    console.log('📋 Node Types:');
    nodeLabels.forEach((label, i) => {
      console.log(`  ${i + 1}. ${label}`);
    });
    
    // Display Relationships
    console.log('\n🔗 Relationships:');
    const uniqueRels = new Map();
    relationships.forEach(rel => {
      const key = `${rel.from}--[${rel.type}]-->${rel.to}`;
      if (!uniqueRels.has(key)) {
        uniqueRels.set(key, rel);
      }
    });
    
    let relIndex = 1;
    uniqueRels.forEach(rel => {
      console.log(`  ${relIndex}. ${rel.from} --[${rel.type}]--> ${rel.to}`);
      relIndex++;
    });
    
    // Summary
    console.log('\n📊 Schema Summary:');
    console.log(`  Node Types: ${nodeLabels.length}`);
    console.log(`  Relationship Types: ${relTypes.length}`);
    console.log(`  Unique Relationship Patterns: ${uniqueRels.size}`);
    
    // Display in JSON-like format
    console.log('\n📄 Schema Structure:');
    console.log('{');
    console.log('  "nodes": {');
    nodeLabels.forEach((label, i) => {
      const comma = i < nodeLabels.length - 1 ? ',' : '';
      console.log(`    "${label}": []${comma}`);
    });
    console.log('  },');
    console.log('  "relationships": [');
    relIndex = 1;
    uniqueRels.forEach(rel => {
      const comma = relIndex < uniqueRels.size ? ',' : '';
      console.log(`    {`);
      console.log(`      "from": "${rel.from}",`);
      console.log(`      "type": "${rel.type}",`);
      console.log(`      "to": "${rel.to}"`);
      console.log(`    }${comma}`);
      relIndex++;
    });
    console.log('  ]');
    console.log('}');
    
    console.log('\n✅ Schema retrieved successfully!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await session.close();
  }
}

showSchemaOnly();

