/**
 * Show Document Details from Neo4j
 * Works without MongoDB - queries Neo4j directly to show what was created
 */

import dotenv from 'dotenv';
import { getNeo4jSession } from '../config/database.js';
import neo4j from 'neo4j-driver';

dotenv.config();

async function showDocumentDetails() {
  const session = getNeo4jSession(neo4j.session.READ);
  
  try {
    console.log('\n=== Document Details from Neo4j ===\n');
    
    // Count all nodes
    const nodeCountResult = await session.run('MATCH (n) RETURN count(n) as total');
    const totalNodes = nodeCountResult.records[0].get('total').toNumber();
    console.log(`📊 Total Nodes in Database: ${totalNodes}`);
    
    // Count all relationships
    const relCountResult = await session.run('MATCH ()-[r]->() RETURN count(r) as total');
    const totalRels = relCountResult.records[0].get('total').toNumber();
    console.log(`📊 Total Relationships in Database: ${totalRels}\n`);
    
    if (totalNodes === 0) {
      console.log('⚠️  No nodes found in Neo4j');
      console.log('   This could mean:');
      console.log('   - Document processing failed');
      console.log('   - Cypher executed but MERGE matched existing nodes');
      console.log('   - Data was created but then deleted\n');
      return;
    }
    
    // Get all node labels and their counts
    console.log('📋 Node Types Created:');
    const labelResult = await session.run(`
      MATCH (n)
      WITH DISTINCT labels(n) as labels, n
      UNWIND labels as label
      WITH label, count(n) as count
      RETURN label, count
      ORDER BY count DESC
    `);
    
    const nodeTypes = {};
    labelResult.records.forEach(record => {
      const label = record.get('label');
      const count = record.get('count').toNumber();
      nodeTypes[label] = count;
      console.log(`  ✅ ${label}: ${count} nodes`);
    });
    
    // Get all relationship types and their counts
    console.log('\n🔗 Relationship Types Created:');
    const relTypeResult = await session.run(`
      MATCH ()-[r]->()
      RETURN DISTINCT type(r) as type, count(r) as count
      ORDER BY count DESC
    `);
    
    const relTypes = {};
    relTypeResult.records.forEach(record => {
      const type = record.get('type');
      const count = record.get('count').toNumber();
      relTypes[type] = count;
      console.log(`  ✅ ${type}: ${count} relationships`);
    });
    
    // Show sample data for each node type
    console.log('\n📄 Sample Data (first 3 nodes per type):');
    for (const [label, count] of Object.entries(nodeTypes)) {
      console.log(`\n  ${label} (${count} total):`);
      const sampleResult = await session.run(`
        MATCH (n:${label})
        RETURN properties(n) as props
        LIMIT 3
      `);
      
      sampleResult.records.forEach((record, i) => {
        const props = record.get('props');
        const propsStr = JSON.stringify(props, null, 2);
        // Show first 150 chars
        console.log(`    ${i + 1}. ${propsStr.substring(0, 150)}${propsStr.length > 150 ? '...' : ''}`);
      });
    }
    
    // Show relationship examples
    console.log('\n🔗 Relationship Examples:');
    for (const [relType, count] of Object.entries(relTypes)) {
      console.log(`\n  ${relType} (${count} total):`);
      const sampleRelResult = await session.run(`
        MATCH (a)-[r:${relType}]->(b)
        RETURN labels(a)[0] as fromLabel, 
               labels(b)[0] as toLabel,
               properties(a) as fromProps,
               properties(b) as toProps
        LIMIT 2
      `);
      
      sampleRelResult.records.forEach((record, i) => {
        const fromLabel = record.get('fromLabel');
        const toLabel = record.get('toLabel');
        const fromProps = record.get('fromProps');
        const toProps = record.get('toProps');
        
        // Get first property from each node as identifier
        const fromId = Object.values(fromProps)[0] || 'N/A';
        const toId = Object.values(toProps)[0] || 'N/A';
        
        console.log(`    ${i + 1}. ${fromLabel}(${fromId}) --[${relType}]--> ${toLabel}(${toId})`);
      });
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`  Total Node Types: ${Object.keys(nodeTypes).length}`);
    console.log(`  Total Relationship Types: ${Object.keys(relTypes).length}`);
    console.log(`  Total Nodes: ${totalNodes}`);
    console.log(`  Total Relationships: ${totalRels}`);
    
    console.log('\n✅ Document details retrieved successfully!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('label')) {
      console.error('   Note: Node labels with spaces or special chars may need escaping');
    }
    process.exit(1);
  } finally {
    await session.close();
  }
}

showDocumentDetails();

