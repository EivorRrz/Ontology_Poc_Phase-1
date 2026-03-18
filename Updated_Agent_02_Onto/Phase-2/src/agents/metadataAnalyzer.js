/**
 * Metadata Analyzer
 * Extracts lineage, impact, and graph insights directly from metadata.json
 * This allows the Q&A agent to answer questions about the model structure
 */

/**
 * Extract lineage information from metadata
 * Lineage = where each column/table came from (source tracking)
 */
export function extractLineage(metadata) {
    const tables = metadata.metadata?.tables || {};
    const lineage = {
        tables: {},
        columns: {}
    };
    
    for (const [tableName, tableData] of Object.entries(tables)) {
        const columns = tableData.columns || [];
        
        lineage.tables[tableName] = {
            name: tableName,
            source: tableData.filePath || metadata.filePath || "Unknown",
            originalName: metadata.originalName || "Unknown",
            uploadedAt: metadata.uploadedAt || "Unknown",
            description: tableData.entityDescription || tableData.description || "",
            domain: tableData.domain || "Unknown",
            subDomain: tableData.subDomain || "Unknown"
        };
        
        for (const col of columns) {
            const colKey = `${tableName}.${col.columnName}`;
            lineage.columns[colKey] = {
                table: tableName,
                column: col.columnName,
                source: col._sourceRow ? `Row ${col._sourceRow} in source file` : "Unknown",
                dataType: col.dataType || "Unknown",
                description: col.description || col.attributeDescription || "",
                isPrimaryKey: col.isPrimaryKey || false,
                isForeignKey: col.isForeignKey || false,
                references: col.isForeignKey ? `${col.referencesTable}.${col.referencesColumn}` : null
            };
        }
    }
    
    return lineage;
}

/**
 * Extract impact analysis from metadata
 * Impact = which tables depend on which (PK/FK relationships, cascade effects)
 */
export function extractImpact(metadata) {
    const tables = metadata.metadata?.tables || {};
    const impact = {
        dependencies: {},
        dependents: {},
        cascadeEffects: []
    };
    
    // Build dependency graph
    for (const [tableName, tableData] of Object.entries(tables)) {
        const columns = tableData.columns || [];
        const dependencies = new Set();
        const dependents = new Set();
        
        // Find what this table depends on (via FKs)
        for (const col of columns) {
            if (col.isForeignKey && col.referencesTable) {
                dependencies.add(col.referencesTable);
            }
        }
        
        // Find what depends on this table (other tables with FKs pointing here)
        for (const [otherTableName, otherTableData] of Object.entries(tables)) {
            if (otherTableName === tableName) continue;
            
            const otherColumns = otherTableData.columns || [];
            for (const col of otherColumns) {
                if (col.isForeignKey && col.referencesTable === tableName) {
                    dependents.add(otherTableName);
                }
            }
        }
        
        if (dependencies.size > 0) {
            impact.dependencies[tableName] = Array.from(dependencies);
        }
        
        if (dependents.size > 0) {
            impact.dependents[tableName] = Array.from(dependents);
            
            // Calculate cascade effects
            for (const dependent of dependents) {
                impact.cascadeEffects.push({
                    source: tableName,
                    target: dependent,
                    relationship: `${dependent} depends on ${tableName}`,
                    impact: `Dropping ${tableName} would affect ${dependent}`
                });
            }
        }
    }
    
    return impact;
}

/**
 * Extract graph insights from metadata
 * Graph insights = schema health, risks, statistics
 */
export function extractGraphInsights(metadata) {
    const tables = metadata.metadata?.tables || {};
    const tablesArray = Object.values(tables);
    
    let pkCount = 0;
    let fkCount = 0;
    let totalColumns = 0;
    const tablesWithoutPK = [];
    const tablesWithoutFK = [];
    const orphanTables = [];
    
    for (const [tableName, tableData] of Object.entries(tables)) {
        const columns = tableData.columns || [];
        totalColumns += columns.length;
        
        const hasPK = columns.some(col => col.isPrimaryKey);
        const hasFK = columns.some(col => col.isForeignKey);
        
        if (hasPK) pkCount++;
        else tablesWithoutPK.push(tableName);
        
        if (hasFK) {
            fkCount++;
        } else {
            tablesWithoutFK.push(tableName);
        }
        
        // Check if table is orphaned (no FKs pointing to it and no FKs pointing out)
        const hasIncomingFK = tablesArray.some(t => 
            t.columns?.some(col => col.isForeignKey && col.referencesTable === tableName)
        );
        const hasOutgoingFK = columns.some(col => col.isForeignKey);
        
        if (!hasIncomingFK && !hasOutgoingFK && tableName !== tablesArray[0]?.tableName) {
            orphanTables.push(tableName);
        }
        
        // Count PKs and FKs
        pkCount += columns.filter(col => col.isPrimaryKey).length;
        fkCount += columns.filter(col => col.isForeignKey).length;
    }
    
    const pkCoverage = tablesArray.length > 0 ? (pkCount / tablesArray.length) * 100 : 0;
    const fkCoverage = tablesArray.length > 0 ? (fkCount / tablesArray.length) * 100 : 0;
    
    return {
        schemaHealth: {
            totalTables: tablesArray.length,
            totalColumns: totalColumns,
            pkCoverage: Math.round(pkCoverage),
            fkCoverage: Math.round(fkCoverage),
            averageColumnsPerTable: Math.round(totalColumns / tablesArray.length) || 0
        },
        risks: {
            tablesWithoutPK: tablesWithoutPK.length,
            tablesWithoutFK: tablesWithoutFK.length,
            orphanTables: orphanTables.length,
            missingPKs: tablesWithoutPK,
            missingFKs: tablesWithoutFK,
            orphaned: orphanTables
        },
        statistics: {
            primaryKeys: pkCount,
            foreignKeys: fkCount,
            relationships: fkCount,
            domains: new Set(tablesArray.map(t => t.domain).filter(Boolean)).size,
            subDomains: new Set(tablesArray.map(t => t.subDomain).filter(Boolean)).size
        }
    };
}

/**
 * Build complete model context from metadata
 */
export function buildModelContext(metadata) {
    return {
        lineage: extractLineage(metadata),
        impact: extractImpact(metadata),
        insights: extractGraphInsights(metadata),
        metadata: metadata
    };
}
