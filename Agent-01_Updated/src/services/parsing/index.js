/**
 * Document Parsing Service
 * Supports PDF, DOCX, TXT via LlamaParse (cloud) or local tools
 */

import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import axios from 'axios';
import FormData from 'form-data';
import { logger } from '../../utils/logger.js';
import Document from '../../models/Document.js';

const LLAMAPARSE_API_KEY = process.env.LLAMAPARSE_API_KEY;
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    logger.error('Failed to create upload directory', { error: error.message });
  }
}

/**
 * Parse document using LlamaParse (cloud)
 */
async function parseWithLlamaParse(filePath, mimetype) {
  if (!LLAMAPARSE_API_KEY) {
    throw new Error('LLAMAPARSE_API_KEY not configured');
  }

  const url = 'https://api.llamaindex.ai/api/parsing/upload';

  const formData = new FormData();
  const fileBuffer = await fs.readFile(filePath);
  formData.append('file', fileBuffer, {
    filename: path.basename(filePath),
    contentType: mimetype
  });

  try {
    logger.info('Calling LlamaParse API', { filename: path.basename(filePath) });
    const response = await axios.post(url, formData, {
      headers: {
        'Authorization': `Bearer ${LLAMAPARSE_API_KEY}`,
        ...formData.getHeaders()
      },
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (response.data && response.data.text) {
      return response.data.text;
    }
    throw new Error('Invalid LlamaParse response format');
  } catch (error) {
    logger.error('LlamaParse API error', { error: error.message });
    throw error;
  }
}

/**
 * Parse PDF using pdf-parse
 */
async function parsePDF(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    logger.error('PDF parsing error', { error: error.message, filePath });
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

/**
 * Parse DOCX using mammoth
 */
async function parseDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    logger.error('DOCX parsing error', { error: error.message, filePath });
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

/**
 * Parse TXT file
 */
async function parseTXT(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return text;
  } catch (error) {
    logger.error('TXT parsing error', { error: error.message, filePath });
    throw new Error(`Failed to parse TXT: ${error.message}`);
  }
}

/**
 * Main parsing function
 * @param {string} docId - MongoDB document ID
 * @param {boolean} useLlamaParse - Whether to use LlamaParse (default: true if API key available)
 * @returns {Promise<string>} - Parsed text
 */
export async function parseDocument(docId, useLlamaParse = !!LLAMAPARSE_API_KEY) {
  const doc = await Document.findById(docId);
  if (!doc) {
    throw new Error(`Document not found: ${docId}`);
  }

  if (doc.status === 'parsed' && doc.fullText) {
    logger.info('Document already parsed', { docId });
    return doc.fullText;
  }

  await doc.updateOne({ status: 'parsing' });

  try {
    await ensureUploadDir();
    const filePath = doc.filePath || path.join(UPLOAD_DIR, doc._id.toString(), doc.filename);

    let text;

    // Try LlamaParse first if available and requested
    if (useLlamaParse && LLAMAPARSE_API_KEY) {
      try {
        text = await parseWithLlamaParse(filePath, doc.mimetype);
        logger.info('Parsed with LlamaParse', { docId, textLength: text.length });
      } catch (error) {
        logger.warn('LlamaParse failed, falling back to local parser', { error: error.message });
        useLlamaParse = false;
      }
    }

    // Fallback to local parsers
    if (!text) {
      const mimetype = doc.mimetype.toLowerCase();

      if (mimetype === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf')) {
        text = await parsePDF(filePath);
      } else if (
        mimetype.includes('wordprocessingml') ||
        mimetype.includes('msword') ||
        doc.filename.toLowerCase().endsWith('.docx') ||
        doc.filename.toLowerCase().endsWith('.doc')
      ) {
        text = await parseDOCX(filePath);
      } else if (mimetype === 'text/plain' || doc.filename.toLowerCase().endsWith('.txt')) {
        text = await parseTXT(filePath);
      } else {
        throw new Error(`Unsupported file type: ${doc.mimetype}`);
      }

      logger.info('Parsed with local parser', { docId, textLength: text.length, mimetype });
    }

    // Clean text (remove excessive whitespace, normalize line breaks)
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Update document
    await doc.updateOne({
      status: 'parsed',
      fullText: text
    });

    logger.info('Document parsed successfully', { docId, textLength: text.length });
    return text;

  } catch (error) {
    await doc.updateOne({
      status: 'error',
      error: error.message
    });
    logger.error('Document parsing failed', { docId, error: error.message });
    throw error;
  }
}

