/**
 * Test Neo4j Connection Script
 * Helps debug Neo4j Aura connection issues
 */

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD;

console.log('=== Neo4j Connection Test ===');
console.log('URI:', uri);
console.log('User:', user);
console.log('Password:', password ? 'SET (' + password.length + ' chars)' : 'NOT SET');
console.log('URI starts with neo4j+s://', uri.startsWith('neo4j+s://'));
console.log('URI starts with neo4j+ssc://', uri.startsWith('neo4j+ssc://'));
console.log('URI starts with bolt://', uri.startsWith('bolt://'));
console.log('');

if (!password) {
  console.error('ERROR: NEO4J_PASSWORD not set!');
  process.exit(1);
}

// Try with self-signed certificate support
let actualUri = uri;
if (uri.startsWith('neo4j+s://')) {
  console.log('Trying neo4j+ssc:// (self-signed cert) as alternative...');
  actualUri = uri.replace('neo4j+s://', 'neo4j+ssc://');
}

const driver = neo4j.driver(actualUri, neo4j.auth.basic(user, password), {
  maxConnectionLifetime: 3 * 60 * 60 * 1000,
  maxConnectionPoolSize: 50,
  connectionAcquisitionTimeout: 2 * 60 * 1000
});

console.log('Attempting to connect with URI:', actualUri);
console.log('');

driver.verifyConnectivity()
  .then(() => {
    console.log('✅ SUCCESS: Neo4j connected!');
    
    // Try a simple query
    const session = driver.session();
    return session.run('RETURN 1 as test')
      .then(result => {
        console.log('✅ Query test successful:', result.records[0].get('test'));
        session.close();
        driver.close();
        process.exit(0);
      });
  })
  .catch((error) => {
    console.error('❌ FAILED: Neo4j connection error');
    console.error('Error:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('1. Check URI format - should be neo4j+s:// or neo4j+ssc:// for Aura');
    console.error('2. Verify URI from Aura console matches exactly');
    console.error('3. Check username and password are correct');
    console.error('4. Ensure no port number (:7687) in URI for Aura');
    console.error('5. Try neo4j+ssc:// instead of neo4j+s:// if SSL issues');
    
    driver.close();
    process.exit(1);
  });

