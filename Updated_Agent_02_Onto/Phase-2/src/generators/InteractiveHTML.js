/**
 * Interactive HTML ERD Generator with Drill-Down Navigation
 * Creates drill-down viewer: Domains → Sub-domains → Entities → Attributes
 * Supports both Logical Model (TEXT, NUMBER, DATE, BOOLEAN) and Physical Model (VARCHAR, INT, etc.)
 * Shows all properties: PK, FK, nullable, unique, default, check, auto-increment, descriptions
 */

import path from 'path';
import { writeFile, readJSON } from '../utils/fileUtils.js';
import logger from '../utils/logger.js';
import config from '../config.js';
import { mapToLogicalType } from '../../../Phase-1/src/generators/logicalTypeMapper.js';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class InteractiveHTMLGenerator {
    constructor(metadata, outputDir) {
        this.metadata = metadata;
        this.outputDir = outputDir;
    }

    /**
     * Load template from templates directory and inject data
     * Universal template loading - works for every generation
     */
    loadTemplate(templateType, physicalData, hierarchical, relationships, logicalData = null) {
        const templatePath = path.join(__dirname, '..', 'templates', templateType, 'template.html');
        
        if (!fs.existsSync(templatePath)) {
            logger.warn({ templatePath }, 'Template file not found, using built-in');
            return null;
        }
        
        try {
            let template = fs.readFileSync(templatePath, 'utf8');
            
            // Prepare JSON strings
            const physicalDataJSON = JSON.stringify(physicalData);
            const hierarchicalJSON = JSON.stringify(hierarchical);
            const relationshipsJSON = JSON.stringify(relationships);
            
            if (templateType === 'logical' && logicalData) {
                const logicalDataJSON = JSON.stringify(logicalData);
                // Replace placeholders
                template = template.replace('{{LOGICAL_DATA}}', logicalDataJSON);
                template = template.replace('{{HIERARCHICAL_DATA}}', hierarchicalJSON);
                template = template.replace('{{RELATIONSHIPS_DATA}}', relationshipsJSON);
            } else {
                // Physical model
                template = template.replace('{{PHYSICAL_DATA}}', physicalDataJSON);
                template = template.replace('{{HIERARCHICAL_DATA}}', hierarchicalJSON);
                template = template.replace('{{RELATIONSHIPS_DATA}}', relationshipsJSON);
            }
            
            return template;
        } catch (error) {
            logger.warn({ error: error.message, templatePath }, 'Failed to load template, using built-in');
            return null;
        }
    }

    /**
     * Load template file and inject data dynamically
     * Reads template from reference artifacts and injects current data (DEPRECATED - use loadTemplate instead)
     * Uses line-by-line replacement for large JSON data
     */
    loadTemplateFromReference(templatePath, physicalData, hierarchical, relationships, isLogical = false) {
        try {
            // Read the template file
            let template = fs.readFileSync(templatePath, 'utf8');
            
            // Prepare JSON strings
            const physicalDataJSON = JSON.stringify(physicalData);
            const hierarchicalJSON = JSON.stringify(hierarchical);
            const relationshipsJSON = JSON.stringify(relationships);
            
            if (isLogical) {
                // For logical model, prepare logical data from hierarchical
                const logicalData = this.prepareLogicalData(hierarchical);
                const logicalDataJSON = JSON.stringify(logicalData);
                
                // Replace logicalData - find the line starting with "const logicalData ="
                // and replace everything until the next "const" statement
                const lines = template.split('\n');
                let inLogicalData = false;
                let inHierarchical = false;
                let inRelationships = false;
                const newLines = [];
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    if (line.trim().startsWith('const logicalData = prepareLogicalData')) {
                        // Replace with actual logicalData
                        newLines.push(`        const logicalData = ${logicalDataJSON};`);
                        inLogicalData = true;
                        // Skip until we find the next const statement
                        continue;
                    }
                    
                    if (inLogicalData && line.trim().startsWith('const hierarchical =')) {
                        inLogicalData = false;
                        inHierarchical = true;
                        newLines.push(`        const hierarchical = ${hierarchicalJSON};`);
                        continue;
                    }
                    
                    if (inHierarchical && line.trim().startsWith('const relationships =')) {
                        inHierarchical = false;
                        inRelationships = true;
                        newLines.push(`        const relationships = ${relationshipsJSON};`);
                        continue;
                    }
                    
                    if (inLogicalData || inHierarchical || inRelationships) {
                        // Skip lines that are part of the old data
                        if (line.trim() === '};' || line.trim() === '];') {
                            inLogicalData = false;
                            inHierarchical = false;
                            inRelationships = false;
                        }
                        continue;
                    }
                    
                    newLines.push(line);
                }
                
                template = newLines.join('\n');
            } else {
                // For physical model - similar approach
                const lines = template.split('\n');
                let inPhysicalData = false;
                let inHierarchical = false;
                let inRelationships = false;
                const newLines = [];
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    if (line.trim().startsWith('const physicalData =')) {
                        newLines.push(`        const physicalData = ${physicalDataJSON};`);
                        inPhysicalData = true;
                        continue;
                    }
                    
                    if (inPhysicalData && line.trim().startsWith('const hierarchical =')) {
                        inPhysicalData = false;
                        inHierarchical = true;
                        newLines.push(`        const hierarchical = ${hierarchicalJSON};`);
                        continue;
                    }
                    
                    if (inHierarchical && line.trim().startsWith('const relationships =')) {
                        inHierarchical = false;
                        inRelationships = true;
                        newLines.push(`        const relationships = ${relationshipsJSON};`);
                        continue;
                    }
                    
                    if (inPhysicalData || inHierarchical || inRelationships) {
                        // Skip lines that are part of the old data
                        if ((inPhysicalData || inHierarchical) && line.trim() === '};') {
                            inPhysicalData = false;
                            inHierarchical = false;
                        }
                        if (inRelationships && line.trim() === '];') {
                            inRelationships = false;
                        }
                        continue;
                    }
                    
                    newLines.push(line);
                }
                
                template = newLines.join('\n');
            }
            
            return template;
        } catch (error) {
            logger.warn({ error: error.message, templatePath }, 'Failed to load template, using built-in');
            return null; // Fall back to built-in template
        }
    }

    /**
     * Load hierarchical data from metadata.json
     */
    async loadHierarchicalData() {
        try {
            const fileId = this.metadata.fileId;
            const newMetadataPath = path.join(config.phase1ArtifactsDir, fileId, 'json', 'metadata.json');
            const oldMetadataPath = path.join(config.phase1ArtifactsDir, fileId, 'metadata.json');
            const metadataPath = fs.existsSync(newMetadataPath) ? newMetadataPath : oldMetadataPath;

            if (fs.existsSync(metadataPath)) {
                const rawData = await readJSON(metadataPath);
                return rawData.metadata?.hierarchical || null;
            }
        } catch (error) {
            logger.warn({ error: error.message }, 'Failed to load hierarchical data, using fallback');
        }
        return null;
    }

    /**
     * Build hierarchical structure from metadata if not available
     */
    buildHierarchicalStructure(tables) {
        const hierarchical = {};

        for (const table of tables) {
            // Try to get domain/sub-domain from table metadata or infer from table name
            const tableName = table.name.toLowerCase();
            let domain = 'Other';
            let subDomain = 'General';

            // Try to infer domain from table name patterns
            if (tableName.includes('customer') || tableName.includes('client') || tableName.includes('user')) {
                domain = 'Customer';
            } else if (tableName.includes('order') || tableName.includes('purchase') || tableName.includes('transaction')) {
                domain = 'Order';
            } else if (tableName.includes('product') || tableName.includes('item') || tableName.includes('inventory')) {
                domain = 'Product';
            } else if (tableName.includes('payment') || tableName.includes('billing') || tableName.includes('invoice')) {
                domain = 'Payment';
            } else if (tableName.includes('shipping') || tableName.includes('delivery')) {
                domain = 'Shipping';
            }

            if (!hierarchical[domain]) {
                hierarchical[domain] = {};
            }
            if (!hierarchical[domain][subDomain]) {
                hierarchical[domain][subDomain] = {};
            }

            if (!hierarchical[domain][subDomain][table.name]) {
                hierarchical[domain][subDomain][table.name] = {
                    entityName: table.name,
                    entityDescription: table.description || '',
                    attributes: []
                };
            }

            // Add attributes
            for (const col of table.columns) {
                hierarchical[domain][subDomain][table.name].attributes.push({
                    attributeName: col.name,
                    attributeDescription: col.description || '',
                    dataType: col.dataType,
                    isPrimaryKey: col.isPrimaryKey,
                    isForeignKey: col.isForeignKey,
                    nullable: col.isNullable !== false,
                    unique: col.isUnique,
                    defaultValue: col.defaultValue,
                    checkConstraint: col._llmCheckConstraint,
                    autoIncrement: col.isPrimaryKey && (col.dataType?.includes('INT') || col._llmExactType?.includes('INT')),
                    referencesTable: col.referencesTable,
                    referencesColumn: col.referencesColumn
                });
            }
        }

        return hierarchical;
    }

    extractRelationships(tables) {
        const relationships = [];
        for (const table of tables) {
            for (const col of table.columns) {
                if (col.isForeignKey && col.referencesTable) {
                    relationships.push({
                        from: col.referencesTable,
                        to: table.name,
                        fromCol: col.referencesColumn || 'id',
                        toCol: col.name
                    });
                }
            }
        }
        return relationships;
    }

    /**
     * Generate Mermaid ER diagram syntax from physical model data
     * @param {Object} physicalData - Hierarchical physical data
     * @param {Array} relationships - All relationships
     * @param {Object} filter - Optional filter {domain, subDomain, entity}
     */
    generateMermaidERD(physicalData, relationships, filter = null) {
        let mermaid = 'erDiagram\n';
        
        // Collect filtered tables and their columns
        const allTables = {};
        const selectedTableNames = new Set();
        
        // Extract tables based on filter
        for (const [domainName, domain] of Object.entries(physicalData)) {
            // Apply domain filter
            if (filter && filter.domain && filter.domain !== domainName) continue;
            
            for (const [subDomainName, subDomain] of Object.entries(domain)) {
                // Apply sub-domain filter
                if (filter && filter.subDomain && filter.subDomain !== subDomainName) continue;
                
                for (const [entityName, entity] of Object.entries(subDomain)) {
                    // Apply entity filter
                    if (filter && filter.entity && filter.entity !== entityName) continue;
                    
                    selectedTableNames.add(entityName);
                    
                    if (!allTables[entityName]) {
                        allTables[entityName] = {
                            name: entityName,
                            description: entity.entityDescription || '',
                            columns: []
                        };
                    }
                    
                    // Add columns with physical details
                    for (const col of entity.columns) {
                        // Mermaid format: type column_name "constraints"
                        let colDef = col.physicalType + ' ' + col.attributeName;
                        
                        // Add PK/FK markers
                        const markers = [];
                        if (col.isPK) markers.push('PK');
                        if (col.isFK) markers.push('FK');
                        
                        // Add constraints
                        const constraints = [];
                        if (!col.nullable) constraints.push('NOT NULL');
                        if (col.unique) constraints.push('UNIQUE');
                        if (col.defaultValue) constraints.push('DEFAULT ' + col.defaultValue);
                        if (col.autoIncrement) constraints.push('AUTO_INCREMENT');
                        if (col.checkConstraint) constraints.push('CHECK(' + col.checkConstraint + ')');
                        
                        // Combine markers and constraints
                        const allAttrs = markers.concat(constraints);
                        if (allAttrs.length > 0) {
                            colDef += ' "' + allAttrs.join(', ') + '"';
                        }
                        
                        allTables[entityName].columns.push(colDef);
                    }
                }
            }
        }
        
        // If filtering by entity, include related tables (tables that reference or are referenced by selected tables)
        if (filter && filter.entity) {
            for (const rel of relationships) {
                // If selected table references another table, include that table
                if (rel.to === filter.entity && !selectedTableNames.has(rel.from)) {
                    // Find and add the referenced table
                    for (const [domainName, domain] of Object.entries(physicalData)) {
                        for (const [subDomainName, subDomain] of Object.entries(domain)) {
                            if (subDomain[rel.from]) {
                                selectedTableNames.add(rel.from);
                                const entity = subDomain[rel.from];
                                if (!allTables[rel.from]) {
                                    allTables[rel.from] = {
                                        name: rel.from,
                                        description: entity.entityDescription || '',
                                        columns: []
                                    };
                                    // Add columns for referenced table
                                    for (const col of entity.columns) {
                                        let colDef = col.physicalType + ' ' + col.attributeName;
                                        const markers = [];
                                        if (col.isPK) markers.push('PK');
                                        if (col.isFK) markers.push('FK');
                                        const constraints = [];
                                        if (!col.nullable) constraints.push('NOT NULL');
                                        if (col.unique) constraints.push('UNIQUE');
                                        if (col.defaultValue) constraints.push('DEFAULT ' + col.defaultValue);
                                        if (col.autoIncrement) constraints.push('AUTO_INCREMENT');
                                        if (col.checkConstraint) constraints.push('CHECK(' + col.checkConstraint + ')');
                                        const allAttrs = markers.concat(constraints);
                                        if (allAttrs.length > 0) {
                                            colDef += ' "' + allAttrs.join(', ') + '"';
                                        }
                                        allTables[rel.from].columns.push(colDef);
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
                // If another table references selected table, include that table
                if (rel.from === filter.entity && !selectedTableNames.has(rel.to)) {
                    // Find and add the referencing table
                    for (const [domainName, domain] of Object.entries(physicalData)) {
                        for (const [subDomainName, subDomain] of Object.entries(domain)) {
                            if (subDomain[rel.to]) {
                                selectedTableNames.add(rel.to);
                                const entity = subDomain[rel.to];
                                if (!allTables[rel.to]) {
                                    allTables[rel.to] = {
                                        name: rel.to,
                                        description: entity.entityDescription || '',
                                        columns: []
                                    };
                                    // Add columns for referencing table
                                    for (const col of entity.columns) {
                                        let colDef = col.physicalType + ' ' + col.attributeName;
                                        const markers = [];
                                        if (col.isPK) markers.push('PK');
                                        if (col.isFK) markers.push('FK');
                                        const constraints = [];
                                        if (!col.nullable) constraints.push('NOT NULL');
                                        if (col.unique) constraints.push('UNIQUE');
                                        if (col.defaultValue) constraints.push('DEFAULT ' + col.defaultValue);
                                        if (col.autoIncrement) constraints.push('AUTO_INCREMENT');
                                        if (col.checkConstraint) constraints.push('CHECK(' + col.checkConstraint + ')');
                                        const allAttrs = markers.concat(constraints);
                                        if (allAttrs.length > 0) {
                                            colDef += ' "' + allAttrs.join(', ') + '"';
                                        }
                                        allTables[rel.to].columns.push(colDef);
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        // Generate entity definitions
        for (const [tableName, table] of Object.entries(allTables)) {
            const cleanName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
            mermaid += `    ${cleanName} {\n`;
            
            // Limit columns shown (show first 10, then indicate more)
            const maxCols = 10;
            const colsToShow = table.columns.slice(0, maxCols);
            
            for (const col of colsToShow) {
                // Escape special characters for Mermaid
                const escapedCol = col.replace(/"/g, '\\"').replace(/\n/g, ' ');
                mermaid += `        ${escapedCol}\n`;
            }
            
            if (table.columns.length > maxCols) {
                mermaid += `        ... "${table.columns.length - maxCols} more columns"\n`;
            }
            
            mermaid += `    }\n\n`;
        }
        
        // Generate relationships (only for selected tables)
        for (const rel of relationships) {
            const fromTable = rel.from.replace(/[^a-zA-Z0-9_]/g, '_');
            const toTable = rel.to.replace(/[^a-zA-Z0-9_]/g, '_');
            
            // Only include relationships where both tables are in our filtered set
            if (selectedTableNames.has(rel.from) && selectedTableNames.has(rel.to)) {
                const relLabel = rel.fromCol + ' → ' + rel.toCol;
                mermaid += `    ${fromTable} ||--o{ ${toTable} : "${relLabel}"\n`;
            }
        }
        
        return mermaid;
    }

    /**
     * Prepare Logical Model data (TEXT, NUMBER, DATE, BOOLEAN)
     */
    prepareLogicalData(hierarchical) {
        const logicalData = {};

        for (const [domainName, domain] of Object.entries(hierarchical)) {
            logicalData[domainName] = {};
            for (const [subDomainName, subDomain] of Object.entries(domain)) {
                logicalData[domainName][subDomainName] = {};
                for (const [entityName, entity] of Object.entries(subDomain)) {
                    logicalData[domainName][subDomainName][entityName] = {
                        entityName: entity.entityName,
                        entityDescription: entity.entityDescription,
                        attributes: entity.attributes.map(attr => ({
                            attributeName: attr.attributeName,
                            attributeDescription: attr.attributeDescription,
                            logicalType: mapToLogicalType(attr.dataType),
                            isPK: attr.isPrimaryKey,
                            isFK: attr.isForeignKey,
                            nullable: attr.nullable,
                            unique: attr.unique,
                            refEntity: attr.referencesTable,
                            refAttribute: attr.referencesColumn
                        }))
                    };
                }
            }
        }

        return logicalData;
    }

    /**
     * Prepare Physical Model data (VARCHAR, INT, etc. with constraints)
     */
    preparePhysicalData(hierarchical) {
        const physicalData = {};

        for (const [domainName, domain] of Object.entries(hierarchical)) {
            physicalData[domainName] = {};
            for (const [subDomainName, subDomain] of Object.entries(domain)) {
                physicalData[domainName][subDomainName] = {};
                for (const [entityName, entity] of Object.entries(subDomain)) {
                    physicalData[domainName][subDomainName][entityName] = {
                        entityName: entity.entityName,
                        entityDescription: entity.entityDescription,
                        columns: entity.attributes.map(attr => ({
                            attributeName: attr.attributeName,
                            attributeDescription: attr.attributeDescription,
                            physicalType: attr.dataType || 'VARCHAR(255)',
                            isPK: attr.isPrimaryKey,
                            isFK: attr.isForeignKey,
                            nullable: attr.nullable !== false, // true if nullable, false if NOT NULL
                            unique: attr.unique,
                            defaultValue: attr.defaultValue,
                            checkConstraint: attr.checkConstraint,
                            autoIncrement: attr.autoIncrement,
                            refTable: attr.referencesTable,
                            refCol: attr.referencesColumn
                        }))
                    };
                }
            }
        }

        return physicalData;
    }

    async generateLogical() {
        const tables = Array.from(this.metadata.tables.values());
        const relationships = this.extractRelationships(tables);

        // Load or build hierarchical structure
        let hierarchical = await this.loadHierarchicalData();
        if (!hierarchical) {
            hierarchical = this.buildHierarchicalStructure(tables);
        }

        // Prepare Logical model data only
        const logicalData = this.prepareLogicalData(hierarchical);

        return this.createLogicalHTML(logicalData, relationships, hierarchical);
    }

    async generatePhysical() {
        const tables = Array.from(this.metadata.tables.values());
        const relationships = this.extractRelationships(tables);

        // Load or build hierarchical structure
        let hierarchical = await this.loadHierarchicalData();
        if (!hierarchical) {
            hierarchical = this.buildHierarchicalStructure(tables);
        }

        // Prepare Physical model data only
        const physicalData = this.preparePhysicalData(hierarchical);

        return this.createPhysicalHTML(physicalData, relationships, hierarchical);
    }

    // Legacy method for backward compatibility
    async generate() {
        return this.generatePhysical();
    }

    createHTML(logicalData, physicalData, relationships, hierarchical) {
        const logicalJSON = JSON.stringify(logicalData);
        const physicalJSON = JSON.stringify(physicalData);
        const relationshipsJSON = JSON.stringify(relationships);
        const hierarchicalJSON = JSON.stringify(hierarchical);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Model Interactive Viewer - Logical & Physical</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f5f5f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        #header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        #header h1 { font-size: 20px; font-weight: 600; }
        #view-toggle {
            display: flex;
            gap: 10px;
        }
        .view-btn {
            padding: 8px 20px;
            border: 2px solid white;
            background: transparent;
            color: white;
            border-radius: 5px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s;
        }
        .view-btn.active {
            background: white;
            color: #667eea;
        }
        .view-btn:hover {
            background: rgba(255,255,255,0.2);
        }
        #main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        #sidebar {
            width: 300px;
            background: white;
            border-right: 2px solid #e0e0e0;
            overflow-y: auto;
            padding: 20px;
            flex-shrink: 0;
        }
        #content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #fafafa;
        }
        .breadcrumb {
            padding: 10px 15px;
            background: white;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        .breadcrumb-item {
            color: #667eea;
            cursor: pointer;
            font-weight: 500;
            padding: 5px 10px;
            border-radius: 5px;
            transition: background 0.2s;
        }
        .breadcrumb-item:hover {
            background: #f0f0f0;
            text-decoration: underline;
        }
        .breadcrumb-separator {
            color: #999;
        }
        .domain-item, .subdomain-item, .entity-item {
            padding: 12px 15px;
            margin: 5px 0;
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.3s;
        }
        .domain-item:hover, .subdomain-item:hover, .entity-item:hover {
            background: #e9ecef;
            transform: translateX(5px);
        }
        .domain-item {
            font-weight: 600;
            font-size: 16px;
            border-left-color: #667eea;
        }
        .subdomain-item {
            margin-left: 20px;
            font-weight: 500;
            font-size: 14px;
            border-left-color: #8b5cf6;
        }
        .entity-item {
            margin-left: 40px;
            font-size: 13px;
            border-left-color: #10b981;
        }
        .entity-details {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .entity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e0e0e0;
        }
        .entity-name {
            font-size: 24px;
            font-weight: 700;
            color: #1e3c72;
        }
        .entity-description {
            color: #666;
            font-style: italic;
            margin-top: 5px;
        }
        .entity-stats {
            display: flex;
            gap: 15px;
        }
        .stat-badge {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .stat-badge.attributes { background: #e3f2fd; color: #1976d2; }
        .stat-badge.pk { background: #e8f5e9; color: #388e3c; }
        .stat-badge.fk { background: #fff3e0; color: #f57c00; }
        .attribute-row {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: 15px;
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
            align-items: center;
        }
        .attribute-row:last-child { border-bottom: none; }
        .attribute-row:hover { background: #f8f9ff; }
        .attribute-name {
            font-weight: 600;
            color: #333;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .attribute-type {
            color: #667eea;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            font-weight: 500;
        }
        .attribute-props {
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
        }
        .badge {
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            display: inline-block;
        }
        .badge-pk { background: #10b981; color: white; }
        .badge-fk { background: #f59e0b; color: white; }
        .badge-unique { background: #8b5cf6; color: white; }
        .badge-nn { background: #ef4444; color: white; }
        .badge-default { background: #3b82f6; color: white; }
        .badge-check { background: #ec4899; color: white; }
        .badge-ai { background: #06b6d4; color: white; }
        .attribute-details {
            grid-column: 1 / -1;
            font-size: 12px;
            color: #666;
            margin-top: 5px;
            padding-left: 5px;
        }
        .attribute-description {
            font-style: italic;
            color: #888;
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #999;
        }
        .empty-state h2 {
            font-size: 24px;
            margin-bottom: 10px;
        }
        .empty-state p {
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div id="header">
        <h1>🎯 Data Model Interactive Viewer</h1>
        <div id="view-toggle">
            <button class="view-btn active" onclick="switchView('logical')">📋 Logical Model</button>
            <button class="view-btn" onclick="switchView('physical')">⚙️ Physical Model</button>
        </div>
    </div>
    
    <div id="main-container">
        <div id="sidebar">
            <div id="navigation"></div>
        </div>
        
        <div id="content">
            <div id="breadcrumb"></div>
            <div id="entity-view"></div>
        </div>
    </div>

    <script>
        // Data from server
        const logicalData = ${logicalJSON};
        const physicalData = ${physicalJSON};
        const relationships = ${relationshipsJSON};
        const hierarchical = ${hierarchicalJSON};
        
        // Current state
        let currentView = 'logical'; // 'logical' or 'physical'
        let currentDomain = null;
        let currentSubDomain = null;
        let currentEntity = null;
        
        // Initialize
        renderNavigation();
        showDomains();
        
        function switchView(view) {
            currentView = view;
            document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            if (currentEntity) {
                showEntity(currentDomain, currentSubDomain, currentEntity);
            } else if (currentSubDomain) {
                showSubDomain(currentDomain, currentSubDomain);
            } else if (currentDomain) {
                showDomain(currentDomain);
            } else {
                showDomains();
            }
        }
        
        function renderNavigation() {
            const nav = document.getElementById('navigation');
            nav.innerHTML = '<h3 style="margin-bottom: 15px; color: #667eea;">📁 Navigation</h3>';
            
            for (const [domainName, domain] of Object.entries(hierarchical)) {
                const domainEl = document.createElement('div');
                domainEl.className = 'domain-item';
                domainEl.textContent = \`📂 \${domainName}\`;
                domainEl.onclick = () => showDomain(domainName);
                nav.appendChild(domainEl);
            }
        }
        
        function showDomains() {
            currentDomain = null;
            currentSubDomain = null;
            currentEntity = null;
            
            updateBreadcrumb([]);
            
            const content = document.getElementById('entity-view');
            content.innerHTML = '<div class="empty-state"><h2>Select a Domain</h2><p>Click on a domain in the sidebar to explore</p></div>';
        }
        
        function showDomain(domainName) {
            currentDomain = domainName;
            currentSubDomain = null;
            currentEntity = null;
            
            updateBreadcrumb([{ type: 'domain', name: domainName }]);
            
            const content = document.getElementById('entity-view');
            const domain = hierarchical[domainName];
            const subDomains = Object.keys(domain);
            
            let html = \`<div class="entity-details"><h2 class="entity-name">📂 Domain: \${domainName}</h2>\`;
            html += \`<div style="margin-top: 20px;"><h3 style="margin-bottom: 15px; color: #667eea;">Sub-domains:</h3>\`;
            
            for (const [subDomainName, subDomain] of Object.entries(domain)) {
                const entityCount = Object.keys(subDomain).length;
                html += \`
                    <div class="subdomain-item" onclick="showSubDomain('\${domainName}', '\${subDomainName}')">
                        📁 \${subDomainName} (\${entityCount} entities)
                    </div>
                \`;
            }
            
            html += '</div></div>';
            content.innerHTML = html;
        }
        
        function showSubDomain(domainName, subDomainName) {
            currentDomain = domainName;
            currentSubDomain = subDomainName;
            currentEntity = null;
            
            updateBreadcrumb([
                { type: 'domain', name: domainName },
                { type: 'subdomain', name: subDomainName }
            ]);
            
            const content = document.getElementById('entity-view');
            const subDomain = hierarchical[domainName][subDomainName];
            const entities = Object.keys(subDomain);
            
            let html = \`<div class="entity-details"><h2 class="entity-name">📁 Sub-domain: \${subDomainName}</h2>\`;
            html += \`<div style="margin-top: 20px;"><h3 style="margin-bottom: 15px; color: #667eea;">Entities:</h3>\`;
            
            for (const entityName of entities) {
                const entity = subDomain[entityName];
                const attrCount = entity.attributes.length;
                html += \`
                    <div class="entity-item" onclick="showEntity('\${domainName}', '\${subDomainName}', '\${entityName}')">
                        📊 \${entityName} (\${attrCount} attributes)
                    </div>
                \`;
            }
            
            html += '</div></div>';
            content.innerHTML = html;
        }
        
        function showEntity(domainName, subDomainName, entityName) {
            currentDomain = domainName;
            currentSubDomain = subDomainName;
            currentEntity = entityName;
            
            updateBreadcrumb([
                { type: 'domain', name: domainName },
                { type: 'subdomain', name: subDomainName },
                { type: 'entity', name: entityName }
            ]);
            
            const content = document.getElementById('entity-view');
            const data = currentView === 'logical' ? logicalData : physicalData;
            const entity = data[domainName][subDomainName][entityName];
            const attributes = currentView === 'logical' ? entity.attributes : entity.columns;
            
            let html = \`
                <div class="entity-details">
                    <div class="entity-header">
                        <div>
                            <div class="entity-name">📊 Entity: \${entityName}</div>
                            \${entity.entityDescription ? \`<div class="entity-description">\${entity.entityDescription}</div>\` : ''}
                        </div>
                        <div class="entity-stats">
                            <span class="stat-badge attributes">\${attributes.length} Attributes</span>
                            <span class="stat-badge pk">\${attributes.filter(a => a.isPK).length} PK</span>
                            <span class="stat-badge fk">\${attributes.filter(a => a.isFK).length} FK</span>
                        </div>
                    </div>
                    <div style="margin-top: 20px;">
                        <h3 style="margin-bottom: 15px; color: #667eea;">Attributes:</h3>
            \`;
            
            for (const attr of attributes) {
                const badges = [];
                if (attr.isPK) badges.push('<span class="badge badge-pk">PK</span>');
                if (attr.isFK) badges.push('<span class="badge badge-fk">FK</span>');
                if (attr.unique) badges.push('<span class="badge badge-unique">UQ</span>');
                if (currentView === 'physical') {
                    if (!attr.nullable) badges.push('<span class="badge badge-nn">NN</span>');
                    if (attr.defaultValue) badges.push(\`<span class="badge badge-default" title="Default: \${attr.defaultValue}">DEF</span>\`);
                    if (attr.checkConstraint) badges.push(\`<span class="badge badge-check" title="Check: \${attr.checkConstraint}">CHK</span>\`);
                    if (attr.autoIncrement) badges.push('<span class="badge badge-ai">AI</span>');
                } else {
                    if (!attr.nullable) badges.push('<span class="badge badge-nn">NN</span>');
                }
                
                let detailsHTML = '';
                if (currentView === 'physical') {
                    if (attr.refTable) {
                        detailsHTML += \`<div class="attribute-details">→ References: \${attr.refTable}.\${attr.refCol || 'id'}</div>\`;
                    }
                    if (attr.defaultValue) {
                        detailsHTML += \`<div class="attribute-details">Default: \${attr.defaultValue}</div>\`;
                    }
                    if (attr.checkConstraint) {
                        detailsHTML += \`<div class="attribute-details">Check: \${attr.checkConstraint}</div>\`;
                    }
                } else {
                    if (attr.refEntity) {
                        detailsHTML += \`<div class="attribute-details">→ References: \${attr.refEntity}.\${attr.refAttribute || 'id'}</div>\`;
                    }
                }
                if (attr.attributeDescription) {
                    detailsHTML += \`<div class="attribute-description">\${attr.attributeDescription}</div>\`;
                }
                
                html += \`
                    <div class="attribute-row">
                        <div class="attribute-name">
                            \${attr.attributeName}
                            <div class="attribute-props">\${badges.join('')}</div>
                        </div>
                        <div class="attribute-type">\${currentView === 'logical' ? attr.logicalType : attr.physicalType}</div>
                        <div class="attribute-props">\${badges.join('')}</div>
                        \${detailsHTML}
                    </div>
                \`;
            }
            
            html += '</div></div>';
            content.innerHTML = html;
        }
        
        function updateBreadcrumb(path) {
            const breadcrumb = document.getElementById('breadcrumb');
            if (path.length === 0) {
                breadcrumb.innerHTML = '<div class="breadcrumb"><span class="breadcrumb-item" onclick="showDomains()">🏠 Home</span></div>';
                return;
            }
            
            let html = '<div class="breadcrumb"><span class="breadcrumb-item" onclick="showDomains()">🏠 Home</span>';
            
            for (let i = 0; i < path.length; i++) {
                const item = path[i];
                html += '<span class="breadcrumb-separator">›</span>';
                
                if (item.type === 'domain') {
                    html += \`<span class="breadcrumb-item" onclick="showDomain('\${item.name}')">📂 \${item.name}</span>\`;
                } else if (item.type === 'subdomain') {
                    html += \`<span class="breadcrumb-item" onclick="showSubDomain('\${currentDomain}', '\${item.name}')">📁 \${item.name}</span>\`;
                } else if (item.type === 'entity') {
                    html += \`<span class="breadcrumb-item">📊 \${item.name}</span>\`;
                }
            }
            
            html += '</div>';
            breadcrumb.innerHTML = html;
        }
        
        // Make functions global for onclick handlers
        window.showDomains = showDomains;
        window.showDomain = showDomain;
        window.showSubDomain = showSubDomain;
        window.showEntity = showEntity;
        window.switchView = switchView;
    </script>
</body>
</html>`;
    }

    /**
     * Create Logical Model HTML (TEXT, NUMBER, DATE, BOOLEAN only)
     */
    createLogicalHTML(logicalData, relationships, hierarchical) {
        // Use template from templates directory (universal generation)
        // logicalData is already prepared by prepareLogicalData in generateLogical()
        const template = this.loadTemplate('logical', null, hierarchical, relationships, logicalData);
        if (template) {
            return template;
        }
        
        // Fall back to built-in template (should not happen if templates directory exists)
        const logicalJSON = JSON.stringify(logicalData);
        const relationshipsJSON = JSON.stringify(relationships);
        const hierarchicalJSON = JSON.stringify(hierarchical);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logical Model Interactive Viewer</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f5f5f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        #header {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            color: white;
            padding: 15px 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        #header h1 { font-size: 20px; font-weight: 600; }
        #view-toggle {
            display: flex;
            gap: 10px;
        }
        .view-btn {
            padding: 8px 20px;
            border: 2px solid white;
            background: transparent;
            color: white;
            border-radius: 5px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .view-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }
        .view-btn.active {
            background: white;
            color: #4f46e5;
        }
        #main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        #sidebar {
            width: 300px;
            background: white;
            border-right: 2px solid #e0e0e0;
            overflow-y: auto;
            padding: 20px;
            flex-shrink: 0;
            z-index: 10;
        }
        #content-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }
        #breadcrumb {
            padding: 10px 15px;
            background: white;
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            flex-shrink: 0;
            z-index: 5;
        }
        .breadcrumb-item {
            color: #4f46e5;
            cursor: pointer;
            font-weight: 500;
            padding: 5px 10px;
            border-radius: 5px;
            transition: background 0.2s;
        }
        .breadcrumb-item:hover {
            background: #f0f0f0;
            text-decoration: underline;
        }
        .breadcrumb-separator {
            color: #999;
        }
        #content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #fafafa;
        }
        #erd-container {
            flex: 1;
            display: none;
            overflow: hidden;
            background: white;
            position: relative;
        }
        #mermaid-output {
            width: 100%;
            height: 100%;
            overflow: auto;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }
        .erd-controls {
            position: absolute;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 100;
        }
        .control-btn {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: white;
            border: 1px solid #ddd;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            font-size: 18px;
            transition: all 0.2s;
        }
        .control-btn:hover {
            background: #f0f0f0;
            transform: scale(1.1);
        }
        .domain-item, .subdomain-item, .entity-item {
            padding: 12px 15px;
            margin: 5px 0;
            background: #f8f9fa;
            border-left: 4px solid #4f46e5;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.3s;
        }
        .domain-item:hover, .subdomain-item:hover, .entity-item:hover {
            background: #e9ecef;
            transform: translateX(5px);
        }
        .domain-item.active, .subdomain-item.active, .entity-item.active {
            background: #eef2ff;
            border-left-width: 6px;
        }
        .domain-item { font-weight: 600; font-size: 16px; border-left-color: #4f46e5; }
        .subdomain-item { margin-left: 20px; font-weight: 500; font-size: 14px; border-left-color: #7c3aed; }
        .entity-item { margin-left: 40px; font-size: 13px; border-left-color: #10b981; }
        
        .entity-details {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .entity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e0e0e0;
        }
        .entity-name { font-size: 24px; font-weight: 700; color: #1e3c72; }
        .attribute-row {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: 15px;
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
            align-items: center;
        }
        .attribute-name { font-weight: 600; color: #333; display: flex; align-items: center; gap: 8px; }
        .attribute-type { color: #4f46e5; font-family: 'Courier New', monospace; font-size: 13px; }
        .badge { padding: 3px 8px; border-radius: 3px; font-size: 10px; font-weight: 600; }
        .badge-pk { background: #10b981; color: white; }
        .badge-fk { background: #f59e0b; color: white; }
        .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    </style>
</head>
<body>
    <div id="header">
        <h1>📋 Logical Model Interactive Viewer</h1>
        <div id="view-toggle">
            <button class="view-btn active" id="btn-list" onclick="setView('list')"><span>📝</span> List View</button>
            <button class="view-btn" id="btn-erd" onclick="setView('erd')"><span>📊</span> ERD Diagram</button>
        </div>
    </div>
    
    <div id="main-container">
        <div id="sidebar">
            <div id="navigation"></div>
        </div>
        
        <div id="content-wrapper">
            <div id="breadcrumb"></div>
            
            <div id="content">
                <div id="entity-view"></div>
            </div>
            
            <div id="erd-container">
                <div id="mermaid-output"></div>
                <div class="erd-controls">
                    <button class="control-btn" title="Zoom In" onclick="zoomERD(1.2)">➕</button>
                    <button class="control-btn" title="Zoom Out" onclick="zoomERD(0.8)">➖</button>
                    <button class="control-btn" title="Reset Zoom" onclick="resetZoom()">🔄</button>
                    <button class="control-btn" title="Download SVG" onclick="downloadSVG()">💾</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const logicalData = ${logicalJSON};
        const relationships = ${relationshipsJSON};
        const hierarchical = ${hierarchicalJSON};
        
        let currentView = 'list';
        let currentDomain = null;
        let currentSubDomain = null;
        let currentEntity = null;
        let zoomLevel = 1;
        
        mermaid.initialize({ startOnLoad: false, theme: 'default', er: { useMaxWidth: false, htmlLabels: true } });
        
        renderNavigation();
        showDomains();
        
        function setView(view) {
            currentView = view;
            document.getElementById('btn-list').classList.toggle('active', view === 'list');
            document.getElementById('btn-erd').classList.toggle('active', view === 'erd');
            document.getElementById('content').style.display = view === 'list' ? 'block' : 'none';
            document.getElementById('erd-container').style.display = view === 'erd' ? 'flex' : 'none';
            if (view === 'erd') renderERD();
        }

        function renderNavigation() {
            const nav = document.getElementById('navigation');
            nav.innerHTML = '<h3 style="margin-bottom: 15px; color: #4f46e5;">📁 Navigation</h3>';
            
            for (const [domainName, domain] of Object.entries(hierarchical)) {
                const domainEl = document.createElement('div');
                domainEl.className = 'domain-item' + (currentDomain === domainName ? ' active' : '');
                domainEl.id = \`nav-domain-\${domainName}\`;
                domainEl.textContent = \`📂 \${domainName}\`;
                domainEl.onclick = () => showDomain(domainName);
                nav.appendChild(domainEl);
                
                const subContainer = document.createElement('div');
                subContainer.id = \`sub-container-\${domainName}\`;
                subContainer.style.display = currentDomain === domainName ? 'block' : 'none';
                
                for (const [subDomainName, subDomain] of Object.entries(domain)) {
                    const subEl = document.createElement('div');
                    subEl.className = 'subdomain-item' + (currentSubDomain === subDomainName ? ' active' : '');
                    subEl.id = \`nav-sub-\${subDomainName}\`;
                    subEl.textContent = \`📁 \${subDomainName}\`;
                    subEl.onclick = (e) => { e.stopPropagation(); showSubDomain(domainName, subDomainName); };
                    subContainer.appendChild(subEl);
                    
                    const entContainer = document.createElement('div');
                    entContainer.id = \`ent-container-\${subDomainName}\`;
                    entContainer.style.display = currentSubDomain === subDomainName ? 'block' : 'none';
                    
                    for (const entityName of Object.keys(subDomain)) {
                        const entEl = document.createElement('div');
                        entEl.className = 'entity-item' + (currentEntity === entityName ? ' active' : '');
                        entEl.id = \`nav-ent-\${entityName}\`;
                        entEl.textContent = \`📊 \${entityName}\`;
                        entEl.onclick = (e) => { e.stopPropagation(); showEntity(domainName, subDomainName, entityName); };
                        entContainer.appendChild(entEl);
                    }
                    subContainer.appendChild(entContainer);
                }
                nav.appendChild(subContainer);
            }
        }
        
        function updateNavState() {
            document.querySelectorAll('.domain-item, .subdomain-item, .entity-item').forEach(el => el.classList.remove('active'));
            if (currentDomain) {
                document.getElementById(\`nav-domain-\${currentDomain}\`)?.classList.add('active');
                document.querySelectorAll('[id^="sub-container-"]').forEach(el => el.style.display = 'none');
                document.getElementById(\`sub-container-\${currentDomain}\`).style.display = 'block';
            }
            if (currentSubDomain) {
                document.getElementById(\`nav-sub-\${currentSubDomain}\`)?.classList.add('active');
                document.querySelectorAll('[id^="ent-container-"]').forEach(el => el.style.display = 'none');
                document.getElementById(\`ent-container-\${currentSubDomain}\`).style.display = 'block';
            }
            if (currentEntity) {
                document.getElementById(\`nav-ent-\${currentEntity}\`)?.classList.add('active');
            }
        }

        function showDomains() {
            currentDomain = currentSubDomain = currentEntity = null;
            updateBreadcrumb([]);
            updateNavState();
            const content = document.getElementById('entity-view');
            content.innerHTML = '<div class="empty-state"><h2>Select a Domain</h2><p>Click on a domain in the sidebar to explore</p></div>';
            if (currentView === 'erd') renderERD();
        }
        
        function showDomain(domainName) {
            currentDomain = domainName; currentSubDomain = currentEntity = null;
            updateBreadcrumb([{ type: 'domain', name: domainName }]);
            updateNavState();
            const domain = hierarchical[domainName];
            let html = \`<div class="entity-details"><h2 class="entity-name">📂 Domain: \${domainName}</h2><div style="margin-top: 20px;">\`;
            for (const [subName, sub] of Object.entries(domain)) {
                html += \`<div class="subdomain-item" onclick="showSubDomain('\${domainName}', '\${subName}')">📁 \${subName} (\${Object.keys(sub).length} entities)</div>\`;
            }
            html += '</div></div>';
            document.getElementById('entity-view').innerHTML = html;
            if (currentView === 'erd') renderERD();
        }
        
        function showSubDomain(domainName, subDomainName) {
            currentDomain = domainName; currentSubDomain = subDomainName; currentEntity = null;
            updateBreadcrumb([{ type: 'domain', name: domainName }, { type: 'subdomain', name: subDomainName }]);
            updateNavState();
            const subDomain = hierarchical[domainName][subDomainName];
            let html = \`<div class="entity-details"><h2 class="entity-name">📁 Sub-domain: \${subDomainName}</h2><div style="margin-top: 20px;">\`;
            for (const entityName of Object.keys(subDomain)) {
                html += \`<div class="entity-item" onclick="showEntity('\${domainName}', '\${currentSubDomain}', '\${entityName}')">📊 \${entityName}</div>\`;
            }
            html += '</div></div>';
            document.getElementById('entity-view').innerHTML = html;
            if (currentView === 'erd') renderERD();
        }
        
        function showEntity(domainName, subDomainName, entityName) {
            currentDomain = domainName; currentSubDomain = subDomainName; currentEntity = entityName;
            updateBreadcrumb([{ type: 'domain', name: domainName }, { type: 'subdomain', name: subDomainName }, { type: 'entity', name: entityName }]);
            updateNavState();
            const entity = logicalData[domainName][subDomainName][entityName];
            let html = \`<div class="entity-details"><div class="entity-header"><div><div class="entity-name">📊 \${entityName}</div></div><div class="entity-stats"><span class="stat-badge attributes">\${entity.attributes.length} Attr</span></div></div>\`;
            for (const attr of entity.attributes) {
                html += \`<div class="attribute-row"><div class="attribute-name">\${attr.attributeName}\${attr.isPK?' <span class="badge badge-pk">PK</span>':''}\${attr.isFK?' <span class="badge badge-fk">FK</span>':''}</div><div class="attribute-type">\${attr.logicalType}</div></div>\`;
            }
            html += '</div>';
            document.getElementById('entity-view').innerHTML = html;
            if (currentView === 'erd') renderERD();
        }
        
        function updateBreadcrumb(path) {
            const breadcrumb = document.getElementById('breadcrumb');
            let html = '<span class="breadcrumb-item" onclick="showDomains()">🏠 Home</span>';
            path.forEach(item => {
                html += '<span class="breadcrumb-separator">›</span>';
                if (item.type === 'domain') html += \`<span class="breadcrumb-item" onclick="showDomain('\${item.name}')">📂 \${item.name}</span>\`;
                else if (item.type === 'subdomain') html += \`<span class="breadcrumb-item" onclick="showSubDomain('\${currentDomain}', '\${item.name}')">📁 \${item.name}</span>\`;
                else if (item.type === 'entity') html += \`<span class="breadcrumb-item">📊 \${item.name}</span>\`;
            });
            if (currentView === 'erd') html += '<span class="breadcrumb-separator">|</span><span class="breadcrumb-item" onclick="showDomains()">📊 Full ERD</span>';
            breadcrumb.innerHTML = html;
        }

        async function renderERD() {
            const output = document.getElementById('mermaid-output');
            output.innerHTML = '<div class="empty-state">Generating ERD...</div>';
            
            let selectedEntities = [];
            if (currentEntity) {
                selectedEntities.push(currentEntity);
                relationships.forEach(r => {
                    if (r.from === currentEntity) selectedEntities.push(r.to);
                    if (r.to === currentEntity) selectedEntities.push(r.from);
                });
            } else if (currentSubDomain) {
                selectedEntities = Object.keys(hierarchical[currentDomain][currentSubDomain]);
            } else if (currentDomain) {
                Object.values(hierarchical[currentDomain]).forEach(sub => selectedEntities.push(...Object.keys(sub)));
            } else {
                Object.values(hierarchical).forEach(dom => Object.values(dom).forEach(sub => selectedEntities.push(...Object.keys(sub))));
            }
            
            selectedEntities = [...new Set(selectedEntities)];
            let code = 'erDiagram\\n';
            selectedEntities.forEach(entName => {
                let ent;
                for (const d of Object.values(logicalData)) for (const s of Object.values(d)) if (s[entName]) ent = s[entName];
                if (ent) {
                    code += \`  "\${entName}" {\\n\`;
                    ent.attributes.forEach(a => code += \`    \${a.logicalType.replace(/\\s+/g, '_')} \${a.attributeName.replace(/\\s+/g, '_')} \${a.isPK?'PK':''} \${a.isFK?'FK':''}\\n\`);
                    code += '  }\\n';
                }
            });
            
            relationships.forEach(r => {
                if (selectedEntities.includes(r.from) && selectedEntities.includes(r.to)) {
                    code += \`  "\${r.from}" \${r.type === 'one-to-many' ? '||--o{' : '}o--||'} "\${r.to}" : "\${r.label || ''}"\\n\`;
                }
            });

            try {
                const { svg } = await mermaid.render('mermaid-svg', code);
                output.innerHTML = svg;
                resetZoom();
            } catch (e) {
                output.innerHTML = '<div class="empty-state">Error generating ERD. Too many entities?</div>';
            }
        }

        function zoomERD(factor) {
            zoomLevel *= factor;
            const svg = document.querySelector('#mermaid-output svg');
            if (svg) svg.style.transform = \`scale(\${zoomLevel})\`;
        }
        function resetZoom() { zoomLevel = 1; const svg = document.querySelector('#mermaid-output svg'); if (svg) { svg.style.transform = 'scale(1)'; svg.style.transformOrigin = 'top center'; } }
        function downloadSVG() {
            const svg = document.querySelector('#mermaid-output svg');
            if (!svg) return;
            const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'logical-model-erd.svg'; a.click();
            URL.revokeObjectURL(url);
        }

        window.showDomains = showDomains; window.showDomain = showDomain; window.showSubDomain = showSubDomain; window.showEntity = showEntity; window.setView = setView; window.zoomERD = zoomERD; window.resetZoom = resetZoom; window.downloadSVG = downloadSVG;
    </script>
</body>
</html>`;
    }

    /**
     * Create Physical Model HTML - Custom Interactive ERD
     * Features: Table boxes with PK/FK markers, data types in parentheses, crow's foot notation, grid background
     * Uses template structure with all 10 visual requirements: fact-dimension semantics, star layout, presentation mode, etc.
     */
    createPhysicalHTML(physicalData, relationships, hierarchical) {
        // Use template from templates directory (universal generation)
        const template = this.loadTemplate('physical', physicalData, hierarchical, relationships);
        if (template) {
            return template;
        }
        
        // Fall back to built-in template (should not happen if templates directory exists)
        // Flatten physical data to get all tables
        const allTables = [];
        for (const domain of Object.values(physicalData)) {
            for (const sub of Object.values(domain)) {
                for (const [name, table] of Object.entries(sub)) {
                    allTables.push({ name, ...table });
                }
            }
        }
        
        const tablesJSON = JSON.stringify(allTables);
        const relationshipsJSON = JSON.stringify(relationships);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Physical Data Model - Interactive ERD</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f0f0f0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        #title-bar {
            background: #4a5568;
            color: white;
            padding: 12px 20px;
            font-size: 18px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        #controls { display: flex; gap: 10px; }
        #controls button {
            padding: 6px 14px;
            border: 1px solid #718096;
            background: #2d3748;
            color: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        #controls button:hover { background: #4a5568; }
        #canvas-container {
            flex: 1;
            position: relative;
            overflow: hidden;
            background: #e8e8e8;
        }
        #canvas {
            position: absolute;
            width: 4000px;
            height: 3000px;
            background-image: 
                linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px);
            background-size: 20px 20px;
            cursor: grab;
        }
        #canvas:active { cursor: grabbing; }
        #svg-layer {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
        }
        .table-box {
            position: absolute;
            background: white;
            border: 2px solid #333;
            min-width: 200px;
            box-shadow: 3px 3px 8px rgba(0,0,0,0.2);
            cursor: move;
            user-select: none;
            z-index: 10;
        }
        .table-header {
            background: #4a5568;
            color: white;
            padding: 8px 12px;
            font-weight: 600;
            font-size: 14px;
            border-bottom: 2px solid #333;
            text-align: center;
        }
        .table-body { padding: 0; }
        .column-row {
            display: grid;
            grid-template-columns: 30px 1fr;
            border-bottom: 1px solid #ddd;
            font-size: 12px;
        }
        .column-row:last-child { border-bottom: none; }
        .key-marker {
            background: #f7fafc;
            padding: 6px 4px;
            text-align: center;
            font-weight: 700;
            font-size: 10px;
            color: #2d3748;
            border-right: 1px solid #ddd;
        }
        .key-marker.pk { color: #38a169; }
        .key-marker.fk { color: #dd6b20; }
        .key-marker.pkfk { color: #805ad5; }
        .column-info {
            padding: 6px 10px;
            display: flex;
            align-items: center;
        }
        .column-name { font-weight: 500; color: #1a202c; }
        .column-type { color: #718096; font-size: 11px; margin-left: 4px; }
        .relationship-line { stroke: #333; stroke-width: 1.5; fill: none; }
        .crow-line { stroke: #333; stroke-width: 1.5; }
        #minimap {
            position: absolute;
            bottom: 20px; right: 20px;
            width: 180px; height: 120px;
            background: rgba(255,255,255,0.95);
            border: 2px solid #4a5568;
            border-radius: 4px;
            overflow: hidden;
            z-index: 100;
        }
        #minimap-content { width: 100%; height: 100%; position: relative; }
        .minimap-table { position: absolute; background: #4a5568; border-radius: 1px; }
        #zoom-info {
            position: absolute;
            bottom: 20px; left: 20px;
            background: rgba(255,255,255,0.9);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            color: #4a5568;
            border: 1px solid #cbd5e0;
            z-index: 100;
        }
    </style>
</head>
<body>
    <div id="title-bar">
        <span>Physical data model</span>
        <div id="controls">
            <button onclick="zoomIn()">Zoom In (+)</button>
            <button onclick="zoomOut()">Zoom Out (-)</button>
            <button onclick="resetView()">Reset View</button>
            <button onclick="autoLayout()">Auto Layout</button>
            <button onclick="exportSVG()">Export SVG</button>
        </div>
    </div>
    
    <div id="canvas-container">
        <div id="canvas">
            <svg id="svg-layer"></svg>
        </div>
    </div>
    
    <div id="minimap">
        <div id="minimap-content"></div>
    </div>
    
    <div id="zoom-info">Zoom: 100%</div>

    <script>
        const tables = ${tablesJSON};
        const relationships = ${relationshipsJSON};
        
        let scale = 1;
        let panX = 0, panY = 0;
        let isDragging = false;
        let isPanning = false;
        let dragTarget = null;
        let dragOffsetX = 0, dragOffsetY = 0;
        let startPanX = 0, startPanY = 0;
        let startMouseX = 0, startMouseY = 0;
        const tablePositions = {};
        const tableElements = {};
        
        initializeERD();
        
        function initializeERD() {
            createTableBoxes();
            autoLayout();
            drawRelationships();
            setupPanZoom();
            updateMinimap();
        }
        
        function createTableBoxes() {
            const canvas = document.getElementById('canvas');
            
            tables.forEach((table, index) => {
                const box = document.createElement('div');
                box.className = 'table-box';
                box.id = 'table-' + table.name;
                box.setAttribute('data-table', table.name);
                
                const header = document.createElement('div');
                header.className = 'table-header';
                header.textContent = table.name;
                box.appendChild(header);
                
                const body = document.createElement('div');
                body.className = 'table-body';
                
                const sortedCols = [...(table.columns || [])].sort((a, b) => {
                    if (a.isPK && !b.isPK) return -1;
                    if (!a.isPK && b.isPK) return 1;
                    if (a.isFK && !b.isFK) return -1;
                    if (!a.isFK && b.isFK) return 1;
                    return 0;
                });
                
                sortedCols.forEach(col => {
                    const row = document.createElement('div');
                    row.className = 'column-row';
                    
                    const keyMarker = document.createElement('div');
                    keyMarker.className = 'key-marker';
                    if (col.isPK && col.isFK) {
                        keyMarker.textContent = 'PK,FK';
                        keyMarker.classList.add('pkfk');
                    } else if (col.isPK) {
                        keyMarker.textContent = 'PK';
                        keyMarker.classList.add('pk');
                    } else if (col.isFK) {
                        keyMarker.textContent = 'FK';
                        keyMarker.classList.add('fk');
                    }
                    row.appendChild(keyMarker);
                    
                    const colInfo = document.createElement('div');
                    colInfo.className = 'column-info';
                    
                    const colName = document.createElement('span');
                    colName.className = 'column-name';
                    colName.textContent = col.attributeName;
                    colInfo.appendChild(colName);
                    
                    const colType = document.createElement('span');
                    colType.className = 'column-type';
                    const displayType = formatDataType(col.physicalType || col.logicalType || 'string');
                    colType.textContent = '(' + displayType + ')';
                    colInfo.appendChild(colType);
                    
                    row.appendChild(colInfo);
                    body.appendChild(row);
                });
                
                box.appendChild(body);
                canvas.appendChild(box);
                
                tableElements[table.name] = box;
                tablePositions[table.name] = { x: 0, y: 0 };
                
                box.addEventListener('mousedown', startDrag);
            });
        }
        
        function formatDataType(physType) {
            const typeMap = {
                'VARCHAR': 'string', 'CHAR': 'string', 'TEXT': 'string', 'LONGTEXT': 'string',
                'INT': 'int', 'INTEGER': 'int', 'BIGINT': 'bigint', 'SMALLINT': 'smallint', 'TINYINT': 'tinyint',
                'DECIMAL': 'decimal', 'NUMERIC': 'numeric', 'FLOAT': 'float', 'DOUBLE': 'double',
                'DATE': 'date', 'DATETIME': 'datetime', 'TIMESTAMP': 'timestamp', 'TIME': 'time',
                'BOOLEAN': 'boolean', 'BOOL': 'boolean', 'BLOB': 'blob', 'JSON': 'json'
            };
            const baseType = physType.split('(')[0].toUpperCase();
            return typeMap[baseType] || physType.toLowerCase();
        }
        
        function autoLayout() {
            const cols = Math.ceil(Math.sqrt(tables.length));
            const spacingX = 280;
            const spacingY = 250;
            const startX = 100;
            const startY = 100;
            
            tables.forEach((table, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                const x = startX + col * spacingX;
                const y = startY + row * spacingY;
                
                tablePositions[table.name] = { x, y };
                const el = tableElements[table.name];
                if (el) {
                    el.style.left = x + 'px';
                    el.style.top = y + 'px';
                }
            });
            
            drawRelationships();
            updateMinimap();
        }
        
        function drawRelationships() {
            const svg = document.getElementById('svg-layer');
            svg.innerHTML = '';
            
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = \`
                <marker id="crowfoot-many" markerWidth="12" markerHeight="12" refX="12" refY="6" orient="auto">
                    <path d="M0,6 L12,0 M0,6 L12,12 M0,6 L12,6" stroke="#333" stroke-width="1.5" fill="none"/>
                </marker>
            \`;
            svg.appendChild(defs);
            
            relationships.forEach(rel => {
                const fromEl = tableElements[rel.from];
                const toEl = tableElements[rel.to];
                
                if (!fromEl || !toEl) return;
                
                const fromPos = tablePositions[rel.from];
                const toPos = tablePositions[rel.to];
                
                const fromWidth = fromEl.offsetWidth;
                const fromHeight = fromEl.offsetHeight;
                const toWidth = toEl.offsetWidth;
                const toHeight = toEl.offsetHeight;
                
                let startX, startY, endX, endY;
                const fromCenterX = fromPos.x + fromWidth / 2;
                const fromCenterY = fromPos.y + fromHeight / 2;
                const toCenterX = toPos.x + toWidth / 2;
                const toCenterY = toPos.y + toHeight / 2;
                
                if (fromCenterX < toCenterX) {
                    startX = fromPos.x + fromWidth;
                    startY = fromCenterY;
                    endX = toPos.x;
                    endY = toCenterY;
                } else {
                    startX = fromPos.x;
                    startY = fromCenterY;
                    endX = toPos.x + toWidth;
                    endY = toCenterY;
                }
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const midX = (startX + endX) / 2;
                const d = \`M \${startX} \${startY} C \${midX} \${startY}, \${midX} \${endY}, \${endX} \${endY}\`;
                
                path.setAttribute('d', d);
                path.setAttribute('class', 'relationship-line');
                path.setAttribute('marker-end', 'url(#crowfoot-many)');
                svg.appendChild(path);
                
                const oneLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                const oneOffset = fromCenterX < toCenterX ? 15 : -15;
                oneLine.setAttribute('x1', startX + oneOffset);
                oneLine.setAttribute('y1', startY - 8);
                oneLine.setAttribute('x2', startX + oneOffset);
                oneLine.setAttribute('y2', startY + 8);
                oneLine.setAttribute('class', 'crow-line');
                svg.appendChild(oneLine);
            });
        }
        
        function startDrag(e) {
            if (e.target.closest('.table-box')) {
                isDragging = true;
                dragTarget = e.target.closest('.table-box');
                const tableName = dragTarget.getAttribute('data-table');
                const pos = tablePositions[tableName];
                dragOffsetX = (e.clientX / scale) - pos.x + panX;
                dragOffsetY = (e.clientY / scale) - pos.y + panY;
                dragTarget.style.zIndex = 100;
                e.preventDefault();
            }
        }
        
        function setupPanZoom() {
            const container = document.getElementById('canvas-container');
            const canvas = document.getElementById('canvas');
            
            document.addEventListener('mousemove', (e) => {
                if (isDragging && dragTarget) {
                    const tableName = dragTarget.getAttribute('data-table');
                    const newX = (e.clientX / scale) - dragOffsetX + panX;
                    const newY = (e.clientY / scale) - dragOffsetY + panY;
                    
                    tablePositions[tableName] = { x: newX, y: newY };
                    dragTarget.style.left = newX + 'px';
                    dragTarget.style.top = newY + 'px';
                    
                    drawRelationships();
                    updateMinimap();
                } else if (isPanning) {
                    const dx = e.clientX - startMouseX;
                    const dy = e.clientY - startMouseY;
                    panX = startPanX - dx / scale;
                    panY = startPanY - dy / scale;
                    applyTransform();
                    updateMinimap();
                }
            });
            
            document.addEventListener('mouseup', () => {
                if (dragTarget) dragTarget.style.zIndex = 10;
                isDragging = false;
                isPanning = false;
                dragTarget = null;
            });
            
            canvas.addEventListener('mousedown', (e) => {
                if (e.target === canvas || e.target.id === 'svg-layer') {
                    isPanning = true;
                    startPanX = panX;
                    startPanY = panY;
                    startMouseX = e.clientX;
                    startMouseY = e.clientY;
                }
            });
            
            container.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                const newScale = Math.max(0.3, Math.min(2, scale * delta));
                
                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                panX += mouseX * (1/scale - 1/newScale);
                panY += mouseY * (1/scale - 1/newScale);
                
                scale = newScale;
                applyTransform();
                updateZoomInfo();
                updateMinimap();
            });
        }
        
        function applyTransform() {
            const canvas = document.getElementById('canvas');
            canvas.style.transform = \`scale(\${scale}) translate(\${-panX}px, \${-panY}px)\`;
            canvas.style.transformOrigin = 'top left';
        }
        
        function zoomIn() {
            scale = Math.min(2, scale * 1.2);
            applyTransform();
            updateZoomInfo();
            updateMinimap();
        }
        
        function zoomOut() {
            scale = Math.max(0.3, scale / 1.2);
            applyTransform();
            updateZoomInfo();
            updateMinimap();
        }
        
        function resetView() {
            scale = 1;
            panX = 0;
            panY = 0;
            applyTransform();
            updateZoomInfo();
            updateMinimap();
        }
        
        function updateZoomInfo() {
            document.getElementById('zoom-info').textContent = 'Zoom: ' + Math.round(scale * 100) + '%';
        }
        
        function updateMinimap() {
            const content = document.getElementById('minimap-content');
            content.innerHTML = '';
            
            let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
            for (const [name, pos] of Object.entries(tablePositions)) {
                const el = tableElements[name];
                if (el) {
                    minX = Math.min(minX, pos.x);
                    minY = Math.min(minY, pos.y);
                    maxX = Math.max(maxX, pos.x + el.offsetWidth);
                    maxY = Math.max(maxY, pos.y + el.offsetHeight);
                }
            }
            
            const padding = 50;
            minX -= padding; minY -= padding;
            maxX += padding; maxY += padding;
            
            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;
            const minimapScale = Math.min(180 / contentWidth, 120 / contentHeight);
            
            for (const [name, pos] of Object.entries(tablePositions)) {
                const el = tableElements[name];
                if (el) {
                    const miniTable = document.createElement('div');
                    miniTable.className = 'minimap-table';
                    miniTable.style.left = ((pos.x - minX) * minimapScale) + 'px';
                    miniTable.style.top = ((pos.y - minY) * minimapScale) + 'px';
                    miniTable.style.width = (el.offsetWidth * minimapScale) + 'px';
                    miniTable.style.height = (el.offsetHeight * minimapScale) + 'px';
                    content.appendChild(miniTable);
                }
            }
        }
        
        function exportSVG() {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
            
            for (const [name, pos] of Object.entries(tablePositions)) {
                const el = tableElements[name];
                if (el) {
                    minX = Math.min(minX, pos.x);
                    minY = Math.min(minY, pos.y);
                    maxX = Math.max(maxX, pos.x + el.offsetWidth);
                    maxY = Math.max(maxY, pos.y + el.offsetHeight);
                }
            }
            
            svg.setAttribute('width', maxX - minX + 100);
            svg.setAttribute('height', maxY - minY + 100);
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('width', '100%');
            bg.setAttribute('height', '100%');
            bg.setAttribute('fill', '#f0f0f0');
            svg.appendChild(bg);
            
            const svgLayer = document.getElementById('svg-layer');
            svg.innerHTML += svgLayer.innerHTML;
            
            const serializer = new XMLSerializer();
            const source = serializer.serializeToString(svg);
            const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'physical-erd.svg';
            link.click();
            URL.revokeObjectURL(url);
        }
    </script>
</body>
</html>`;
    }

    async saveLogical(fileName = 'logical_INTERACTIVE.html') {
        const logicalJSON = JSON.stringify(this.logicalData, null, 2);
        const relationshipsJSON = JSON.stringify(this.relationships, null, 2);
        const hierarchicalJSON = JSON.stringify(this.hierarchicalData, null, 2);
        const mermaidERDJSON = JSON.stringify(this.mermaidERD, null, 2);
        
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logical Model Interactive Viewer</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"><\/script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        #header {
            background: white;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        #header h1 {
            color: #059669;
            font-size: 24px;
            font-weight: 600;
        }
        
        #view-toggle {
            display: flex;
            gap: 10px;
        }
        
        .view-btn {
            padding: 10px 20px;
            border: 2px solid #059669;
            background: white;
            color: #059669;
            border-radius: 25px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s ease;
        }
        
        .view-btn:hover, .view-btn.active {
            background: #059669;
            color: white;
        }
        
        #main-container {
            display: flex;
            height: calc(100vh - 80px);
        }
        
        #sidebar {
            width: 300px;
            background: white;
            box-shadow: 2px 0 10px rgba(0,0,0,0.1);
            overflow-y: auto;
        }
        
        #navigation {
            padding: 20px;
        }
        
        .domain-item {
            margin-bottom: 15px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .domain-header {
            padding: 12px 15px;
            background: #f8f9fa;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.3s ease;
        }
        
        .domain-header:hover {
            background: #e9ecef;
        }
        
        .domain-header.active {
            background: #059669;
            color: white;
        }
        
        .subdomain-list {
            display: none;
            background: white;
        }
        
        .subdomain-list.active {
            display: block;
        }
        
        .subdomain-item {
            padding: 10px 15px 10px 30px;
            cursor: pointer;
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.3s ease;
        }
        
        .subdomain-item:hover {
            background: #f8f9fa;
        }
        
        .subdomain-item.active {
            background: #d4edda;
            color: #155724;
            font-weight: 500;
        }
        
        .entity-list {
            display: none;
            background: #f8f9fa;
        }
        
        .entity-list.active {
            display: block;
        }
        
        .entity-item {
            padding: 8px 15px 8px 45px;
            cursor: pointer;
            border-bottom: 1px solid #e0e0e0;
            font-size: 14px;
            transition: background 0.3s ease;
        }
        
        .entity-item:hover {
            background: #e9ecef;
        }
        
        .entity-item.active {
            background: #c3e6cb;
            color: #155724;
            font-weight: 500;
        }
        
        #content {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }
        
        #content.erd-mode {
            padding: 0;
            display: flex;
            flex-direction: column;
        }
        
        #breadcrumb {
            background: white;
            padding: 15px 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            font-size: 14px;
            color: #666;
        }
        
        #entity-view {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 20px;
        }
        
        .entity-title {
            font-size: 20px;
            font-weight: 600;
            color: #059669;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #059669;
        }
        
        .entity-section {
            margin-bottom: 20px;
        }
        
        .entity-section h3 {
            color: #495057;
            font-size: 16px;
            margin-bottom: 10px;
            font-weight: 600;
        }
        
        .attribute-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .attribute-table th {
            background: #059669;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 500;
        }
        
        .attribute-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #e0e0e0;
        }
        
        .attribute-table tr:hover {
            background: #f8f9fa;
        }
        
        .pk-badge {
            background: #dc3545;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
        }
        
        .fk-badge {
            background: #007bff;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
        }
        
        .relationships-list {
            list-style: none;
        }
        
        .relationship-item {
            padding: 8px 12px;
            margin-bottom: 5px;
            background: #f8f9fa;
            border-left: 4px solid #059669;
            border-radius: 4px;
        }
        
        #erd-container {
            display: none;
            flex: 1;
            flex-direction: column;
            background: white;
            margin: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        #erd-container.active {
            display: flex;
        }
        
        #erd-viewer {
            flex: 1;
            overflow: auto;
            padding: 20px;
            background: #fafafa;
        }
        
        .mermaid {
            text-align: center;
        }
        
        .controls {
            margin-bottom: 20px;
            text-align: center;
        }
        
        .control-btn {
            padding: 10px 20px;
            margin: 0 5px;
            border: 1px solid #059669;
            background: white;
            color: #059669;
            border-radius: 5px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s ease;
        }
        
        .control-btn:hover {
            background: #059669;
            color: white;
        }
        
        .zoom-controls {
            position: fixed;
            top: 100px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            z-index: 1000;
        }
        
        .zoom-btn {
            width: 40px;
            height: 40px;
            border: 1px solid #059669;
            background: white;
            color: #059669;
            border-radius: 50%;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .zoom-btn:hover {
            background: #059669;
            color: white;
        }
        
        .domain-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
        }
        
        .domain-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .domain-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            border-color: #059669;
        }
        
        .domain-card h3 {
            color: #059669;
            font-size: 18px;
            margin-bottom: 10px;
        }
        
        .domain-stats {
            color: #666;
            font-size: 14px;
        }
        
        .back-btn {
            padding: 8px 16px;
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            margin-bottom: 15px;
            font-weight: 500;
            transition: background 0.3s ease;
        }
        
        .back-btn:hover {
            background: #5a6268;
        }
        
        .erd-breadcrumb {
            font-size: 14px;
            color: #666;
            margin-bottom: 15px;
        }
        
        .erd-breadcrumb span {
            cursor: pointer;
            color: #059669;
        }
        
        .erd-breadcrumb span:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div id="header">
        <h1>🔧 Logical Model Interactive Viewer</h1>
        <div id="view-toggle">
            <button class="view-btn active" onclick="switchView('drilldown')">📋 Drill-Down View</button>
            <button class="view-btn" onclick="switchView('erd')">📊 ERD Diagram</button>
        </div>
    </div>
    
    <div id="main-container">
        <div id="sidebar">
            <div id="navigation"></div>
        </div>
        
        <div id="content" class="drilldown-view">
            <div id="breadcrumb"></div>
            <div id="entity-view"></div>
        </div>
        
        <div id="erd-container">
            <div id="erd-header" style="padding: 15px 20px; background: #f8f9fa; border-bottom: 2px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
                <div id="erd-breadcrumb" style="font-weight: 500; color: #059669;"></div>
                <div id="erd-controls" style="display: flex; gap: 10px;">
                    <button onclick="zoomIn()" style="padding: 8px 15px; border: 1px solid #059669; background: white; color: #059669; border-radius: 5px; cursor: pointer; font-weight: 500;">🔍 Zoom In</button>
                    <button onclick="zoomOut()" style="padding: 8px 15px; border: 1px solid #059669; background: white; color: #059669; border-radius: 5px; cursor: pointer; font-weight: 500;">🔍 Zoom Out</button>
                    <button onclick="resetZoom()" style="padding: 8px 15px; border: 1px solid #059669; background: white; color: #059669; border-radius: 5px; cursor: pointer; font-weight: 500;">↺ Reset</button>
                    <button onclick="downloadERD()" style="padding: 8px 15px; border: 1px solid #059669; background: white; color: #059669; border-radius: 5px; cursor: pointer; font-weight: 500;">💾 Download SVG</button>
                </div>
            </div>
            <div id="erd-viewer" style="flex: 1; overflow: auto;"></div>
        </div>
    </div>

    <script>
        // Logical Model Data
        const logicalData = ${logicalJSON};
        const relationships = ${relationshipsJSON};
        const hierarchical = ${hierarchicalJSON};
        const mermaidERD = ${mermaidERDJSON};
        
        // Current state
        let currentDomain = null;
        let currentSubDomain = null;
        let currentEntity = null;
        let currentView = 'drilldown'; // 'drilldown' or 'erd'
        let zoomLevel = 1;
        
        // Initialize Mermaid
        mermaid.initialize({ 
            startOnLoad: false,
            theme: 'default',
            er: {
                fontSize: 12,
                padding: 20
            }
        });
        
        // Initialize
        renderNavigation();
        showDomains();
        
        function switchView(view) {
            currentView = view;
            document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            if (view === 'erd') {
                document.getElementById('content').classList.add('erd-mode');
                document.getElementById('erd-container').classList.add('active');
                // Render ERD with current filter
                const filter = {};
                if (currentDomain) filter.domain = currentDomain;
                if (currentSubDomain) filter.subDomain = currentSubDomain;
                if (currentEntity) filter.entity = currentEntity;
                renderERD(Object.keys(filter).length > 0 ? filter : null);
            } else {
                document.getElementById('content').classList.remove('erd-mode');
                document.getElementById('erd-container').classList.remove('active');
            }
        }
        
        function renderERD(filter = null) {
            const erdViewer = document.getElementById('erd-viewer');
            const erdBreadcrumb = document.getElementById('erd-breadcrumb');
            
            // Generate filtered ERD
            let filteredERD = generateFilteredERD(filter);
            
            // Update breadcrumb
            if (!filter || (!filter.domain && !filter.subDomain && !filter.entity)) {
                erdBreadcrumb.innerHTML = '<span style="color: #059669; font-weight: 600;">📊 Full ERD Diagram</span>';
            } else {
                let breadcrumbText = '<span onclick="renderERD()" style="cursor: pointer; color: #059669;">📊 ERD</span>';
                if (filter.domain) {
                    breadcrumbText += ' › <span style="color: #059669;">' + filter.domain + '</span>';
                }
                if (filter.subDomain) {
                    breadcrumbText += ' › <span style="color: #059669;">' + filter.subDomain + '</span>';
                }
                if (filter.entity) {
                    breadcrumbText += ' › <span style="color: #059669; font-weight: 600;">' + filter.entity + '</span>';
                }
                erdBreadcrumb.innerHTML = breadcrumbText;
            }
            
            erdViewer.innerHTML = '<div class="mermaid">' + filteredERD + '</div>';
            
            mermaid.run({
                nodes: [erdViewer.querySelector('.mermaid')],
                suppressErrors: true
            }).then(() => {
                // Reset zoom after rendering
                resetZoom();
            }).catch(err => {
                console.error('Mermaid rendering error:', err);
                erdViewer.innerHTML = '<div style="padding: 40px; text-align: center;"><h2>⚠️ ERD Rendering Error</h2><p>Please check the console for details.</p></div>';
            });
        }
        
        function generateFilteredERD(filter = null) {
            if (!filter) {
                return mermaidERD;
            }
            
            const lines = mermaidERD.split('\n');
            let filteredLines = ['erDiagram'];
            let selectedTableNames = new Set();
            
            // First pass: identify tables to include
            for (const line of lines) {
                if (line.includes('TABLE') && line.includes('{"')) {
                    const tableName = line.split('[')[0].trim();
                    
                    if (filter.entity) {
                        // For entity filter, include the specific entity
                        if (tableName === filter.entity) {
                            selectedTableNames.add(tableName);
                        }
                    } else if (filter.subDomain) {
                        // For subdomain filter, include all entities in the subdomain
                        if (logicalData[filter.domain] && logicalData[filter.domain][filter.subDomain]) {
                            const entities = Object.keys(logicalData[filter.domain][filter.subDomain]);
                            if (entities.includes(tableName)) {
                                selectedTableNames.add(tableName);
                            }
                        }
                    } else if (filter.domain) {
                        // For domain filter, include all entities in the domain
                        if (logicalData[filter.domain]) {
                            for (const subDomain in logicalData[filter.domain]) {
                                const entities = Object.keys(logicalData[filter.domain][subDomain]);
                                if (entities.includes(tableName)) {
                                    selectedTableNames.add(tableName);
                                }
                            }
                        }
                    }
                }
            }
            
            // Include 1-hop relationships
            if (filter.entity) {
                for (const rel of relationships) {
                    if (rel.to === filter.entity && !selectedTableNames.has(rel.from)) {
                        selectedTableNames.add(rel.from);
                    }
                    if (rel.from === filter.entity && !selectedTableNames.has(rel.to)) {
                        selectedTableNames.add(rel.to);
                    }
                }
            }
            
            // Second pass: build the filtered ERD
            for (const line of lines) {
                if (line.includes('TABLE') && line.includes('{"')) {
                    const tableName = line.split('[')[0].trim();
                    if (selectedTableNames.has(tableName)) {
                        filteredLines.push(line);
                    }
                } else if (line.includes('--')) {
                    // Include relationships between selected tables
                    const parts = line.split('--');
                    if (parts.length >= 2) {
                        const fromTable = parts[0].trim();
                        const toTable = parts[1].trim();
                        if (selectedTableNames.has(fromTable) && selectedTableNames.has(toTable)) {
                            filteredLines.push(line);
                        }
                    }
                }
            }
            
            return filteredLines.join('\n');
        }
        
        function zoomIn() {
            zoomLevel += 0.1;
            applyZoom();
        }
        
        function zoomOut() {
            zoomLevel = Math.max(0.5, zoomLevel - 0.1);
            applyZoom();
        }
        
        function resetZoom() {
            zoomLevel = 1;
            applyZoom();
        }
        
        function applyZoom() {
            const erdViewer = document.getElementById('erd-viewer');
            if (erdViewer && erdViewer.querySelector('.mermaid')) {
                erdViewer.querySelector('.mermaid').style.transform = 'scale(' + zoomLevel + ')';
                erdViewer.querySelector('.mermaid').style.transformOrigin = 'center top';
            }
        }
        
        function downloadERD() {
            const erdViewer = document.getElementById('erd-viewer');
            const mermaidElement = erdViewer.querySelector('.mermaid svg');
            
            if (mermaidElement) {
                const svgData = new XMLSerializer().serializeToString(mermaidElement);
                const svgBlob = new Blob([svgData], {type: 'image/svg+xml;charset=utf-8'});
                const svgUrl = URL.createObjectURL(svgBlob);
                const downloadLink = document.createElement('a');
                downloadLink.href = svgUrl;
                downloadLink.download = 'logical-erd.svg';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(svgUrl);
            }
        }
        
        function renderNavigation() {
            const nav = document.getElementById('navigation');
            nav.innerHTML = '';
            
            for (const domain in logicalData) {
                const domainItem = document.createElement('div');
                domainItem.className = 'domain-item';
                
                const domainHeader = document.createElement('div');
                domainHeader.className = 'domain-header';
                domainHeader.innerHTML = \`
                    <span>\${domain}</span>
                    <span>📊</span>
                \`;
                domainHeader.onclick = () => selectDomain(domain);
                
                const subDomainList = document.createElement('div');
                subDomainList.className = 'subdomain-list';
                
                for (const subDomain in logicalData[domain]) {
                    const subDomainItem = document.createElement('div');
                    subDomainItem.className = 'subdomain-item';
                    subDomainItem.innerHTML = \`
                        <span>\${subDomain}</span>
                        <span>\${Object.keys(logicalData[domain][subDomain]).length} entities</span>
                    \`;
                    subDomainItem.onclick = (e) => {
                        e.stopPropagation();
                        selectSubDomain(domain, subDomain);
                    };
                    
                    const entityList = document.createElement('div');
                    entityList.className = 'entity-list';
                    
                    for (const entity in logicalData[domain][subDomain]) {
                        const entityItem = document.createElement('div');
                        entityItem.className = 'entity-item';
                        entityItem.textContent = entity;
                        entityItem.onclick = (e) => {
                            e.stopPropagation();
                            selectEntity(domain, subDomain, entity);
                        };
                        entityList.appendChild(entityItem);
                    }
                    
                    subDomainItem.appendChild(entityList);
                    subDomainList.appendChild(subDomainItem);
                }
                
                domainItem.appendChild(domainHeader);
                domainItem.appendChild(subDomainList);
                nav.appendChild(domainItem);
            }
        }
        
        function selectDomain(domain) {
            currentDomain = domain;
            currentSubDomain = null;
            currentEntity = null;
            
            // Update UI
            document.querySelectorAll('.domain-header').forEach(header => header.classList.remove('active'));
            document.querySelectorAll('.subdomain-list').forEach(list => list.classList.remove('active'));
            document.querySelectorAll('.subdomain-item').forEach(item => item.classList.remove('active'));
            document.querySelectorAll('.entity-list').forEach(list => list.classList.remove('active'));
            document.querySelectorAll('.entity-item').forEach(item => item.classList.remove('active'));
            
            // Activate current domain
            event.target.classList.add('active');
            event.target.nextElementSibling.classList.add('active');
            
            // Show domain view
            showDomain(domain);
            
            // If in ERD view, update ERD
            if (currentView === 'erd') {
                renderERD({domain: domain});
            }
        }
        
        function selectSubDomain(domain, subDomain) {
            currentDomain = domain;
            currentSubDomain = subDomain;
            currentEntity = null;
            
            // Update UI
            document.querySelectorAll('.subdomain-item').forEach(item => item.classList.remove('active'));
            document.querySelectorAll('.entity-list').forEach(list => list.classList.remove('active'));
            document.querySelectorAll('.entity-item').forEach(item => item.classList.remove('active'));
            
            // Activate current subdomain
            event.target.classList.add('active');
            event.target.querySelector('.entity-list').classList.add('active');
            
            // Show subdomain view
            showSubDomain(domain, subDomain);
            
            // If in ERD view, update ERD
            if (currentView === 'erd') {
                renderERD({domain: domain, subDomain: subDomain});
            }
        }
        
        function selectEntity(domain, subDomain, entity) {
            currentDomain = domain;
            currentSubDomain = subDomain;
            currentEntity = entity;
            
            // Update UI
            document.querySelectorAll('.entity-item').forEach(item => item.classList.remove('active'));
            event.target.classList.add('active');
            
            // Show entity view
            showEntity(domain, subDomain, entity);
            
            // If in ERD view, update ERD
            if (currentView === 'erd') {
                renderERD({domain: domain, subDomain: subDomain, entity: entity});
            }
        }
        
        function showDomains() {
            const content = document.getElementById('entity-view');
            const breadcrumb = document.getElementById('breadcrumb');
            
            breadcrumb.innerHTML = '<span style="color: #059669;">🏠 All Domains</span>';
            
            let html = '<div class="domain-grid">';
            for (const domain in logicalData) {
                const entityCount = Object.values(logicalData[domain])
                    .reduce((sum, subDomain) => sum + Object.keys(subDomain).length, 0);
                const subDomainCount = Object.keys(logicalData[domain]).length;
                
                html += \`
                    <div class="domain-card" onclick="selectDomain('\${domain}')">
                        <h3>\${domain}</h3>
                        <div class="domain-stats">
                            <div>\${subDomainCount} subdomains</div>
                            <div>\${entityCount} entities</div>
                        </div>
                    </div>
                \`;
            }
            html += '</div>';
            
            content.innerHTML = html;
        }
        
        function showDomain(domain) {
            const content = document.getElementById('entity-view');
            const breadcrumb = document.getElementById('breadcrumb');
            
            breadcrumb.innerHTML = \`
                <span onclick="showDomains()" style="cursor: pointer; color: #059669;">🏠 All Domains</span>
                <span style="color: #666;"> › </span>
                <span style="color: #059669; font-weight: 600;">\${domain}</span>
            \`;
            
            let html = '<div class="domain-grid">';
            for (const subDomain in logicalData[domain]) {
                const entityCount = Object.keys(logicalData[domain][subDomain]).length;
                
                html += \`
                    <div class="domain-card" onclick="selectSubDomain('\${domain}', '\${subDomain}')">
                        <h3>\${subDomain}</h3>
                        <div class="domain-stats">
                            <div>\${entityCount} entities</div>
                        </div>
                    </div>
                \`;
            }
            html += '</div>';
            
            content.innerHTML = html;
        }
        
        function showSubDomain(domain, subDomain) {
            const content = document.getElementById('entity-view');
            const breadcrumb = document.getElementById('breadcrumb');
            
            breadcrumb.innerHTML = \`
                <span onclick="showDomains()" style="cursor: pointer; color: #059669;">🏠 All Domains</span>
                <span style="color: #666;"> › </span>
                <span onclick="selectDomain('\${domain}')" style="cursor: pointer; color: #059669;">\${domain}</span>
                <span style="color: #666;"> › </span>
                <span style="color: #059669; font-weight: 600;">\${subDomain}</span>
            \`;
            
            let html = '<div class="domain-grid">';
            for (const entity in logicalData[domain][subDomain]) {
                const entityData = logicalData[domain][subDomain][entity];
                const attributeCount = entityData.attributes ? entityData.attributes.length : 0;
                
                html += \`
                    <div class="domain-card" onclick="selectEntity('\${domain}', '\${subDomain}', '\${entity}')">
                        <h3>\${entity}</h3>
                        <div class="domain-stats">
                            <div>\${attributeCount} attributes</div>
                        </div>
                    </div>
                \`;
            }
            html += '</div>';
            
            content.innerHTML = html;
        }
        
        function showEntity(domain, subDomain, entity) {
            const content = document.getElementById('entity-view');
            const breadcrumb = document.getElementById('breadcrumb');
            
            breadcrumb.innerHTML = \`
                <span onclick="showDomains()" style="cursor: pointer; color: #059669;">🏠 All Domains</span>
                <span style="color: #666;"> › </span>
                <span onclick="selectDomain('\${domain}')" style="cursor: pointer; color: #059669;">\${domain}</span>
                <span style="color: #666;"> › </span>
                <span onclick="selectSubDomain('\${domain}', '\${subDomain}')" style="cursor: pointer; color: #059669;">\${subDomain}</span>
                <span style="color: #666;"> › </span>
                <span style="color: #059669; font-weight: 600;">\${entity}</span>
            \`;
            
            const entityData = logicalData[domain][subDomain][entity];
            
            let html = \`
                <div class="entity-title">\${entity}</div>
                <div class="entity-section">
                    <h3>📋 Attributes</h3>
                    <table class="attribute-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Constraints</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                \`;
            
            if (entityData.attributes) {
                for (const attr of entityData.attributes) {
                    let constraints = [];
                    if (attr.primaryKey) constraints.push('<span class="pk-badge">PK</span>');
                    if (attr.foreignKey) constraints.push('<span class="fk-badge">FK</span>');
                    if (attr.required) constraints.push('Required');
                    if (attr.unique) constraints.push('Unique');
                    
                    html += \`
                        <tr>
                            <td>\${attr.name}</td>
                            <td>\${attr.type || 'VARCHAR'}</td>
                            <td>\${constraints.join(', ')}</td>
                            <td>\${attr.description || ''}</td>
                        </tr>
                    \`;
                }
            }
            
            html += '</tbody></table></div>';
            
            // Show relationships
            const entityRelationships = relationships.filter(rel => 
                rel.from === entity || rel.to === entity
            );
            
            if (entityRelationships.length > 0) {
                html += \`
                    <div class="entity-section">
                        <h3>🔗 Relationships</h3>
                        <ul class="relationships-list">
                \`;
                
                for (const rel of entityRelationships) {
                    const direction = rel.from === entity ? '→' : '←';
                    const otherEntity = rel.from === entity ? rel.to : rel.from;
                    html += \`
                        <li class="relationship-item">
                            \${entity} \${direction} \${otherEntity} (\${rel.type})
                        </li>
                    \`;
                }
                
                html += '</ul></div>';
            }
            
            content.innerHTML = html;
        }
        
        function resetNavigation() {
            currentDomain = null;
            currentSubDomain = null;
            currentEntity = null;
            
            // Reset UI
            document.querySelectorAll('.domain-header').forEach(header => header.classList.remove('active'));
            document.querySelectorAll('.subdomain-list').forEach(list => list.classList.remove('active'));
            document.querySelectorAll('.subdomain-item').forEach(item => item.classList.remove('active'));
            document.querySelectorAll('.entity-list').forEach(list => list.classList.remove('active'));
            document.querySelectorAll('.entity-item').forEach(item => item.classList.remove('active'));
            
            showDomains();
            
            // If in ERD view, show full ERD
            if (currentView === 'erd') {
                renderERD();
            }
        }
        
        // Make functions global
        window.selectDomain = selectDomain;
        window.selectSubDomain = selectSubDomain;
        window.selectEntity = selectEntity;
        window.resetNavigation = resetNavigation;
        window.switchView = switchView;
        window.zoomIn = zoomIn;
        window.zoomOut = zoomOut;
        window.resetZoom = resetZoom;
        window.downloadERD = downloadERD;
    </script>
</body>
</html>`;
    }

    async saveLogical(fileName = 'logical_INTERACTIVE.html') {
        const html = await this.generateLogical();
        const filePath = path.join(this.outputDir, fileName);
        await writeFile(filePath, html);

        logger.info({ filePath }, 'Logical Model Interactive HTML saved');
        return filePath;
    }

    async savePhysical(fileName = 'physical_INTERACTIVE.html') {
        const html = await this.generatePhysical();
        const filePath = path.join(this.outputDir, fileName);
        await writeFile(filePath, html);

        logger.info({ filePath }, 'Physical Model Interactive HTML saved');
        return filePath;
    }

    async save(fileName = 'erd_INTERACTIVE.html') {
        const html = await this.generate();
        const filePath = path.join(this.outputDir, fileName);
        await writeFile(filePath, html);

        logger.info({ filePath }, 'Interactive HTML ERD saved');
        return filePath;
    }
}
