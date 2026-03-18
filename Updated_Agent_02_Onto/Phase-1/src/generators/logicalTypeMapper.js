/**
 * Logical Data Type Mapper
 * Converts physical SQL types to logical generic types
 * Logical models use: TEXT, NUMBER, DATE (not VARCHAR, INTEGER, DECIMAL)
 */

const LOGICAL_TYPE_MAP = {
    // Text types → TEXT
    'VARCHAR': 'TEXT',
    'CHAR': 'TEXT',
    'TEXT': 'TEXT',
    'STRING': 'TEXT',
    'NVARCHAR': 'TEXT',
    'NCHAR': 'TEXT',
    
    // Numeric types → NUMBER
    'INTEGER': 'NUMBER',
    'INT': 'NUMBER',
    'BIGINT': 'NUMBER',
    'SMALLINT': 'NUMBER',
    'TINYINT': 'NUMBER',
    'DECIMAL': 'NUMBER',
    'NUMERIC': 'NUMBER',
    'FLOAT': 'NUMBER',
    'DOUBLE': 'NUMBER',
    'REAL': 'NUMBER',
    'DOUBLE PRECISION': 'NUMBER',
    
    // Date/Time types → DATE or TIMESTAMP
    'DATE': 'DATE',
    'TIME': 'DATE',
    'TIMESTAMP': 'DATE',
    'DATETIME': 'DATE',
    
    // Boolean → BOOLEAN (keep as is)
    'BOOLEAN': 'BOOLEAN',
    'BOOL': 'BOOLEAN',
    
    // Other types (keep as is or map appropriately)
    'UUID': 'TEXT',
    'JSON': 'TEXT',
    'JSONB': 'TEXT',
    'BLOB': 'TEXT',
    'CLOB': 'TEXT'
};

/**
 * Convert physical SQL type to logical type
 * @param {string} physicalType - Physical SQL type (e.g., VARCHAR, INTEGER)
 * @returns {string} Logical type (e.g., TEXT, NUMBER, DATE)
 */
export function mapToLogicalType(physicalType) {
    if (!physicalType) return 'TEXT';
    
    const normalized = String(physicalType).toUpperCase().trim();
    
    // Remove precision/scale if present (e.g., VARCHAR(255) → VARCHAR)
    const baseType = normalized.split('(')[0].trim();
    
    return LOGICAL_TYPE_MAP[baseType] || 'TEXT';
}

/**
 * Generate business rule description for a column
 * @param {Object} column - Column metadata
 * @returns {string} Business rule description
 */
export function generateBusinessRule(column) {
    const rules = [];
    
    // Unique constraint
    if (column.isUnique || column.isPrimaryKey) {
        rules.push('must be unique');
    }
    
    // Not null constraint
    if (column.nullable === false) {
        rules.push('required');
    }
    
    // Foreign key relationship
    if (column.isForeignKey && column.referencesTable) {
        rules.push(`references ${column.referencesTable}`);
    }
    
    // Primary key
    if (column.isPrimaryKey) {
        rules.push('primary identifier');
    }
    
    // Data type specific rules
    const logicalType = mapToLogicalType(column.dataType);
    if (logicalType === 'NUMBER') {
        if (column.columnName.toLowerCase().includes('price') || 
            column.columnName.toLowerCase().includes('amount') ||
            column.columnName.toLowerCase().includes('total')) {
            rules.push('must be >= 0');
        }
        if (column.columnName.toLowerCase().includes('quantity') ||
            column.columnName.toLowerCase().includes('count')) {
            rules.push('must be > 0');
        }
    }
    
    // Email validation
    if (column.columnName.toLowerCase().includes('email')) {
        rules.push('valid email format required');
    }
    
    return rules.length > 0 ? rules.join(', ') : null;
}

/**
 * Generate enhanced attribute description
 * Combines existing description with business rules
 * @param {Object} column - Column metadata
 * @returns {string} Enhanced description
 */
export function generateEnhancedDescription(column) {
    const parts = [];
    
    // Original description
    if (column.description) {
        parts.push(column.description);
    }
    
    // Business rules
    const businessRule = generateBusinessRule(column);
    if (businessRule) {
        parts.push(`Business rule: ${businessRule}`);
    }
    
    return parts.length > 0 ? parts.join('. ') : null;
}

