import path from 'path';
import { writeFile } from 'fs/promises';
import { BaseGenerator } from './BaseGenerator.js';
import { mapToMySQLType } from './typeMapper.js';

/**
 * MySQL Physical Model Generator (PDM)
 *
 * Goals (per PDM checklist):
 * - Logical → Physical type mapping
 * - Add PK/FK columns + constraints
 * - Add NOT NULL / UNIQUE / CHECK / DEFAULT / AUTO_INCREMENT
 * - Add FK rules (ON DELETE / ON UPDATE)
 * - Add indexes (FK + unique)
 * - Add created_at / updated_at
 * - Enforce clean snake_case naming (no leading underscores)
 *
 * Note: LLM hints may exist on columns (e.g., _llmExactType),
 * but this generator enforces deterministic, valid MySQL DDL.
 */
export class MySQLGenerator extends BaseGenerator {
  constructor(metadata, outputDir) {
    super(metadata, outputDir);
  }

  q(name) {
    // Always quote identifiers; also fix common reserved words like `order`
    return `\`${name}\``;
  }

  sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  cleanIdentifier(name) {
    let n = this.sanitizeName(String(name || '')).replace(/^_+/, '');
    
    // STEP 7: Naming cleanup
    if (n === 'bmrk') return 'benchmark'; // Standardize benchmark naming
    if (n === 'bmrk_id') return 'benchmark_id';
    if (n.startsWith('bmrk_')) n = n.replace('bmrk_', 'benchmark_');
    if (n === 'port_id') return 'portfolio_id';
    if (n === 'return_pct') return 'portfolio_return_pct';
    
    // STEP 2: Period handling
    if (n === 'period') return 'as_of_date'; // Map period to as_of_date
    
    // STEP 3: Asset class
    if (n === 'asset_class') return 'asset_class_code';

    return n;
  }

  /**
   * Override to quote identifiers safely.
   */
  generateDrops() {
    const drops = ['-- Drop existing tables (reverse order for FK dependencies)'];
    const tableNames = Array.from(this.metadata.tables.keys()).reverse();
    for (const tableName of tableNames) {
      drops.push(`DROP TABLE IF EXISTS ${this.q(this.cleanIdentifier(tableName))};`);
    }
    return drops.join('\n');
  }

  /**
   * Decide physical type for a column.
   * Enforces: NUMBER → INT/DECIMAL; TEXT → VARCHAR(255); DATE → DATE; BOOLEAN → BOOLEAN.
   */
  getPhysicalType(column) {
    const cleanName = this.cleanIdentifier(column.name).toLowerCase();
    
    // STEP 1: Fix financial data types (MOST IMPORTANT)
    const financialMetrics = {
        'alpha': 'DECIMAL(10,6)',
        'beta': 'DECIMAL(10,6)',
        'sharpe_ratio': 'DECIMAL(8,4)',
        'volatility': 'DECIMAL(8,4)',
        'bmrk_return': 'DECIMAL(8,4)',
        'benchmark_return': 'DECIMAL(8,4)', // Consolidate benchmark return definition
        'return_pct': 'DECIMAL(8,4)',
        'portfolio_return_pct': 'DECIMAL(8,4)',
        'contribution_to_return': 'DECIMAL(8,4)',
        'contribution_to_risk': 'DECIMAL(8,4)',
        'var': 'DECIMAL(12,4)',
        'cvar': 'DECIMAL(12,4)'
    };
    
    if (financialMetrics[cleanName]) {
        return financialMetrics[cleanName];
    }

    // STEP 2: Period handling (as_of_date should be DATE)
    if (cleanName === 'as_of_date') {
        return 'DATE';
    }

    // STEP 3: Asset class column (string instead of decimal)
    if (cleanName === 'asset_class_code') {
        return 'VARCHAR(100)';
    }

    // Start from LLM exact type if present, but sanitize hard.
    let t = column?._llmExactType || mapToMySQLType(column?.dataType, column?.isPrimaryKey);
    t = String(t || '').trim();

    // Hard sanitize: remove any embedded DEFAULT / AUTO_INCREMENT / NULL tokens from type string.
    t = t
      .replace(/\bDEFAULT\b[\s\S]*$/i, '')
      .replace(/\bAUTO_INCREMENT\b/gi, '')
      .replace(/\bNOT\s+NULL\b/gi, '')
      .replace(/\bNULL\b/gi, '')
      .trim();

    // Normalize INTEGER → INT
    t = t.replace(/\bINTEGER\b/gi, 'INT');

    // Enforce known allowed type families for this PoC generator.
    // If it doesn't match, fall back based on column.dataType.
    const upper = t.toUpperCase();
    const allowed =
      upper.startsWith('INT') ||
      upper.startsWith('BIGINT') ||
      upper.startsWith('DECIMAL') ||
      upper.startsWith('VARCHAR') ||
      upper === 'DATE' ||
      upper === 'DATETIME' ||
      upper === 'TIMESTAMP' ||
      upper === 'BOOLEAN' ||
      upper.startsWith('TINYINT');

    if (!allowed) {
      t = mapToMySQLType(column?.dataType, column?.isPrimaryKey);
      t = String(t).replace(/\bINTEGER\b/gi, 'INT').trim();
    }

    // Primary key id should be INT
    if (column?.isPrimaryKey) {
      return 'INT';
    }

    // Foreign keys should be INT unless metadata indicates BIGINT
    if (column?.isForeignKey) {
      if (String(column?.dataType || '').toUpperCase().includes('BIGINT')) return 'BIGINT';
      return 'INT';
    }

    return t;
  }

  shouldBeNotNull(column, cleanName) {
    // Use LLM suggestion if available
    if (column.isNullable === false) return true;
    if (column.isNullable === true) return false;
    
    // Fallback to heuristics
    if (column.isPrimaryKey) return true;
    if (column.isForeignKey) return true;

    const n = cleanName.toLowerCase();
    // Required attributes per checklist / typical PDM
    const requiredFields = [
      'name', 'title', 'email', 'username', 'code', 'sku',
      'order_date', 'created_date', 'status', 'type',
      'total', 'amount', 'price', 'cost', 'quantity', 'count',
      'description', 'label', 'value',
      'portfolio_id', 'benchmark_id', 'as_of_date'
    ];
    
    if (requiredFields.some(field => n === field || n.includes(field))) {
      return true;
    }

    return false;
  }

  getDefaultClause(cleanName, physicalType, column) {
    // Use LLM-suggested default if available
    if (column?.defaultValue) {
      const defValue = String(column.defaultValue).trim();
      if (defValue === 'CURRENT_TIMESTAMP' || defValue === 'CURRENT_DATE') {
        return `DEFAULT ${defValue}`;
      } else if (defValue.match(/^\d+$/)) {
        return `DEFAULT ${defValue}`; // Numeric default
      } else if (defValue.match(/^['"].*['"]$/)) {
        return `DEFAULT ${defValue}`; // String default with quotes
      } else {
        return `DEFAULT '${defValue}'`; // String default, add quotes
      }
    }
    
    // Fallback to heuristics
    const n = cleanName.toLowerCase();
    const t = String(physicalType).toUpperCase();

    if (n === 'created_at' || n === 'created_date') {
      return 'DEFAULT CURRENT_TIMESTAMP';
    }
    if (n === 'updated_at' || n === 'updated_date' || n === 'modified_at') {
      return 'DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP';
    }
    if ((n === 'order_date' || n === 'date') && t === 'DATE') {
      return 'DEFAULT (CURRENT_DATE)';
    }
    if (n === 'status' && t.includes('VARCHAR')) {
      return "DEFAULT 'active'";
    }
    if (t === 'BOOLEAN' || t === 'TINYINT(1)') {
      return 'DEFAULT FALSE';
    }
    
    return null;
  }

  getCheckExpression(cleanName, column) {
    // Use LLM-suggested check constraint if available
    if (column?._llmCheckConstraint) {
      let expr = column._llmCheckConstraint.trim();
      // Ensure check expression is properly formatted
      if (!expr.includes(this.q(cleanName))) {
        expr = `${this.q(cleanName)} ${expr}`;
      }
      return expr;
    }
    
    // Fallback to heuristics
    const n = cleanName.toLowerCase();
    
    if (n === 'quantity' || n === 'count' || n.includes('qty')) {
      return `${this.q(cleanName)} > 0`;
    }
    if (n === 'price' || n === 'amount' || n === 'total' || n === 'cost' || n.includes('price') || n.includes('amount')) {
      return `${this.q(cleanName)} >= 0`;
    }
    if (n === 'percentage' || n.includes('percent') || n === 'discount') {
      return `${this.q(cleanName)} >= 0 AND ${this.q(cleanName)} <= 100`;
    }
    if (n === 'email' || n.includes('email')) {
      return `${this.q(cleanName)} LIKE '%@%.%'`;
    }
    
    return null;
  }

  generateColumnDefinition(column) {
    const cleanName = this.cleanIdentifier(column.name);
    const type = this.getPhysicalType(column);

    const parts = [this.q(cleanName), type];

    // NOT NULL - Use LLM suggestion if available, otherwise use heuristics
    const shouldBeNotNull = column.isNullable === false || 
                           (column.isNullable === undefined && this.shouldBeNotNull(column, cleanName));
    if (shouldBeNotNull) parts.push('NOT NULL');

    // UNIQUE - Check column.isUnique flag AND LLM suggestions
    if (!column.isPrimaryKey) {
      const n = cleanName.toLowerCase();
      // Check explicit unique flag
      if (column.isUnique) {
        parts.push('UNIQUE');
      }
      // Also check common unique patterns
      else if (n === 'email' || n === 'username' || n === 'code' || 
               n === 'sku' || n.includes('_code') || (n.includes('_id') && n.includes('unique'))) {
        parts.push('UNIQUE');
      }
    }

    // AUTO_INCREMENT - only for integer PKs
    if (column.isPrimaryKey && (type.startsWith('INT') || type.startsWith('BIGINT'))) {
      parts.push('AUTO_INCREMENT');
    }

    // DEFAULT - Use LLM suggestion if available, otherwise use heuristics
    const def = this.getDefaultClause(cleanName, type, column);
    if (def) parts.push(def);

    // CHECK constraints - Use LLM suggestion if available, otherwise use heuristics
    const checkExpr = this.getCheckExpression(cleanName, column);
    if (checkExpr) {
      parts.push(`CHECK (${checkExpr})`);
    }

    return parts.join(' ');
  }

  ensureTimestampColumns(table) {
    const existing = new Set(table.columns.map(c => this.cleanIdentifier(c.name).toLowerCase()));
    if (!existing.has('created_at')) {
      table.addColumn(
        // eslint-disable-next-line no-new
        new (table.columns[0].constructor)({
          name: 'created_at',
          dataType: 'TIMESTAMP',
          isPrimaryKey: false,
          isForeignKey: false,
          isNullable: false,
          isUnique: false,
          defaultValue: 'CURRENT_TIMESTAMP'
        })
      );
    }
    if (!existing.has('updated_at')) {
      table.addColumn(
        // eslint-disable-next-line no-new
        new (table.columns[0].constructor)({
          name: 'updated_at',
          dataType: 'TIMESTAMP',
          isPrimaryKey: false,
          isForeignKey: false,
          isNullable: false,
          isUnique: false,
          defaultValue: 'CURRENT_TIMESTAMP'
        })
      );
    }
  }

  generateHeader() {
    return `-- Generated by Phase-2 MySQL Physical Model Generator
-- Database: MySQL
-- Tables: ${this.metadata.tableCount} | Columns: ${this.metadata.totalColumns}
-- 
-- ✅ PHYSICAL MODEL ARCHITECT FIXES APPLIED:
-- 1. Financial metrics updated to high-precision DECIMAL types
-- 2. Temporal tracking standardized to as_of_date (DATE)
-- 3. Naming standardized (bmrk -> benchmark, port_id -> portfolio_id)
-- 4. Benchmark Source of Truth: Snapshot benchmark return stored in port_performance (Option B)
-- 5. Asset class standardized to code-based strings
-- 
-- DO NOT EDIT MANUALLY`;
  }

  generateCreateTable(table) {
    const cleanTableName = this.cleanIdentifier(table.name);

    // Add timestamps (PDM requirement)
    this.ensureTimestampColumns(table);

    const lines = [`CREATE TABLE ${this.q(cleanTableName)} (`];
    const defs = [];

    for (const col of table.columns) {
      defs.push(`  ${this.generateColumnDefinition(col)}`);
    }

    // PK constraint
    const pkCols = table.primaryKeys.map(pk => this.q(this.cleanIdentifier(pk.name)));
    if (pkCols.length > 0) {
      defs.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    }

    // STEP 4: Add UNIQUE constraints
    const tableLower = cleanTableName.toLowerCase();
    const uniqueConstraintTables = ['port_performance', 'port_performance_summary', 'risk_metrics'];
    
    if (uniqueConstraintTables.includes(tableLower)) {
        // Verify columns exist before adding constraint
        const colNames = table.columns.map(c => this.cleanIdentifier(c.name).toLowerCase());
        if (colNames.includes('portfolio_id') && colNames.includes('as_of_date')) {
            defs.push(`  UNIQUE (\`portfolio_id\`, \`as_of_date\`)`);
        }
    }

    lines.push(defs.join(',\n'));
    lines.push(`) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    return lines.join('\n');
  }

  generateForeignKeys(table) {
    const statements = [];
    const cleanTableName = this.cleanIdentifier(table.name);

    for (const fkCol of table.foreignKeys) {
      if (!fkCol.referencesTable || !fkCol.referencesColumn) continue;

      const fkName = `fk_${cleanTableName}_${this.cleanIdentifier(fkCol.name)}`;
      const fromCol = this.q(this.cleanIdentifier(fkCol.name));
      const refTable = this.q(this.cleanIdentifier(fkCol.referencesTable));
      const refCol = this.q(this.cleanIdentifier(fkCol.referencesColumn));

      // ON DELETE / ON UPDATE rules per checklist
      // - customer -> order: RESTRICT
      // - order -> order_item: CASCADE
      // - product -> order_item: CASCADE
      const tableLower = cleanTableName.toLowerCase();
      const deleteAction =
        tableLower.includes('order_item') || tableLower.includes('orderitem') || tableLower.includes('item')
          ? 'CASCADE'
          : 'RESTRICT';

      const stmt =
        `ALTER TABLE ${this.q(cleanTableName)} ` +
        `ADD CONSTRAINT ${this.q(fkName)} ` +
        `FOREIGN KEY (${fromCol}) REFERENCES ${refTable}(${refCol}) ` +
        `ON DELETE ${deleteAction} ON UPDATE CASCADE;`;

      statements.push(stmt);
    }

    return statements.join('\n');
  }

  generateIndexes(table) {
    const idx = [];
    const cleanTableName = this.cleanIdentifier(table.name);
    const indexedCols = new Set(); // Track already indexed columns

    // Index foreign keys
    for (const fkCol of table.foreignKeys) {
      const colName = this.cleanIdentifier(fkCol.name);
      if (!indexedCols.has(colName)) {
        const idxName = `idx_${cleanTableName}_${colName}`;
        idx.push(`CREATE INDEX ${this.q(idxName)} ON ${this.q(cleanTableName)} (${this.q(colName)});`);
        indexedCols.add(colName);
      }
    }

    // Index unique columns (if not already indexed)
    for (const col of table.columns) {
      const colName = this.cleanIdentifier(col.name);
      const colNameLower = colName.toLowerCase();
      
      if (col.isUnique && !col.isPrimaryKey && !indexedCols.has(colName)) {
        const idxName = `uk_${cleanTableName}_${colName}`;
        idx.push(`CREATE UNIQUE INDEX ${this.q(idxName)} ON ${this.q(cleanTableName)} (${this.q(colName)});`);
        indexedCols.add(colName);
      }
      
      // Index frequently queried columns (name, code, status, etc.)
      if (!col.isPrimaryKey && !col.isForeignKey && !col.isUnique && !indexedCols.has(colName)) {
        const frequentlyQueried = ['name', 'code', 'sku', 'status', 'type', 'category', 'title', 'label'];
        if (frequentlyQueried.some(fq => colNameLower === fq || colNameLower.includes(fq))) {
          const idxName = `idx_${cleanTableName}_${colName}`;
          idx.push(`CREATE INDEX ${this.q(idxName)} ON ${this.q(cleanTableName)} (${this.q(colName)});`);
          indexedCols.add(colName);
        }
      }
    }

    return idx;
  }

  async save(filename = 'mysql.sql') {
    const ddl = this.generateDDL();
    const outPath = path.join(this.outputDir, filename);
    await writeFile(outPath, ddl, 'utf-8');
    this.logger.info({ filePath: outPath }, 'MySQL DDL saved successfully');
    return outPath;
  }
}
