#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Metadata, Table, Column } from './src/models/Metadata.js';
import { MySQLGenerator } from './src/generators/MySQLGenerator.js';
import { ensureFolders } from './src/utils/folderOrganizer.js';
import { readJSON } from './src/utils/fileUtils.js';
import config from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fileId = process.argv[2];
if (!fileId) {
    console.error('❌ Error: Missing file ID');
    console.log('\nUsage: node generate.js <fileId>');
    console.log('Example: node generate.js 1769680051445');
    process.exit(1);
}

const artifactPath = path.join(__dirname, '../Phase-1/artifacts', fileId);
const metadataPath = path.join(artifactPath, 'json/metadata.json');
const executiveDir = path.join(artifactPath, 'executive');
const logicalDir = path.join(artifactPath, 'logical');
const outputPath = path.join(executiveDir, 'DATA_MODEL_DUAL_ENHANCED.html');

console.log('\n🚀 UNIVERSAL DATA MODEL GENERATOR\n');
console.log(`File ID: ${fileId}`);
console.log(`Looking for metadata at: ${metadataPath}`);

// Ensure executive directory exists
if (!fs.existsSync(executiveDir)) {
    fs.mkdirSync(executiveDir, { recursive: true });
    console.log(`✓ Created executive directory: ${executiveDir}`);
}

if (!fs.existsSync(metadataPath)) {
    console.error('\n❌ Metadata file not found!');
    console.error(`   Expected path: ${metadataPath}`);
    console.error(`   Artifact directory exists: ${fs.existsSync(artifactPath)}`);
    if (fs.existsSync(artifactPath)) {
        console.error(`   Contents of artifact directory:`);
        try {
            const contents = fs.readdirSync(artifactPath);
            contents.forEach(item => {
                const itemPath = path.join(artifactPath, item);
                const isDir = fs.statSync(itemPath).isDirectory();
                console.error(`     ${isDir ? '📁' : '📄'} ${item}`);
            });
        } catch (err) {
            console.error(`     Error reading directory: ${err.message}`);
        }
    }
    process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
const tables = metadata.metadata.tables;
const tableNames = Object.keys(tables);

// Build domain structure
const domainMap = {};
const tableDefinitions = {};

for (const [tableName, tableData] of Object.entries(tables)) {
    const domain = tableData.domain || 'Uncategorized';
    const subDomain = tableData.subDomain || domain;
    
    if (!domainMap[domain]) {
        domainMap[domain] = {};
    }
    if (!domainMap[domain][subDomain]) {
        domainMap[domain][subDomain] = [];
    }
    domainMap[domain][subDomain].push(tableName);
    
    tableDefinitions[tableName] = {
        name: tableName,
        domain,
        subDomain,
        description: tableData.entityDescription || '',
        columns: (tableData.columns || []).map((col, idx) => ({
            name: col.columnName || col.attributeName || `column_${idx}`,
            type: col.dataType || 'VARCHAR',
            key: col.isPrimaryKey ? 'PK' : col.isForeignKey ? 'FK' : '',
            description: col.description || col.attributeDescription || ''
        }))
    };
}

// Find relationships
const relationships = [];
const seenRels = new Set();

for (const [tableName, tableDef] of Object.entries(tableDefinitions)) {
    for (const col of tableDef.columns) {
        if (col.key === 'FK') {
            for (const potentialTarget of tableNames) {
                if (potentialTarget !== tableName) {
                    const colNameBase = col.name.replace(/_id$/, '');
                    if (potentialTarget.includes(colNameBase) || colNameBase.includes(potentialTarget)) {
                        const relKey = [tableName, potentialTarget].sort().join('->');
                        if (!seenRels.has(relKey)) {
                            relationships.push({
                                from: tableName,
                                to: potentialTarget,
                                type: '1:N',
                                label: col.name
                            });
                            seenRels.add(relKey);
                            break;
                        }
                    }
                }
            }
        }
    }
}

console.log(`✓ Loaded ${tableNames.length} tables`);
console.log(`✓ Found ${Object.keys(domainMap).length} domains`);
console.log(`✓ Found ${relationships.length} relationships\n`);

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dual Interactive Data Model - Physical & Logical ERD</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8f9fa; }
        body { display: flex; flex-direction: column; }
        
        /* Sidebar */
        #sidebar { position: fixed; left: -320px; top: 50px; width: 320px; height: calc(100vh - 50px); background: linear-gradient(180deg, #2c3e50 0%, #34495e 100%); color: white; overflow-y: auto; padding: 15px; border-right: 2px solid #1a252f; transition: left 0.3s ease; z-index: 1000; box-shadow: 2px 0 8px rgba(0, 0, 0, 0.2); }
        #sidebar.open { left: 0; }
        
        .sidebar-header { font-size: 12px; font-weight: 600; margin: 12px 0 8px; color: #ecf0f1; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 2px solid #34495e; }
        
        .domain-group { margin-bottom: 10px; }
        
        .domain-name { font-weight: 600; padding: 8px 10px; background: #34495e; border-radius: 4px; margin-bottom: 4px; cursor: pointer; user-select: none; font-size: 11px; transition: all 0.2s; }
        .domain-name:hover { background: #3d5567; transform: translateX(2px); }
        .domain-name.expanded::before { content: '▼ '; }
        .domain-name:not(.expanded)::before { content: '▶ '; }
        
        .subdomains-container { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
        .subdomains-container.open { max-height: 1000px; }
        
        .subdomain-name { padding-left: 15px; padding: 4px 8px 4px 20px; font-size: 10px; color: #bdc3c7; margin: 2px 0; cursor: pointer; transition: color 0.2s; border-radius: 2px; }
        .subdomain-name:hover { color: #ecf0f1; font-weight: 600; background: rgba(255,255,255,0.1); }
        .subdomain-name.expanded::before { content: '▼ '; }
        .subdomain-name:not(.expanded)::before { content: '▶ '; }
        
        .entities-container { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
        .entities-container.open { max-height: 1000px; }
        
        .entity-item { padding-left: 40px; padding: 3px 8px 3px 40px; font-size: 9px; color: #95a5a6; margin: 1px 0; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.2s; border-radius: 2px; }
        .entity-item:hover { color: #f39c12; font-weight: 600; padding-left: 42px; background: rgba(243,156,18,0.1); }
        .entity-item.active { color: #2ecc71; font-weight: 600; background: rgba(46, 204, 113, 0.15); border-left: 3px solid #2ecc71; padding-left: 37px; }
        
        /* Toolbar */
        #toolbar { background: linear-gradient(90deg, #3498db 0%, #2980b9 100%); color: white; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1a5f9c; flex-shrink: 0; height: 50px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
        #toolbar-left { display: flex; gap: 10px; align-items: center; }
        #toolbar-middle { display: flex; gap: 8px; align-items: center; flex: 1; justify-content: center; }
        #toolbar-right { display: flex; gap: 6px; }
        
        .toolbar-btn { padding: 8px 12px; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 11px; transition: all 0.2s; font-weight: 500; }
        .toolbar-btn:hover { background: rgba(255, 255, 255, 0.3); transform: translateY(-1px); }
        .toolbar-btn.active { background: rgba(255, 255, 255, 0.4); border-color: white; }
        
        #toggle-sidebar { background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: all 0.2s; }
        #toggle-sidebar:hover { background: rgba(255, 255, 255, 0.3); transform: translateY(-1px); }
        
        #toolbar-title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        
        /* Canvas Container */
        #canvas-container { flex: 1; position: relative; overflow: hidden; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); cursor: grab; }
        #canvas-container.panning { cursor: grabbing; }
        
        #canvas { position: absolute; background: white; cursor: inherit; top: 0; left: 0; will-change: transform; }
        
        /* Info Panel */
        #info-panel { position: fixed; bottom: 20px; right: 20px; background: white; border: 1px solid #bdc3c7; border-radius: 6px; padding: 15px; max-width: 380px; max-height: 450px; overflow-y: auto; font-size: 11px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); z-index: 500; display: none; animation: slideIn 0.2s ease; }
        #info-panel.visible { display: block; }
        
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        .info-header { font-weight: 600; margin-bottom: 10px; color: #3498db; font-size: 12px; border-bottom: 2px solid #ecf0f1; padding-bottom: 8px; }
        .info-item { margin: 4px 0; color: #555; line-height: 1.3; }
        .info-item strong { color: #2c3e50; }
        
        .close-info { position: absolute; top: 10px; right: 10px; background: #ecf0f1; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-weight: bold; color: #555; transition: all 0.2s; }
        .close-info:hover { background: #bdc3c7; color: white; }
        
        /* SVG Styles */
        .table-rect { fill: #ecf0f1; stroke: #34495e; stroke-width: 1.5; }
        .table-rect:hover { fill: #d5dbdb; stroke-width: 2; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1)); }
        .table-rect.selected { fill: #fff9e6; stroke: #f39c12; stroke-width: 2.5; filter: drop-shadow(0 2px 6px rgba(243, 156, 18, 0.3)); }
        
        .table-header { fill: #3498db; stroke: none; }
        .table-name { font-weight: 600; font-size: 11px; fill: white; }
        .column-text { font-size: 10px; fill: #2c3e50; font-family: 'Courier New', monospace; }
        .pk-column { fill: #27ae60; font-weight: 600; }
        .fk-column { fill: #e74c3c; }
        
        .relationship-line { stroke: #95a5a6; stroke-width: 1.5; fill: none; opacity: 0.6; }
        .relationship-line:hover { stroke-width: 2.5; opacity: 1; stroke: #3498db; }
        .cardinality-box { fill: white; stroke: #95a5a6; stroke-width: 1; }
        .cardinality-text { font-size: 9px; fill: #2c3e50; text-anchor: middle; font-weight: 600; }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #ecf0f1; }
        ::-webkit-scrollbar-thumb { background: #bdc3c7; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #95a5a6; }
    </style>
</head>
<body>
    <!-- Sidebar -->
    <div id="sidebar">
        <div class="sidebar-header">📊 Navigate</div>
        <div id="domain-tree"></div>
    </div>
    
    <!-- Toolbar -->
    <div id="toolbar">
        <div id="toolbar-left">
            <button id="toggle-sidebar" onclick="toggleSidebar()">☰ Menu</button>
        </div>
        <div id="toolbar-middle">
            <span id="toolbar-title">📊 Data Model</span>
            <span id="model-badge" style="font-size: 10px; opacity: 0.8; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 3px;">PHYSICAL</span>
        </div>
        <div id="toolbar-right">
            <button class="toolbar-btn" id="toggle-model" onclick="toggleModel()" title="Toggle Physical/Logical">🔄 Logical</button>
            <button class="toolbar-btn" onclick="zoomIn()" title="Zoom In">🔍+</button>
            <button class="toolbar-btn" onclick="zoomOut()" title="Zoom Out">🔍−</button>
            <button class="toolbar-btn" onclick="fitView()" title="Fit All">📍 Fit</button>
            <button class="toolbar-btn" onclick="resetView()" title="Reset">↺ Reset</button>
        </div>
    </div>
    
    <!-- Canvas -->
    <div id="canvas-container">
        <svg id="canvas" width="15000" height="12000">
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 10 3, 0 6" fill="#95a5a6"/>
                </marker>
            </defs>
            <g id="diagram"></g>
        </svg>
    </div>
    
    <!-- Info Panel -->
    <div id="info-panel">
        <button class="close-info" onclick="hideInfo()">×</button>
        <div id="info-content"></div>
    </div>
    
    <script>
        const tableDefinitions = ${JSON.stringify(tableDefinitions, null, 2)};
        const domainMap = ${JSON.stringify(domainMap, null, 2)};
        const relationships = ${JSON.stringify(relationships, null, 2)};
        
        let canvas = document.getElementById('canvas');
        let canvasContainer = document.getElementById('canvas-container');
        let zoomLevel = 0.6;
        let panX = 0, panY = 0;
        let isPanning = false;
        let lastX = 0, lastY = 0;
        let velocityX = 0, velocityY = 0;
        let tablePositions = {};
        let selectedTable = null;
        let currentModel = 'physical';
        let isAnimating = false;
        
        window.addEventListener('DOMContentLoaded', () => {
            initSidebar();
            renderDiagram();
            setupCanvasEvents();
            resetView();
        });
        
        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
        }
        
        function toggleModel() {
            currentModel = currentModel === 'physical' ? 'logical' : 'physical';
            document.getElementById('model-badge').textContent = currentModel === 'physical' ? 'PHYSICAL' : 'LOGICAL';
            document.getElementById('toggle-model').textContent = currentModel === 'physical' ? '🔄 Logical' : '🔄 Physical';
            renderDiagram();
            hideInfo();
        }
        
        function initSidebar() {
            const tree = document.getElementById('domain-tree');
            tree.innerHTML = '';
            
            let domainIdx = 0;
            for (const [domain, subdomains] of Object.entries(domainMap)) {
                const domainDiv = document.createElement('div');
                domainDiv.className = 'domain-group';
                
                const domainName = document.createElement('div');
                domainName.className = 'domain-name';
                domainName.textContent = domain;
                domainName.onclick = (e) => {
                    e.stopPropagation();
                    const subContainer = domainName.nextElementSibling;
                    const isOpen = subContainer.classList.contains('open');
                    subContainer.classList.toggle('open');
                    domainName.classList.toggle('expanded');
                };
                
                if (domainIdx === 0) {
                    domainName.classList.add('expanded');
                }
                domainDiv.appendChild(domainName);
                
                const subdomainsContainer = document.createElement('div');
                subdomainsContainer.className = 'subdomains-container';
                if (domainIdx === 0) subdomainsContainer.classList.add('open');
                
                for (const [subdomain, tables] of Object.entries(subdomains)) {
                    const subdomainName = document.createElement('div');
                    subdomainName.className = 'subdomain-name';
                    subdomainName.textContent = subdomain;
                    subdomainName.onclick = (e) => {
                        e.stopPropagation();
                        const entContainer = subdomainName.nextElementSibling;
                        const isOpen = entContainer.classList.contains('open');
                        entContainer.classList.toggle('open');
                        subdomainName.classList.toggle('expanded');
                    };
                    subdomainsContainer.appendChild(subdomainName);
                    
                    const entitiesContainer = document.createElement('div');
                    entitiesContainer.className = 'entities-container';
                    
                    for (const table of tables) {
                        const entityItem = document.createElement('div');
                        entityItem.className = 'entity-item';
                        entityItem.textContent = table;
                        entityItem.onclick = (e) => {
                            e.stopPropagation();
                            selectTable(table);
                        };
                        entitiesContainer.appendChild(entityItem);
                    }
                    
                    subdomainsContainer.appendChild(entitiesContainer);
                }
                
                domainDiv.appendChild(subdomainsContainer);
                tree.appendChild(domainDiv);
                domainIdx++;
            }
        }
        
        function renderDiagram() {
            const diagram = document.getElementById('diagram');
            diagram.innerHTML = '';
            tablePositions = {};
            
            // Background group for relationships (drawn first, behind tables)
            const relGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            relGroup.setAttribute('id', 'relationships-group');
            diagram.appendChild(relGroup);
            
            // Foreground group for tables (drawn on top)
            const tableGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tableGroup.setAttribute('id', 'tables-group');
            diagram.appendChild(tableGroup);
            
            const cols = Math.ceil(Math.sqrt(Object.keys(tableDefinitions).length));
            let idx = 0;
            
            for (const [tableName, tableDef] of Object.entries(tableDefinitions)) {
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                const x = col * 550 + 50;
                const y = row * 360 + 50;
                
                tablePositions[tableName] = { x, y };
                drawTable(tableGroup, tableName, x, y);
                idx++;
            }
            
            // Draw relationships in background group
            relationships.forEach(rel => {
                if (tablePositions[rel.from] && tablePositions[rel.to]) {
                    drawRelationship(relGroup, rel, tablePositions);
                }
            });
        }
        
        function drawTable(group, tableName, x, y) {
            const tableGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tableGroup.setAttribute('transform', \`translate(\${x}, \${y})\`);
            tableGroup.style.cursor = 'pointer';
            
            const tableDef = tableDefinitions[tableName];
            const columns = tableDef.columns;
            const height = 45 + columns.length * 16;
            
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('width', '450');
            rect.setAttribute('height', height.toString());
            rect.setAttribute('class', 'table-rect');
            rect.setAttribute('rx', '4');
            rect.setAttribute('data-table', tableName);
            rect.addEventListener('click', (e) => { e.stopPropagation(); selectTable(tableName); });
            tableGroup.appendChild(rect);
            
            const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            headerRect.setAttribute('width', '450');
            headerRect.setAttribute('height', '32');
            headerRect.setAttribute('class', 'table-header');
            headerRect.setAttribute('rx', '3');
            tableGroup.appendChild(headerRect);
            
            const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            nameText.setAttribute('x', '10');
            nameText.setAttribute('y', '20');
            nameText.setAttribute('class', 'table-name');
            nameText.textContent = tableName;
            tableGroup.appendChild(nameText);
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '0');
            line.setAttribute('y1', '37');
            line.setAttribute('x2', '450');
            line.setAttribute('y2', '37');
            line.setAttribute('stroke', '#d1fae5');
            line.setAttribute('stroke-width', '1');
            tableGroup.appendChild(line);
            
            columns.forEach((col, idx) => {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '10');
                text.setAttribute('y', \`\${53 + idx * 16}\`);
                text.setAttribute('class', \`column-text \${col.key === 'PK' ? 'pk-column' : col.key === 'FK' ? 'fk-column' : ''}\`);
                text.textContent = \`\${col.key ? '[' + col.key + '] ' : ''}\${col.name}\${currentModel === 'physical' ? ': ' + col.type : ''}\`;
                tableGroup.appendChild(text);
            });
            
            group.appendChild(tableGroup);
        }
        
        function drawRelationship(group, rel, positions) {
            const fromPos = positions[rel.from];
            const toPos = positions[rel.to];
            
            if (!fromPos || !toPos) return;
            
            const x1 = fromPos.x + 450;
            const y1 = fromPos.y + 100;
            const x2 = toPos.x;
            const y2 = toPos.y + 50;
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1.toString());
            line.setAttribute('y1', y1.toString());
            line.setAttribute('x2', x2.toString());
            line.setAttribute('y2', y2.toString());
            line.setAttribute('class', 'relationship-line');
            group.appendChild(line);
            
            // Crow's foot notation - add the crow's foot shape near the target
            const footLength = 12;
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const footX = x2 - footLength * Math.cos(angle);
            const footY = y2 - footLength * Math.sin(angle);
            
            // Draw crow's foot (three lines at end)
            const foot1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            foot1.setAttribute('x1', footX.toString());
            foot1.setAttribute('y1', (footY - 8).toString());
            foot1.setAttribute('x2', x2.toString());
            foot1.setAttribute('y2', y2.toString());
            foot1.setAttribute('class', 'relationship-line');
            group.appendChild(foot1);
            
            const foot2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            foot2.setAttribute('x1', footX.toString());
            foot2.setAttribute('y1', (footY + 8).toString());
            foot2.setAttribute('x2', x2.toString());
            foot2.setAttribute('y2', y2.toString());
            foot2.setAttribute('class', 'relationship-line');
            group.appendChild(foot2);
            
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            
            const cardBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            cardBox.setAttribute('x', (midX - 20).toString());
            cardBox.setAttribute('y', (midY - 10).toString());
            cardBox.setAttribute('width', '40');
            cardBox.setAttribute('height', '20');
            cardBox.setAttribute('class', 'cardinality-box');
            group.appendChild(cardBox);
            
            const cardText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            cardText.setAttribute('x', midX.toString());
            cardText.setAttribute('y', (midY + 4).toString());
            cardText.setAttribute('class', 'cardinality-text');
            cardText.textContent = rel.type;
            group.appendChild(cardText);
        }
        
        function selectTable(tableName) {
            document.querySelectorAll('.table-rect').forEach(rect => rect.classList.remove('selected'));
            document.querySelectorAll('.entity-item').forEach(item => item.classList.remove('active'));
            
            selectedTable = tableName;
            const rect = document.querySelector(\`[data-table="\${tableName}"]\`);
            if (rect) rect.classList.add('selected');
            
            document.querySelectorAll('.entity-item').forEach(item => {
                if (item.textContent === tableName) item.classList.add('active');
            });
            
            // Auto-focus on selected table with smooth animation
            const pos = tablePositions[tableName];
            if (pos) {
                const containerWidth = canvasContainer.clientWidth;
                const containerHeight = canvasContainer.clientHeight;
                const targetPanX = containerWidth / 2 - pos.x * zoomLevel;
                const targetPanY = containerHeight / 2 - pos.y * zoomLevel;
                
                animatePan(panX, panY, targetPanX, targetPanY, 500);
            }
            
            showInfo(tableName);
        }
        
        function animatePan(fromX, fromY, toX, toY, duration) {
            if (isAnimating) return;
            isAnimating = true;
            const startTime = Date.now();
            
            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easeProgress = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                
                panX = fromX + (toX - fromX) * easeProgress;
                panY = fromY + (toY - fromY) * easeProgress;
                updateTransform();
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    isAnimating = false;
                }
            };
            
            animate();
        }
        
        function showInfo(tableName) {
            const tableDef = tableDefinitions[tableName];
            const panel = document.getElementById('info-panel');
            const content = document.getElementById('info-content');
            
            let html = \`<div class="info-header">\${currentModel === 'physical' ? '📊 Table' : '📋 Entity'}: \${tableName}</div>\`;
            html += \`<div class="info-item"><strong>Domain:</strong> \${tableDef.domain}</div>\`;
            html += \`<div class="info-item"><strong>Sub-Domain:</strong> \${tableDef.subDomain}</div>\`;
            html += \`<div class="info-item"><strong>\${currentModel === 'physical' ? 'Columns' : 'Attributes'}:</strong> \${tableDef.columns.length}</div>\`;
            
            if (tableDef.description) {
                html += \`<div class="info-item" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ecf0f1;"><strong>Description:</strong><br/><em style="font-size: 10px;">\${tableDef.description}</em></div>\`;
            }
            
            html += \`<div class="info-item" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ecf0f1;"><strong>\${currentModel === 'physical' ? 'Columns' : 'Attributes'}:</strong></div>\`;
            
            tableDef.columns.forEach(col => {
                const keyLabel = col.key ? \` [\${col.key}]\` : '';
                if (currentModel === 'physical') {
                    html += \`<div class="info-item" style="margin-left: 5px; font-size: 10px;"><strong>\${col.name}</strong>\${keyLabel}<br/><small style="color: #95a5a6;">\${col.type}</small></div>\`;
                } else {
                    html += \`<div class="info-item" style="margin-left: 5px; font-size: 10px;"><strong>\${col.name}</strong>\${keyLabel}</div>\`;
                }
            });
            
            content.innerHTML = html;
            panel.classList.add('visible');
        }
        
        function hideInfo() {
            document.getElementById('info-panel').classList.remove('visible');
            document.querySelectorAll('.table-rect').forEach(rect => rect.classList.remove('selected'));
        }
        
        function setupCanvasEvents() {
            canvasContainer.addEventListener('wheel', (e) => {
                e.preventDefault();
                const rect = canvasContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const factor = e.deltaY > 0 ? 0.92 : 1.08;
                
                zoomLevel *= factor;
                zoomLevel = Math.max(0.1, Math.min(zoomLevel, 5));
                
                panX -= (x / zoomLevel) * (factor - 1);
                panY -= (y / zoomLevel) * (factor - 1);
                
                updateTransform();
            }, { passive: false });
            
            canvasContainer.addEventListener('mousedown', (e) => {
                if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
                    isPanning = true;
                    lastX = e.clientX;
                    lastY = e.clientY;
                    velocityX = 0;
                    velocityY = 0;
                    canvasContainer.classList.add('panning');
                }
            });
            
            canvasContainer.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    const dx = (e.clientX - lastX) / zoomLevel;
                    const dy = (e.clientY - lastY) / zoomLevel;
                    
                    velocityX = dx;
                    velocityY = dy;
                    
                    panX += dx;
                    panY += dy;
                    lastX = e.clientX;
                    lastY = e.clientY;
                    updateTransform();
                }
            });
            
            canvasContainer.addEventListener('mouseup', () => {
                if (isPanning) {
                    isPanning = false;
                    canvasContainer.classList.remove('panning');
                    applyInertia();
                }
            });
            
            canvasContainer.addEventListener('mouseleave', () => {
                if (isPanning) {
                    isPanning = false;
                    canvasContainer.classList.remove('panning');
                    applyInertia();
                }
            });
            
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey) {
                    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
                    else if (e.key === '-') { e.preventDefault(); zoomOut(); }
                    else if (e.key === '0') { e.preventDefault(); fitView(); }
                }
            });
        }
        
        function applyInertia() {
            let decayVX = velocityX;
            let decayVY = velocityY;
            
            const inertiaFrame = () => {
                decayVX *= 0.95;
                decayVY *= 0.95;
                
                panX += decayVX;
                panY += decayVY;
                updateTransform();
                
                if (Math.abs(decayVX) > 0.1 || Math.abs(decayVY) > 0.1) {
                    requestAnimationFrame(inertiaFrame);
                }
            };
            
            requestAnimationFrame(inertiaFrame);
        }
        
        function zoomIn() { zoomLevel = Math.min(zoomLevel * 1.2, 5); updateTransform(); }
        function zoomOut() { zoomLevel = Math.max(zoomLevel / 1.2, 0.1); updateTransform(); }
        function fitView() { zoomLevel = 0.45; panX = 0; panY = 0; updateTransform(); }
        function resetView() { zoomLevel = 0.6; panX = 0; panY = 0; updateTransform(); }
        
        function updateTransform() {
            canvas.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoomLevel})\`;
            canvas.style.transformOrigin = '0 0';
        }
        
        canvasContainer.addEventListener('click', (e) => {
            if (e.target === canvasContainer || e.target === canvas) {
                hideInfo();
            }
        });
    </script>
</body>
</html>`;

fs.writeFileSync(outputPath, htmlTemplate);

const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
console.log(`✅ Generated: DATA_MODEL_DUAL_ENHANCED.html (${sizeKB} KB)\n`);

// Generate MySQL DDL and cleanup
(async () => {
    // Generate MySQL DDL
    console.log('📝 Generating MySQL DDL...');
    try {
        // Load metadata for DDL generation
        const rawData = await readJSON(metadataPath);
        const metadata = new Metadata(fileId);
        const tablesData = rawData.metadata?.tables || {};
        
        for (const [tableName, tableInfo] of Object.entries(tablesData)) {
            const table = new Table(tableName, tableInfo.entityDescription || tableInfo.description);
            
            for (const colData of tableInfo.columns || []) {
                const column = new Column({
                    name: colData.columnName || colData.attributeName,
                    dataType: colData.dataType || 'VARCHAR',
                    isPrimaryKey: colData.isPrimaryKey || false,
                    isForeignKey: colData.isForeignKey || false,
                    isNullable: colData.nullable !== false,
                    isUnique: colData.isUnique || false,
                    defaultValue: colData.defaultValue,
                    referencesTable: colData.referencesTable,
                    referencesColumn: colData.referencesColumn,
                    description: colData.description || colData.attributeDescription
                });
                table.addColumn(column);
            }
            
            metadata.addTable(table);
        }
        
        // Ensure folders exist - use correct artifact path
        const physicalDir = path.join(artifactPath, 'physical');
        if (!fs.existsSync(physicalDir)) {
            fs.mkdirSync(physicalDir, { recursive: true });
        }
        
        // Generate MySQL SQL DDL
        const mysqlGen = new MySQLGenerator(metadata, physicalDir);
        const sqlPath = await mysqlGen.save('mysql.sql');
        
        const sqlSizeKB = (fs.statSync(sqlPath).size / 1024).toFixed(1);
        console.log(`✅ Generated: mysql.sql (${sqlSizeKB} KB)`);
        console.log(`   Location: ${sqlPath}\n`);
    } catch (error) {
        console.error(`⚠️  DDL generation failed: ${error.message}`);
        console.error(`   Continuing with HTML generation only...\n`);
    }
    
    // Remove empty logical folder if it exists
    try {
        if (fs.existsSync(logicalDir)) {
            const logicalContents = fs.readdirSync(logicalDir);
            if (logicalContents.length === 0) {
                fs.rmdirSync(logicalDir);
                console.log(`✓ Removed empty logical folder\n`);
            }
        }
    } catch (error) {
        // Ignore errors when removing folder
    }
    
    console.log('🎯 Universal Features:');
    console.log('   ✓ Hierarchical navigation (Domain → SubDomain → Entity)');
    console.log('   ✓ Smooth inertial scrolling');
    console.log('   ✓ Crow\'s foot relationships (behind boxes)');
    console.log('   ✓ Full canvas scrolling (left/right/up/down)');
    console.log('   ✓ Toggle Physical/Logical models');
    console.log('   ✓ Click entity to auto-focus diagram');
    console.log('   ✓ Zoom in/out with smooth curves');
    console.log('   ✓ 15,000×12,000px canvas for full exploration\n');
    
    console.log(`📁 Output Files:`);
    console.log(`   • Interactive HTML: ${outputPath}`);
    const sqlPath = path.join(artifactPath, 'physical', 'mysql.sql');
    if (fs.existsSync(sqlPath)) {
        console.log(`   • MySQL DDL: ${sqlPath}`);
    }
    console.log('\n   Ready to use - Open HTML in browser!');
})().catch(error => {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
});
