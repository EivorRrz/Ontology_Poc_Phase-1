/**
 * File Watcher Script
 * Monitors a folder and automatically processes files when dropped
 * Uses file storage (no MongoDB) + agentic pipeline
 *
 * Usage: node src/scripts/file-watcher.js
 *
 * Env:
 *   WATCH_FOLDER     - Folder to watch (default: ./watch)
 *   WATCH_USE_AGENT  - Use agentic AI mode (default: true)
 */

import dotenv from 'dotenv';
dotenv.config();

if (process.env.DISABLE_SSL_VERIFICATION === 'true' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';
import { ensureDataDir, createDocument } from '../storage/fileStorage.js';
import { getNeo4jDriver } from '../config/database.js';
import { runPipeline } from '../pipeline/orchestrator.js';
import { runDocumentAgent } from '../agent/documentAgent.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WATCH_FOLDER = process.env.WATCH_FOLDER || path.join(process.cwd(), 'watch');
const PROCESSED_FOLDER = path.join(WATCH_FOLDER, 'processed');
const ERROR_FOLDER = path.join(WATCH_FOLDER, 'error');
const USE_AGENT = process.env.WATCH_USE_AGENT !== 'false';

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'];
const MAX_FILE_SIZE = 100 * 1024 * 1024;

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function isValidFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      logger.warn('File too large', { filePath, size: stats.size });
      return false;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      logger.warn('Invalid file type', { filePath, ext });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Error checking file', { filePath, error: error.message });
    return false;
  }
}

async function moveFile(filePath, success) {
  try {
    const filename = path.basename(filePath);
    const destFolder = success ? PROCESSED_FOLDER : ERROR_FOLDER;
    const destPath = path.join(destFolder, filename);
    await fs.mkdir(destFolder, { recursive: true });
    await fs.rename(filePath, destPath);
    logger.info('File moved', { from: filePath, to: destPath, success });
    return destPath;
  } catch (error) {
    logger.error('Error moving file', { filePath, error: error.message });
    return null;
  }
}

async function processFile(filePath) {
  const filename = path.basename(filePath);
  logger.info('Processing file', { filePath, filename });

  try {
    if (!(await isValidFile(filePath))) {
      await moveFile(filePath, false);
      return;
    }

    const stats = await fs.stat(filePath);
    const mimetype = getMimeType(filename);

    const doc = await createDocument({
      filename,
      mimetype,
      size: stats.size,
      filePath,
    });

    const docId = doc.docId || doc._id;
    logger.info('Document created', { docId, filename });

    // Move file immediately after copy - pipeline uses data/documents/{docId}/original.ext
    await moveFile(filePath, true);

    if (USE_AGENT) {
      logger.info('Running agentic pipeline', { docId });
      const { answer } = await runDocumentAgent(
        `Process document ${docId} and convert to Neo4j graph. Run all steps: parse, extract schema, generate Cypher, ingest.`,
        docId
      );
      logger.info('Agent completed', { docId, answer: answer?.substring(0, 150) });
    } else {
      logger.info('Running pipeline', { docId });
      await runPipeline(docId, {
        useLlamaParse: false,
        createNeo4jConstraints: true,
      });
    }
  } catch (error) {
    logger.error('Error processing file', { filePath, error: error.message, stack: error.stack });
    // Move from processed to error if we already moved it; else move from watch
    const processedPath = path.join(PROCESSED_FOLDER, path.basename(filePath));
    try {
      await fs.access(processedPath);
      await moveFile(processedPath, false);
    } catch {
      await moveFile(filePath, false);
    }
  }
}

async function initializeFolders() {
  await fs.mkdir(WATCH_FOLDER, { recursive: true });
  await fs.mkdir(PROCESSED_FOLDER, { recursive: true });
  await fs.mkdir(ERROR_FOLDER, { recursive: true });
  logger.info('Folders initialized', { watch: WATCH_FOLDER, processed: PROCESSED_FOLDER, error: ERROR_FOLDER });
}

async function processExistingFiles() {
  try {
    const entries = await fs.readdir(WATCH_FOLDER, { withFileTypes: true });
    const filePaths = entries
      .filter(e => e.isFile() && !e.name.startsWith('.') && e.name !== '.gitkeep')
      .map(e => path.join(WATCH_FOLDER, e.name));

    logger.info('Found existing files', { count: filePaths.length });

    for (const filePath of filePaths) {
      await processFile(filePath);
    }
  } catch (error) {
    logger.error('Error processing existing files', { error: error.message });
  }
}

async function startWatcher() {
  try {
    await ensureDataDir();
    getNeo4jDriver();
    await initializeFolders();

    logger.info('File watcher started', { watchFolder: WATCH_FOLDER, agentMode: USE_AGENT });

    console.log('\n========================================');
    console.log('📁 File Watcher Active (Agentic AI)');
    console.log('========================================');
    console.log(`Watch Folder: ${WATCH_FOLDER}`);
    console.log(`Processed: ${PROCESSED_FOLDER}`);
    console.log(`Error: ${ERROR_FOLDER}`);
    console.log(`Mode: ${USE_AGENT ? 'Agentic AI' : 'Pipeline'}`);
    console.log('\nDrop PDF/DOCX/TXT files into the watch folder!');
    console.log('Press Ctrl+C to stop\n');

    await processExistingFiles();

    const watcher = chokidar.watch(WATCH_FOLDER, {
      ignored: [/processed/, /error/, /(^|[\/\\])\../],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    watcher
      .on('add', async (filePath) => {
        try {
          const fileDir = path.dirname(filePath);
          const normalizedFileDir = path.normalize(fileDir);
          const normalizedWatchFolder = path.normalize(WATCH_FOLDER);

          if (normalizedFileDir !== normalizedWatchFolder) return;

          const filename = path.basename(filePath);
          if (filename.startsWith('.')) return;

          logger.info('New file detected', { filePath, filename });
          await processFile(filePath);
        } catch (error) {
          logger.error('Error processing detected file', { filePath, error: error.message });
        }
      })
      .on('error', (error) => {
        logger.error('Watcher error', { error: error.message });
      });

    process.on('SIGINT', async () => {
      logger.info('Stopping file watcher...');
      await watcher.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Stopping file watcher...');
      await watcher.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start file watcher', { error: error.message });
    process.exit(1);
  }
}

startWatcher();
