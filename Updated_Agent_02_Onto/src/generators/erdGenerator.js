/**
 * @Module ERD Generator
 * @Description Generate Entity Relationship Diagrams (ERD) in multiple formats
 * Uses Mermaid.js + Puppeteer to generate PNG, SVG, and PDF
 */

import { writeFile } from 'fs/promises';//to write things.!
import path, { join } from 'path';//For the Path..!
import puppeteer from 'puppeteer';
import logger from '../utils/logger.js';
import config from '../config/index.js';


/**
 * Generate Mermaid ERD syntax from metadata
 */

/**
 * So for the generating the mermaid erd we have to generate the entity and relationships..!
 */

export async function generateMermaidERD(metadata) {
    try {
        logger.info({
            fileId: metadata.fileId,
        }, 'Generating Mermaid ERD from metadata..!');

        let mermaid = 'erDiagram\n';

        //get the tables from the metadata-nested-one..!
        const tables = metadata.metadata.tables;

        //validate check if the tables exist or not..!
        if (!tables || Object.keys(tables).length === 0) {
            throw new Error('No tables found in metadata');
        };

        //generate entity Description..!
        //iterate over each tableName and Data in tables..!
        for (const [tableName, tableData] of Object.entries(tables)) {
            mermaid += generateMermaidEntity(tableName, tableData);
        }

        mermaid += '\n    %% Relationships\n';
        for (const [tableName, tableData] of Object.entries(tables)) {
            mermaid += generateMermaidRelationships(tableName, tableData);
        }
        logger.info({
            fileId: metadata.fileId,
        },
            "Mermaid ERD-Generated-Successfully..!")
        return mermaid;


    } catch (error) {
        logger.error({
            error: error.message,
            fileId: metadata?.fileId,
        }, 'Failed-to-Generate-Mermaid-ERD..!')
        throw error;
    }
}

/**
 * Generate Mermaid entity definition
 */

function generateMermaidEntity(tableName, tableData) {
    let mermaid = `    ${sanitizeMermaidName(tableName)} {\n`;
    
    //Show ALL columns (no limit) - configurable via environment
    const columnLimit = parseInt(process.env.ERD_COLUMN_LIMIT || '9999', 10);
    const columnsToShow = tableData.columns.slice(0, columnLimit);
    
    for (const column of columnsToShow) {
        //get the datatype or take the varchar only..!
        const dataType = (column.dataType || 'VARCHAR').toLowerCase();
        const colName = sanitizeMermaidName(column.columnName);

        /**
         * After we have pushed the columnname and data-Type...!
         * we can start pushing the attrtibutes..!
         */
        let attributes = [];
        if (column.isPrimaryKey) attributes.push("PK");
        if (column.isForeignKey) attributes.push("FK");

        //if the length is > 0 join with "," else empty..!
        const attrStr = attributes.length > 0 ? ` "${attributes.join(',')}"` : '';
        mermaid += `        ${dataType} ${colName}${attrStr}\n`;
    }
    
    if (tableData.columns.length > columnLimit) {
        //if more than limit then show remaining count..!
        mermaid += `        string "... ${tableData.columns.length - columnLimit} more columns"\n`;
    }

    mermaid += '    }\n\n';

    return mermaid;
}

/**
 * Generate Mermaid relationships
 */

//so its basically the  flow from source to destination..!s

function generateMermaidRelationships(tableName, tableData) {
    let mermaid = '';

    for (const column of tableData.columns) {
        if (column.isForeignKey && column.referencesTable && column.referencesColumn) {
            const fromTable = sanitizeMermaidName(tableName);
            const toTable = sanitizeMermaidName(column.referencesTable);

            //many to one relationship..!
            mermaid += `    ${fromTable} }o--|| ${toTable} : "references"\n`;
        }
    }
    return mermaid;
}

/**
 * Sanitize name for Mermaid (remove spaces and special chars)
 */
function sanitizeMermaidName(name) {
    //it should be from a-z-A-Z 0-9 and underscore..!
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Generate ERD images (PNG, SVG, PDF) using Puppeteer
 */

export async function generateERDImages(fileId, mermaidContent) {
    let browser;

    try {
        logger.info({
            fileId: fileId
        }, "Generating ERD Images..!")

        //we will call the puppeter here..!
        // Use MS Edge (already installed on Windows)
        const edgePath = process.env.PUPPETEER_EXECUTABLE_PATH || 
                        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        
        logger.info({ fileId, browser: 'MS Edge' }, 'Using Microsoft Edge for rendering');
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: edgePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();//Try to open the new page..!
        await page.setViewport({ width: 1920, height: 1080 });//set the viewport..!
        
        //create the html with mermaid..!
        const html = createMermaidHTML(mermaidContent);
        //the page will set the content of the mermaidContent..!
        await page.setContent(html, { waitUntil: 'networkidle0' });

        // Wait for Mermaid to render
        await page.waitForSelector('#mermaid-diagram svg', {
            timeout: 30000,
        });
        //maek the path file here..!
        const artifacts = join(config.storage.artifactsDir, fileId);


        //get-Svg-content..!
        const svgContent = await page.evaluate(() => {
            //evaluate the page..!
            const svg = document.querySelector('#mermaid-diagram svg');//means the svg is there..!
            //if the svg is there get the html or else null;!
            return svg ? svg.outerHTML : null;
        });
        if (!svgContent) {
            throw new Error('Failed to render Mermaid diagram');
        }

        //SAVE THE SVG..!
        const svgPath = join(artifacts, 'erd.svg');
        //we will save at the artifacts location with the name erd.svg....!
        await writeFile(svgPath, svgContent, 'utf-8');
        //the utf means encoding..!
        logger.info({
            fileId: fileId,
            path: svgPath
        }, "ERD-SVG-Saved-Successfully..!")


        // Generate PNG
        const element = await page.$('#mermaid-diagram svg');
        const pngPath = join(artifacts, 'erd.png');
        await element.screenshot({ path: pngPath, omitBackground: true });
        logger.info({ fileId, path: pngPath }, 'PNG saved');

        //generate pdf..!
        const pdfPath = join(artifacts, "erd.pdf");
        await page.pdf({
            path: pdfPath,
            format: "A4",
            landscape: true,
            printBackground: true
        });
        logger.info({
            fileId: fileId,
            path: pdfPath,
        }, "Pdf-Saved");


        return {
            svg: svgPath,
            png: pngPath,
            pdf: pdfPath,

        }
    } catch (error) {
        logger.error({
            error: error.message,
            fileId: fileId,
        }, 'Failed-to-Generate-ERD-Images..!')
        throw error;
    } finally {
        //if the puppeter is there then close it..!
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Create HTML with Mermaid diagram
 */
function createMermaidHTML(mermaidContent) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
        mermaid.initialize({ 
            startOnLoad: true,
            theme: 'default',
            er: {
                fontSize: 14,
                useMaxWidth: true
            }
        });
    </script>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: white;
            font-family: Arial, sans-serif;
        }
        #mermaid-diagram {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
    </style>
</head>
<body>
    <div id="mermaid-diagram">
        <pre class="mermaid">
${mermaidContent}
        </pre>
    </div>
</body>
</html>
    `;
}

/**
 * Save Mermaid source to file
 */
export async function saveMermaidERD(fileId, mermaidContent) {
    try {
        const artifactDir = join(config.storage.artifactsDir, fileId);
        const mermaidPath = join(artifactDir, 'erd.mmd');
        
        await writeFile(mermaidPath, mermaidContent, 'utf-8');
        
        logger.info({ fileId, path: mermaidPath }, 'Mermaid ERD saved');
        
        return mermaidPath;
    } catch (error) {
        logger.error({ error: error.message, fileId }, 'Failed to save Mermaid ERD');
        throw error;
    }
}