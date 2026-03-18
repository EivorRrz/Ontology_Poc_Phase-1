/**
 * Express server - File storage + Agentic AI (no MongoDB)
 */

import express from 'express';
import dotenv from 'dotenv';
import { getNeo4jDriver } from './config/database.js';
import { ensureDataDir } from './storage/fileStorage.js';
import { logger } from './utils/logger.js';
import documentsRouter from './routes/documentsFile.js';
import queryRouter from './routes/queryFile.js';
import agentRouter from './routes/agent.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), storage: 'file' });
});

app.use('/documents', documentsRouter);
app.use('/query', queryRouter);
app.use('/agent', agentRouter);

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

async function start() {
  try {
    await ensureDataDir();
    logger.info('File storage initialized');

    getNeo4jDriver();

    app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`, {
        env: process.env.NODE_ENV || 'development',
        storage: 'file',
        neo4j: process.env.NEO4J_URI ? 'connected' : 'not configured',
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => { logger.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { logger.info('SIGINT received'); process.exit(0); });

start();
