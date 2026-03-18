/**
 * Agent route - run document-to-graph agent
 */

import express from 'express';
import { runDocumentAgent } from '../agent/documentAgent.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { message, docId } = req.body;
    const input = message || 'Process the document and convert to Neo4j graph.';
    const { answer } = await runDocumentAgent(input, docId);
    res.json({ answer, docId });
  } catch (error) {
    logger.error('Agent failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
