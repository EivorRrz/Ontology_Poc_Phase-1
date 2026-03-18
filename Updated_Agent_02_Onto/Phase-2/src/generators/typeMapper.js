const MYSQL_TYPE_MAP = {
    /**
     * The variations of the mapping here..!
     * Physical model requires EXACT SQL types with precision
     */
    'INTEGER': 'INT',
    'INT': 'INT',
    'BIGINT': 'BIGINT',
    'SMALLINT': 'SMALLINT',
    'TINYINT': 'TINYINT',
    'VARCHAR': 'VARCHAR(255)',
    'TEXT': 'TEXT',
    'CHAR': 'CHAR(1)',
    'BOOLEAN': 'BOOLEAN',
    'BOOL': 'BOOLEAN',
    'DATE': 'DATE',
    'TIME': 'TIME',
    'TIMESTAMP': 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'DATETIME': 'DATETIME',
    'DECIMAL': 'DECIMAL(10,2)',
    'NUMERIC': 'DECIMAL(10,2)',
    'FLOAT': 'FLOAT',
    'DOUBLE': 'DOUBLE',
    'JSON': 'JSON',
    'UUID': 'CHAR(36)',
    'REAL': 'DOUBLE'
};

/**
 * Map generic type to MySQL type with precision
 * Physical model MUST specify exact SQL types with precision
 * @param {string} genericType - Generic type from metadata
 * @param {boolean} isPrimaryKey - Whether this is a primary key
 * @returns {string} MySQL type with precision
 */
export function mapToMySQLType(genericType, isPrimaryKey = false) {
    if (!genericType) return 'VARCHAR(255)';
    
    const normalized = String(genericType).toUpperCase().trim();
    
    // If it already has precision (e.g. DECIMAL(10,6)), return it as is (but normalize INTEGER -> INT)
    if (normalized.includes('(')) {
        return normalized.replace(/\bINTEGER\b/gi, 'INT');
    }

    const baseType = normalized.split('(')[0].trim();
    
    let mysqlType = MYSQL_TYPE_MAP[baseType] || 'VARCHAR(255)';
    
    // Note: AUTO_INCREMENT is added separately in generateColumnDefinition
    // Don't include it in the type string here
    
    return mysqlType;
}