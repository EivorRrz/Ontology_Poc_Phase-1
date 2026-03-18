/**
 * Parse document - file storage version
 */

import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import axios from 'axios';
import FormData from 'form-data';
import * as storage from '../storage/fileStorage.js';
import { logger } from '../utils/logger.js';

const LLAMAPARSE_API_KEY = process.env.LLAMAPARSE_API_KEY;

async function parseWithLlamaParse(filePath, mimetype) {
  if (!LLAMAPARSE_API_KEY) throw new Error('LLAMAPARSE_API_KEY not configured');
  const formData = new FormData();
  const fileBuffer = await fs.readFile(filePath);
  formData.append('file', fileBuffer, { filename: path.basename(filePath), contentType: mimetype });
  const response = await axios.post('https://api.llamaindex.ai/api/parsing/upload', formData, {
    headers: { Authorization: `Bearer ${LLAMAPARSE_API_KEY}`, ...formData.getHeaders() },
    timeout: 300000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  if (response.data?.text) return response.data.text;
  throw new Error('Invalid LlamaParse response');
}

async function parsePDF(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

async function parseDOCX(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function parseTXT(filePath) {
  return fs.readFile(filePath, 'utf-8');
}

export async function parseDocument(docId, useLlamaParse = false) {
  const doc = await storage.getDocument(docId);
  if (!doc) throw new Error(`Document not found: ${docId}`);

  let text = await storage.getFullText(docId);
  if (text) {
    logger.info('Document already parsed', { docId });
    return text;
  }

  await storage.updateDocument(docId, { status: 'parsing' });
  const filePath = doc.filePath;

  try {
    if (useLlamaParse && LLAMAPARSE_API_KEY) {
      try {
        text = await parseWithLlamaParse(filePath, doc.mimetype);
      } catch (e) {
        logger.warn('LlamaParse failed, using local', { error: e.message });
        useLlamaParse = false;
      }
    }
    if (!text) {
      const m = (doc.mimetype || '').toLowerCase();
      const fn = (doc.filename || '').toLowerCase();
      if (m.includes('pdf') || fn.endsWith('.pdf')) text = await parsePDF(filePath);
      else if (m.includes('word') || fn.endsWith('.docx') || fn.endsWith('.doc')) text = await parseDOCX(filePath);
      else if (m.includes('text') || fn.endsWith('.txt')) text = await parseTXT(filePath);
      else throw new Error(`Unsupported type: ${doc.mimetype}`);
    }

    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

    await storage.saveFullText(docId, text);
    await storage.updateDocument(docId, { status: 'parsed' });

    logger.info('Document parsed', { docId, textLength: text.length });
    return text;
  } catch (error) {
    await storage.updateDocument(docId, { status: 'error', error: error.message });
    throw error;
  }
}
