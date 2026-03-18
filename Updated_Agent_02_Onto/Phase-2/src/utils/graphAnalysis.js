import path from 'path';
import { existsSync } from 'fs';
import config from '../config.js';
import logger from './logger.js';
import { readJSON, writeFile } from './fileUtils.js';

/**
 * Build a dependency graph from Metadata (tables + columns + FKs)
 */
function buildDependencyGraph(metadata) {
  const tables = Array.from(metadata.tables.values());

  const graph = {
    tables: {}, // tableName -> { dependencies: Set, dependents: Set, columns: [...] }
    foreignKeys: [] // { fromTable, fromColumn, toTable, toColumn }
  };

  for (const table of tables) {
    const tName = table.name;
    if (!graph.tables[tName]) {
      graph.tables[tName] = {
        name: tName,
        dependencies: new Set(),
        dependents: new Set(),
        columns: table.columns.map(col => ({
          name: col.name,
          isPrimaryKey: !!col.isPrimaryKey,
          isForeignKey: !!col.isForeignKey,
          referencesTable: col.referencesTable || null,
          referencesColumn: col.referencesColumn || null,
          dataType: col.dataType || null
        }))
      };
    }

    for (const col of table.columns) {
      if (col.isForeignKey && col.referencesTable && col.referencesColumn) {
        const fromTable = tName;
        const toTable = col.referencesTable;

        graph.foreignKeys.push({
          fromTable,
          fromColumn: col.name,
          toTable,
          toColumn: col.referencesColumn
        });

        if (!graph.tables[toTable]) {
          graph.tables[toTable] = {
            name: toTable,
            dependencies: new Set(),
            dependents: new Set(),
            columns: []
          };
        }

        graph.tables[fromTable].dependencies.add(toTable);
        graph.tables[toTable].dependents.add(fromTable);
      }
    }
  }

  // Convert Sets to arrays
  for (const t of Object.values(graph.tables)) {
    t.dependencies = Array.from(t.dependencies);
    t.dependents = Array.from(t.dependents);
  }

  return graph;
}

/**
 * Generate physical data lineage JSON.
 * For now we map each physical column back to the Phase-1 metadata table/column,
 * and mark system-generated columns like created_at / updated_at.
 */
async function generateLineage(metadata) {
  const fileId = metadata.fileId;

  // Load raw Phase-1 metadata to get original table/column info
  const baseDir = config.phase1ArtifactsDir;
  const jsonDir = path.join(baseDir, fileId, 'json');
  const newMetaPath = path.join(jsonDir, 'metadata.json');
  const oldMetaPath = path.join(baseDir, fileId, 'metadata.json');
  const metaPath = existsSync(newMetaPath) ? newMetaPath : oldMetaPath;

  let raw = null;
  if (existsSync(metaPath)) {
    raw = await readJSON(metaPath);
  } else {
    logger.warn({ fileId }, 'Raw metadata.json not found for lineage; marking all as system-origin');
  }

  const rawTables = raw?.metadata?.tables || {};

  const lineage = {
    fileId,
    sourceFile: raw?.originalName || null,
    tables: {}
  };

  for (const table of metadata.tables.values()) {
    const tName = table.name;
    const rawTable =
      rawTables[tName] ||
      rawTables[Object.keys(rawTables).find(k => k.toLowerCase() === tName.toLowerCase())] ||
      null;

    const tEntry = {
      physicalName: tName,
      sourceTable: rawTable?.tableName || tName,
      columns: {}
    };

    for (const col of table.columns) {
      const cName = col.name;
      const lower = cName.toLowerCase();
      const isSystemGenerated = lower === 'created_at' || lower === 'updated_at';

      let rawCol = null;
      if (rawTable && rawTable.columns) {
        rawCol =
          rawTable.columns.find(rc => rc.columnName === cName) ||
          rawTable.columns.find(rc => rc.columnName.toLowerCase() === lower) ||
          null;
      }

      tEntry.columns[cName] = {
        physicalName: cName,
        physicalType: col.dataType || null,
        origin: isSystemGenerated ? 'system_generated' : rawCol ? 'source_metadata' : 'unknown',
        source: rawCol
          ? {
              table: rawTable.tableName,
              column: rawCol.columnName,
              dataType: rawCol.dataType || null,
              sourceRow: rawCol._sourceRow || null
            }
          : null,
        notes: isSystemGenerated
          ? 'Added by generator for audit / timestamps'
          : rawCol
          ? 'Column originated from source metadata'
          : 'Source information not found'
      };
    }

    lineage.tables[tName] = tEntry;
  }

  return lineage;
}

/**
 * Generate impact analysis JSON from the dependency graph.
 */
function generateImpact(graph) {
  const impact = {
    tables: {},
    foreignKeys: graph.foreignKeys
  };

  for (const [tName, tInfo] of Object.entries(graph.tables)) {
    impact.tables[tName] = {
      dependencies: tInfo.dependencies, // tables this table depends on
      dependents: tInfo.dependents, // tables that depend on this one
      canSafelyDrop:
        tInfo.dependents.length === 0 && tInfo.dependencies.length === 0 ? true : false
    };
  }

  return impact;
}

/**
 * Generate rule-based graph insights for the physical model.
 * This is deterministic and does NOT use LLM.
 */
function generateInsights(metadata, graph) {
  const issues = [];
  const perTable = {};

  for (const table of metadata.tables.values()) {
    const tName = table.name;
    const cols = table.columns;
    const colNames = cols.map(c => c.name.toLowerCase());

    const hasPk = table.primaryKeys.length === 1;
    const hasCreatedAt = colNames.includes('created_at');
    const hasUpdatedAt = colNames.includes('updated_at');

    const tableIssues = [];

    if (!hasPk) {
      tableIssues.push('Table has no primary key or multiple primary keys.');
      issues.push({ table: tName, type: 'pk', message: 'Missing or invalid primary key.' });
    }

    if (!hasCreatedAt || !hasUpdatedAt) {
      tableIssues.push('Audit fields created_at / updated_at are missing.');
      issues.push({
        table: tName,
        type: 'audit',
        message: 'Audit timestamps (created_at/updated_at) are missing.'
      });
    }

    // Money / numeric rules
    for (const col of cols) {
      const n = col.name.toLowerCase();
      const t = String(col.dataType || '').toUpperCase();

      // Monetary values should be DECIMAL and have >= 0 check
      if (['price', 'amount', 'total', 'cost'].includes(n)) {
        if (!t.startsWith('DECIMAL')) {
          tableIssues.push(`Column ${col.name} should use DECIMAL for monetary values.`);
          issues.push({
            table: tName,
            column: col.name,
            type: 'type',
            message: 'Monetary column should use DECIMAL, not other numeric types.'
          });
        }
      }

      if (n === 'quantity') {
        // quantity should be INT and > 0
        if (!t.startsWith('INT')) {
          tableIssues.push(`Column ${col.name} should use INT for quantity.`);
          issues.push({
            table: tName,
            column: col.name,
            type: 'type',
            message: 'Quantity column should use INT.'
          });
        }
      }
    }

    perTable[tName] = {
      hasPrimaryKey: hasPk,
      hasCreatedAt,
      hasUpdatedAt,
      fkCount: graph.foreignKeys.filter(fk => fk.fromTable === tName).length,
      incomingFkCount: graph.foreignKeys.filter(fk => fk.toTable === tName).length,
      issues: tableIssues
    };
  }

  const summary = {
    tableCount: metadata.tableCount,
    columnCount: metadata.totalColumns,
    foreignKeyCount: graph.foreignKeys.length,
    issueCount: issues.length
  };

  return { summary, perTable, issues };
}

/**
 * Entry point used by generate-complete.js
 * Writes three JSON artifacts into the physical folder:
 *  - physical_lineage.json
 *  - physical_impact.json
 *  - physical_graph_insights.json
 */
export async function generatePhysicalGraphArtifacts(metadata, paths) {
  const results = { files: [], errors: [] };

  try {
    const graph = buildDependencyGraph(metadata);
    const lineage = await generateLineage(metadata);
    const impact = generateImpact(graph);
    const insights = generateInsights(metadata, graph);

    const lineagePath = path.join(paths.physical, 'physical_lineage.json');
    const impactPath = path.join(paths.physical, 'physical_impact.json');
    const insightsPath = path.join(paths.physical, 'physical_graph_insights.json');

    await writeFile(lineagePath, JSON.stringify(lineage, null, 2));
    await writeFile(impactPath, JSON.stringify(impact, null, 2));
    await writeFile(insightsPath, JSON.stringify(insights, null, 2));

    results.files.push(
      { name: 'physical_lineage.json', type: 'Physical Lineage JSON', size: Buffer.byteLength(JSON.stringify(lineage)) },
      { name: 'physical_impact.json', type: 'Physical Impact JSON', size: Buffer.byteLength(JSON.stringify(impact)) },
      {
        name: 'physical_graph_insights.json',
        type: 'Physical Graph Insights JSON',
        size: Buffer.byteLength(JSON.stringify(insights))
      }
    );
  } catch (err) {
    logger.warn({ error: err.message }, 'Failed to generate physical graph artifacts');
    results.errors.push({ step: 'graph_analysis', error: err.message });
  }

  return results;
}


