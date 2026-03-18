/**
 * Document routes - file storage version (no MongoDB)
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import * as storage from '../storage/fileStorage.js';
import { runPipeline, getPipelineStatus } from '../pipeline/orchestrator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

const storageConfig = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(UPLOAD_DIR, 'temp');
    await fs.mkdir(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storageConfig,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain'];
    if (allowed.includes(file.mimetype) || /\.(pdf|docx|doc|txt)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, DOC, TXT allowed.'));
    }
  },
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const doc = await storage.createDocument({
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      filePath: req.file.path,
    });

    logger.info('Document uploaded', { docId: doc.docId, filename: doc.filename });
    res.status(201).json({
      id: doc.docId,
      filename: doc.filename,
      size: doc.size,
      status: doc.status,
      uploadTimestamp: doc.uploadTimestamp,
    });
  } catch (error) {
    logger.error('Document upload failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/process', async (req, res) => {
  try {
    const docId = req.params.id;
    const useAgent = req.body.useAgent === true;

    if (useAgent) {
      const { runDocumentAgent } = await import('../agent/documentAgent.js');
      runDocumentAgent(`Process document ${docId} and convert to Neo4j graph.`, docId)
        .then(({ answer }) => logger.info('Agent completed', { docId, answer: answer?.substring(0, 100) }))
        .catch(err => logger.error('Agent failed', { docId, error: err.message }));
      return res.status(202).json({ message: 'Agent started', docId });
    }

    runPipeline(docId, {
      useLlamaParse: req.body.useLlamaParse === true,
      createNeo4jConstraints: req.body.createNeo4jConstraints !== false,
    })
      .then(result => logger.info('Pipeline completed', { docId, result }))
      .catch(err => logger.error('Pipeline failed', { docId, error: err.message }));

    res.status(202).json({ message: 'Pipeline started', docId });
  } catch (error) {
    logger.error('Failed to start pipeline', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const status = await getPipelineStatus(req.params.id);
    if (!status) return res.status(404).json({ error: 'Document not found' });
    res.json(status);
  } catch (error) {
    logger.error('Failed to get status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const { documents, total } = await storage.listDocuments(limit, skip);
    res.json({ documents, total, limit, skip });
  } catch (error) {
    logger.error('Failed to list documents', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await storage.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({
      id: doc.docId,
      filename: doc.filename,
      mimetype: doc.mimetype,
      size: doc.size,
      status: doc.status,
      error: doc.error,
      uploadTimestamp: doc.uploadTimestamp,
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt,
    });
  } catch (error) {
    logger.error('Failed to get document', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
