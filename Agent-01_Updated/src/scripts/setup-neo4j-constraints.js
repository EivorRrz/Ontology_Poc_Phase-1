/**
 * Setup Neo4j Constraints Script
 * Creates common uniqueness constraints for graph nodes
 * Run this once after Neo4j is set up
 */

import dotenv from 'dotenv';
import { connectMongoDB, getNeo4jSession } from '../config/database.js';
import neo4j from 'neo4j-driver';
import { logger } from '../utils/logger.js';
import Schema from '../models/Schema.js';

dotenv.config();

async function setupConstraints() {
  try {
    // Connect to MongoDB to get schemas
    await connectMongoDB();
    
    // Get Neo4j driver
    getNeo4jDriver();
    
    logger.info('Setting up Neo4j constraints...');

    // Get all schemas from MongoDB
    const schemas = await Schema.find();
    
    if (schemas.length === 0) {
      logger.warn('No schemas found in MongoDB. Creating basic constraints...');
      
      // Create some basic constraints for common patterns
      const session = getNeo4jSession(neo4j.session.WRITE);
      try {
        const basicConstraints = [
          'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
          'CREATE CONSTRAINT company_id IF NOT EXISTS FOR (c:Company) REQUIRE c.id IS UNIQUE',
          'CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE',
          'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
          'CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE'
        ];

        for (const constraint of basicConstraints) {
          try {
            await session.run(constraint);
            logger.info('Created basic constraint', { constraint });
          } catch (error) {
            // Ignore if constraint already exists or label doesn't exist
            logger.debug('Constraint creation skipped', { constraint, error: error.message });
          }
        }
      } finally {
        await session.close();
      }
    } else {
      // Create constraints based on extracted schemas
      const session = getNeo4jSession(neo4j.session.WRITE);
      
      try {
        const allNodeTypes = new Set();
        const allIdProperties = new Map();

        // Collect all node types and their ID properties
        for (const schemaDoc of schemas) {
          for (const [label, props] of Object.entries(schemaDoc.nodes)) {
            allNodeTypes.add(label);
            
            // Find ID properties
            const idProps = props.filter(p => 
              /^(id|_id|Id|ID|uuid|UUID)$/.test(p) || 
              p.toLowerCase().includes('id') ||
              p.toLowerCase().includes('key')
            );
            
            if (idProps.length > 0 && !allIdProperties.has(label)) {
              allIdProperties.set(label, idProps[0]);
            }
          }
        }

        logger.info('Found node types', { count: allNodeTypes.size });

        // Create constraints
        for (const [label, idProp] of allIdProperties.entries()) {
          const constraintName = `${label.toLowerCase()}_${idProp}_unique`.replace(/[^a-z0-9_]/g, '_');
          
          try {
            const cypher = `
              CREATE CONSTRAINT ${constraintName} IF NOT EXISTS
              FOR (n:${label})
              REQUIRE n.${idProp} IS UNIQUE
            `;
            
            await session.run(cypher);
            logger.info('Created constraint', { label, property: idProp });
          } catch (error) {
            logger.warn('Failed to create constraint', { 
              label, 
              property: idProp, 
              error: error.message 
            });
          }
        }

        logger.info('Constraint setup completed', { 
          constraintsCreated: allIdProperties.size 
        });
      } finally {
        await session.close();
      }
    }

    logger.info('Neo4j constraint setup completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Constraint setup failed', { error: error.message });
    process.exit(1);
  }
}

setupConstraints();

