/**
 * Document routes
 * Handles document upload, processing, and status
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import Document from '../models/Document.js';
import { runPipeline, getPipelineStatus } from '../services/orchestrator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(UPLOAD_DIR, 'temp');
    await fs.mkdir(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype) || 
        /\.(pdf|docx|doc|txt)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, DOC, and TXT are allowed.'));
    }
  }
});

/**
 * POST /documents
 * Upload a document
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const doc = new Document({
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      filePath: req.file.path,
      status: 'uploaded'
    });

    await doc.save();

    logger.info('Document uploaded', { 
      docId: doc._id, 
      filename: doc.filename,
      size: doc.size 
    });

    res.status(201).json({
      id: doc._id,
      filename: doc.filename,
      size: doc.size,
      status: doc.status,
      uploadTimestamp: doc.uploadTimestamp
    });
  } catch (error) {
    logger.error('Document upload failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /documents/:id/process
 * Run the full pipeline on a document
 */
router.post('/:id/process', async (req, res) => {
  try {
    const docId = req.params.id;
    const options = {
      useLlamaParse: req.body.useLlamaParse !== false,
      createNeo4jConstraints: req.body.createNeo4jConstraints !== false
    };

    // Run pipeline asynchronously
    runPipeline(docId, options)
      .then(result => {
        logger.info('Pipeline completed', { docId, result });
      })
      .catch(error => {
        logger.error('Pipeline failed', { docId, error: error.message });
      });

    res.status(202).json({
      message: 'Pipeline started',
      docId
    });
  } catch (error) {
    logger.error('Failed to start pipeline', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /documents/:id/status
 * Get processing status for a document
 */
router.get('/:id/status', async (req, res) => {
  try {
    const docId = req.params.id;
    const status = await getPipelineStatus(docId);

    if (!status) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(status);
  } catch (error) {
    logger.error('Failed to get status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /documents
 * List all documents
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const documents = await Document.find()
      .sort({ uploadTimestamp: -1 })
      .limit(limit)
      .skip(skip)
      .select('filename mimetype size status uploadTimestamp processingCompletedAt');

    const total = await Document.countDocuments();

    res.json({
      documents,
      total,
      limit,
      skip
    });
  } catch (error) {
    logger.error('Failed to list documents', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /documents/:id
 * Get document details
 */
router.get('/:id', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({
      id: doc._id,
      filename: doc.filename,
      mimetype: doc.mimetype,
      size: doc.size,
      status: doc.status,
      error: doc.error,
      uploadTimestamp: doc.uploadTimestamp,
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt,
      totalChunks: doc.totalChunks,
      processedChunks: doc.processedChunks
    });
  } catch (error) {
    logger.error('Failed to get document', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;

