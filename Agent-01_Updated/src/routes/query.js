/**
 * Query routes
 * Natural language to Cypher query endpoint
 */

import express from 'express';
import { callLLM, extractCypher } from '../utils/llm.js';
import { getNeo4jSession } from '../config/database.js';
import neo4j from 'neo4j-driver';
import { logger } from '../utils/logger.js';
import Schema from '../models/Schema.js';

const router = express.Router();

/**
 * Build query prompt for read-only Cypher
 */
function buildQueryPrompt(schema, question) {
  const nodeTypes = Object.entries(schema.nodes)
    .map(([label, props]) => `  - ${label}: [${props.join(', ')}]`)
    .join('\n');

  const relationships = schema.relationships
    .map(rel => `  - ${rel.from} --[${rel.type}]--> ${rel.to}`)
    .join('\n');

  return `You are a Cypher query generation model. Given a graph schema and a natural language question, generate a READ-ONLY Cypher query.

Graph Schema:
Node Types:
${nodeTypes}

Relationships:
${relationships}

Question: ${question}

Instructions:
1. Generate a READ-ONLY Cypher query (MATCH, WHERE, RETURN only - NO CREATE, MERGE, SET, DELETE)
2. Use the node labels and properties from the schema above
3. Use the relationship types from the schema above
4. Output ONLY valid Cypher code - no markdown, no explanations
5. Make the query efficient and return meaningful results

Generate Cypher query:`;
}

/**
 * POST /query
 * Query Neo4j with natural language
 */
router.post('/', async (req, res) => {
  try {
    const { question, docId } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Get schema (either from docId or use a default/global schema)
    let schema;
    if (docId) {
      const schemaDoc = await Schema.findOne({ docId });
      if (!schemaDoc) {
        return res.status(404).json({ error: 'Schema not found for document' });
      }
      schema = {
        nodes: schemaDoc.nodes,
        relationships: schemaDoc.relationships
      };
    } else {
      // For now, return error if no docId - could be extended to use a global schema
      return res.status(400).json({ error: 'docId is required to get schema' });
    }

    logger.info('Generating query Cypher', { question, docId });

    const prompt = buildQueryPrompt(schema, question);
    const systemPrompt = 'You are a Cypher query generation model. Output only valid READ-ONLY Cypher code, no explanations or markdown.';

    const response = await callLLM(prompt, systemPrompt, { temperature: 0.1 });

    const cypher = extractCypher(response);

    if (!cypher || cypher.trim().length === 0) {
      return res.status(500).json({ error: 'Failed to generate valid Cypher' });
    }

    logger.info('Generated Cypher query', { cypher, question });

    // Execute query
    const session = getNeo4jSession(neo4j.session.READ);
    try {
      const result = await session.run(cypher);
      
      // Convert Neo4j records to JSON
      const records = result.records.map(record => {
        const obj = {};
        record.keys.forEach(key => {
          const value = record.get(key);
          // Convert Neo4j types to JSON-serializable
          if (neo4j.isInt(value)) {
            obj[key] = value.toNumber();
          } else if (neo4j.isNode(value)) {
            obj[key] = {
              id: value.identity.toNumber(),
              labels: value.labels,
              properties: value.properties
            };
          } else if (neo4j.isRelationship(value)) {
            obj[key] = {
              id: value.identity.toNumber(),
              type: value.type,
              start: value.start.toNumber(),
              end: value.end.toNumber(),
              properties: value.properties
            };
          } else {
            obj[key] = value;
          }
        });
        return obj;
      });

      res.json({
        question,
        cypher,
        results: records,
        count: records.length
      });
    } catch (error) {
      logger.error('Cypher execution error', { error: error.message, cypher });
      res.status(500).json({ 
        error: 'Failed to execute Cypher query',
        cypher,
        details: error.message
      });
    } finally {
      await session.close();
    }

  } catch (error) {
    logger.error('Query failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;

