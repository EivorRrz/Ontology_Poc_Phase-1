/**
 * Check Neo4j Data Script
 * Queries Neo4j directly to see what data was created
 * Doesn't require MongoDB connection
 */

import dotenv from 'dotenv';
import { getNeo4jSession } from '../config/database.js';
import neo4j from 'neo4j-driver';

dotenv.config();

async function checkNeo4jData() {
  const session = getNeo4jSession(neo4j.session.READ);
  
  try {
    console.log('\n=== Neo4j Data Check ===\n');
    
    // Count all nodes
    const nodeCountResult = await session.run('MATCH (n) RETURN count(n) as total');
    const totalNodes = nodeCountResult.records[0].get('total').toNumber();
    console.log(`📊 Total Nodes: ${totalNodes}`);
    
    // Count all relationships
    const relCountResult = await session.run('MATCH ()-[r]->() RETURN count(r) as total');
    const totalRels = relCountResult.records[0].get('total').toNumber();
    console.log(`📊 Total Relationships: ${totalRels}\n`);
    
    if (totalNodes === 0) {
      console.log('⚠️  No nodes found in Neo4j');
      return;
    }
    
    // Get node labels and counts
    console.log('📋 Node Types:');
    const labelResult = await session.run(`
      CALL db.labels() YIELD label
      CALL apoc.cypher.run('MATCH (n:' + label + ') RETURN count(n) as count', {}) YIELD value
      RETURN label, value.count as count
      ORDER BY value.count DESC
    `);
    
    // Fallback if APOC not available
    if (labelResult.records.length === 0) {
      const simpleLabelResult = await session.run(`
        MATCH (n)
        RETURN DISTINCT labels(n)[0] as label, count(n) as count
        ORDER BY count DESC
        LIMIT 20
      `);
      
      simpleLabelResult.records.forEach(record => {
        const label = record.get('label');
        const count = record.get('count').toNumber();
        console.log(`  - ${label}: ${count}`);
      });
    } else {
      labelResult.records.forEach(record => {
        const label = record.get('label');
        const count = record.get('count').toNumber();
        console.log(`  - ${label}: ${count}`);
      });
    }
    
    // Get relationship types and counts
    console.log('\n🔗 Relationship Types:');
    const relTypeResult = await session.run(`
      MATCH ()-[r]->()
      RETURN DISTINCT type(r) as type, count(r) as count
      ORDER BY count DESC
      LIMIT 20
    `);
    
    relTypeResult.records.forEach(record => {
      const type = record.get('type');
      const count = record.get('count').toNumber();
      console.log(`  - ${type}: ${count}`);
    });
    
    // Show sample nodes
    console.log('\n📄 Sample Nodes (first 5):');
    const sampleResult = await session.run(`
      MATCH (n)
      RETURN labels(n)[0] as label, properties(n) as props
      LIMIT 5
    `);
    
    sampleResult.records.forEach((record, i) => {
      const label = record.get('label');
      const props = record.get('props');
      console.log(`  ${i + 1}. ${label}:`, JSON.stringify(props, null, 2).substring(0, 200));
    });
    
    console.log('\n✅ Neo4j data check complete!\n');
    
  } catch (error) {
    console.error('❌ Error checking Neo4j:', error.message);
    process.exit(1);
  } finally {
    await session.close();
  }
}

checkNeo4jData();

