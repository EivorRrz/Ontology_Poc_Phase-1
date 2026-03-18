/**
 * Query routes - file storage version
 */

import express from 'express';
import { callLLM, extractCypher } from '../utils/llm.js';
import { getNeo4jSession } from '../config/database.js';
import neo4j from 'neo4j-driver';
import * as storage from '../storage/fileStorage.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

function buildQueryPrompt(schema, question) {
  const nodeTypes = Object.entries(schema.nodes || {})
    .map(([label, props]) => `  - ${label}: [${(props || []).join(', ')}]`).join('\n');
  const relationships = (schema.relationships || [])
    .map(rel => `  - ${rel.from} --[${rel.type}]--> ${rel.to}`).join('\n');

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
3. Output ONLY valid Cypher code - no markdown, no explanations

Generate Cypher query:`;
}

router.post('/', async (req, res) => {
  try {
    const { question, docId } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    if (!docId) return res.status(400).json({ error: 'docId is required' });

    const schemaData = await storage.getSchema(docId);
    if (!schemaData?.nodes) return res.status(404).json({ error: 'Schema not found for document' });

    const schema = { nodes: schemaData.nodes, relationships: schemaData.relationships || [] };
    const prompt = buildQueryPrompt(schema, question);
    const systemPrompt = 'Output only valid READ-ONLY Cypher code, no explanations or markdown.';

    const response = await callLLM(prompt, systemPrompt, { temperature: 0.1 });
    const cypher = extractCypher(response);
    if (!cypher?.trim()) return res.status(500).json({ error: 'Failed to generate valid Cypher' });

    const session = getNeo4jSession(neo4j.session.READ);
    try {
      const result = await session.run(cypher);
      const records = result.records.map(record => {
        const obj = {};
        record.keys.forEach(key => {
          const value = record.get(key);
          if (neo4j.isInt(value)) obj[key] = value.toNumber();
          else if (neo4j.isNode(value)) obj[key] = { id: value.identity.toNumber(), labels: value.labels, properties: value.properties };
          else if (neo4j.isRelationship(value)) obj[key] = { id: value.identity.toNumber(), type: value.type, properties: value.properties };
          else obj[key] = value;
        });
        return obj;
      });
      res.json({ question, cypher, results: records, count: records.length });
    } catch (err) {
      logger.error('Cypher execution error', { error: err.message, cypher });
      res.status(500).json({ error: 'Failed to execute Cypher', cypher, details: err.message });
    } finally {
      await session.close();
    }
  } catch (error) {
    logger.error('Query failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
