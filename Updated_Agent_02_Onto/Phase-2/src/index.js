import path from 'path';
import { readJSON } from './utils/fileUtils.js';
import { Metadata, Table, Column } from './models/Metadata.js';
import { MySQLGenerator } from './generators/MySQLGenerator.js';
import { ensureFolders } from './utils/folderOrganizer.js';
import config from './config.js';
import logger from './utils/logger.js';
import fs from 'fs';

async function loadMetadata(fileId) {
    // Try new organized location first, then fallback to old location
    const newPath = path.join(config.phase1ArtifactsDir, fileId, 'json', 'metadata.json');
    const oldPath = path.join(config.phase1ArtifactsDir, fileId, 'metadata.json');
    
    const metadataPath = fs.existsSync(newPath) ? newPath : oldPath;
    
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`Metadata not found: ${metadataPath}`);
    }
    
    logger.info(`Loading metadata from: ${metadataPath}`);
    const rawData = await readJSON(metadataPath);
    
    const metadata = new Metadata(fileId);
    const tablesData = rawData.metadata?.tables || {};
    
    for (const [tableName, tableInfo] of Object.entries(tablesData)) {
        const table = new Table(tableName, tableInfo.description);
        
        for (const colData of tableInfo.columns || []) {
            const column = new Column({
                name: colData.columnName,
                dataType: colData.dataType || 'VARCHAR',
                isPrimaryKey: colData.isPrimaryKey || false,
                isForeignKey: colData.isForeignKey || false,
                isNullable: colData.nullable !== false,
                isUnique: colData.isUnique || false,
                defaultValue: colData.defaultValue,
                referencesTable: colData.referencesTable,
                referencesColumn: colData.referencesColumn,
                description: colData.description
            });
            table.addColumn(column);
        }
        
        metadata.addTable(table);
    }
    
    logger.info(`✓ Loaded ${metadata.tableCount} tables, ${metadata.totalColumns} columns`);
    return metadata;
}

async function generatePhysicalModel(fileId) {
    console.log('\n🚀 Phase-2: MySQL Physical Model Generator (Node.js)\n');
    console.log(`File ID: ${fileId}\n`);
    console.log('⚠️  Note: This script is deprecated. Use generate-complete.js instead.\n');
    
    const metadata = await loadMetadata(fileId);
    
    // Use organized folders
    const paths = await ensureFolders(fileId);
    
    const results = {};
    
    // Generate MySQL SQL DDL (only if not exists)
    if (config.generateSQL) {
        const sqlPath = path.join(paths.physical, 'mysql.sql');
        
        if (!fs.existsSync(sqlPath)) {
            console.log('📝 Generating MySQL DDL...');
            const mysqlGen = new MySQLGenerator(metadata, paths.physical);
            const savedPath = await mysqlGen.save('mysql.sql');
            results.mysql_sql = savedPath;
            console.log(`✅ MySQL DDL saved: ${savedPath}`);
        } else {
            console.log('✅ MySQL DDL already exists, skipping');
            results.mysql_sql = sqlPath;
        }
    }
    
    console.log('\n✅ Phase-2 Complete!\n');
    console.log('Generated Files:');
    for (const [key, filePath] of Object.entries(results)) {
        console.log(`  • ${key}: ${path.basename(filePath)}`);
    }
    console.log('\n💡 Tip: Use "node generate-complete.js" for complete generation with executive outputs.\n');
    
    return results;
}

// Main execution
const fileId = process.argv[2];

if (!fileId) {
    console.error('❌ Error: Missing file ID');
    console.log('\nUsage: node src/index.js <fileId>');
    console.log('Example: node src/index.js 1768458755700');
    process.exit(1);
}

generatePhysicalModel(fileId)
    .then(() => process.exit(0))
    .catch(error => {
        logger.error(`Generation failed: ${error.message}`);
        console.error(`\n❌ Error: ${error.message}`);
        process.exit(1);
    });

