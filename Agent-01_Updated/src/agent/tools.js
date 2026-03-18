/**
 * Agent tools - document-to-graph pipeline steps
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { parseDocument } from '../pipeline/parseDocument.js';
import { extractSchema } from '../pipeline/extractSchema.js';
import { generateCypher } from '../pipeline/generateCypher.js';
import { ingestToNeo4j } from '../pipeline/ingestToNeo4j.js';
import { getCypherFilePath } from '../utils/saveCypher.js';
import * as storage from '../storage/fileStorage.js';

export function createPipelineTools() {
  const parse_document = tool(
    async ({ docId }) => {
      try {
        const text = await parseDocument(docId, false);
        return JSON.stringify({ success: true, textLength: text?.length || 0, message: 'Document parsed successfully' });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'parse_document',
      description: 'Parse a document (PDF, DOCX, TXT) and extract plain text. Call this first for a new document.',
      schema: z.object({ docId: z.string().describe('The document ID') }),
    }
  );

  const extract_schema = tool(
    async ({ docId }) => {
      try {
        const schema = await extractSchema(docId);
        const nodeCount = Object.keys(schema?.nodes || {}).length;
        const relCount = (schema?.relationships || []).length;
        return JSON.stringify({ success: true, nodeTypes: nodeCount, relationships: relCount, message: 'Schema extracted' });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'extract_schema',
      description: 'Extract graph schema (nodes, relationships) from parsed document text. Call after parse_document.',
      schema: z.object({ docId: z.string().describe('The document ID') }),
    }
  );

  const generate_cypher = tool(
    async ({ docId }) => {
      try {
        const cypher = await generateCypher(docId);
        const cypherFilePath = getCypherFilePath(docId);
        return JSON.stringify({
          success: true,
          message: 'Cypher saved',
          cypherFilePath,
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'generate_cypher',
      description: 'Generate Neo4j Cypher MERGE statements from document and schema. Call after extract_schema.',
      schema: z.object({ docId: z.string().describe('The document ID') }),
    }
  );

  const ingest_to_neo4j = tool(
    async ({ docId }) => {
      try {
        const result = await ingestToNeo4j(docId);
        return JSON.stringify({
          success: true,
          nodesCreated: result.nodesCreated,
          relationshipsCreated: result.relationshipsCreated,
          message: 'Ingested to Neo4j successfully',
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'ingest_to_neo4j',
      description: 'Execute generated Cypher and ingest to Neo4j graph database. Call after generate_cypher.',
      schema: z.object({ docId: z.string().describe('The document ID') }),
    }
  );

  const get_status = tool(
    async ({ docId }) => {
      try {
        const doc = await storage.getDocument(docId);
        if (!doc) return JSON.stringify({ success: false, error: 'Document not found' });
        const schema = await storage.getSchema(docId);
        const { readCypherFromFile } = await import('../utils/saveCypher.js');
        const cypher = await readCypherFromFile(docId);
        return JSON.stringify({
          success: true,
          status: doc.status,
          filename: doc.filename,
          schemaExtracted: schema && Object.keys(schema.nodes || {}).length > 0,
          cypherGenerated: !!cypher?.trim(),
          cypherFilePath: cypher ? getCypherFilePath(docId) : null,
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    },
    {
      name: 'get_status',
      description: 'Get the current status of a document in the pipeline.',
      schema: z.object({ docId: z.string().describe('The document ID') }),
    }
  );

  return [parse_document, extract_schema, generate_cypher, ingest_to_neo4j, get_status];
}
