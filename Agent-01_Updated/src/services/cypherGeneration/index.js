/**
 * Cypher Generation Service
 * Generates Cypher queries from documents using LLM models
 */

import { callLLM, extractCypher } from '../../utils/llm.js';
import { logger } from '../../utils/logger.js';
import config from '../../config/index.js';
import ChunkCypherResult from '../../models/ChunkCypherResult.js';
import DocumentChunk from '../../models/DocumentChunk.js';
import Schema from '../../models/Schema.js';
import Document from '../../models/Document.js';
import { detectDocumentType, getDocumentTypePrompts } from '../../utils/documentTypeDetector.js';
import { retryWithBackoff, isRetryableError } from '../../utils/retry.js';
import { formatStructuredCypher } from '../../utils/formatCypher.js';

/**
 * Build Cypher generation prompt
 * @param {object} schema - Graph schema
 * @param {string} chunkText - Chunk text content
 * @param {string} docType - Document type (business, financial, technical, etc.)
 */
function buildCypherPrompt(schema, chunkText, docType = 'general') {
  // Format schema for prompt
  const nodeTypes = Object.entries(schema.nodes)
    .map(([label, props]) => `  - ${label}: [${props.join(', ')}]`)
    .join('\n');

  const relationships = schema.relationships
    .map(rel => `  - ${rel.from} --[${rel.type}]--> ${rel.to}`)
    .join('\n');

  // Get document type-specific hints
  const typePrompts = getDocumentTypePrompts(docType);

  // Truncate chunk text if too long
  // For full document mode, use larger limit (15000 chars)
  // For chunked mode, use smaller limit (2000 chars)
  const isFullDocument = chunkText.length > 5000; // Heuristic: full documents are usually longer
  const maxChunkLength = isFullDocument ? 15000 : 2000;
  const truncatedChunk = chunkText.length > maxChunkLength
    ? chunkText.substring(0, maxChunkLength) + '\n[... text continues ...]'
    : chunkText;

  // Build relationship examples from reference schema
  const relationshipExamples = [
    'Account --[HELD_BY]--> Party',
    'Account --[HAS_ADDRESS]--> Address',
    'Account --[EXECUTED_TRADE]--> Trade',
    'Account --[HAS_POSITION]--> Position',
    'Account --[HAS_HOLDING]--> Holding',
    'Account --[HAS_INVESTMENT]--> Investment',
    'Party --[HAS_ACCOUNT]--> Account',
    'Address --[BELONGS_TO]--> Party',
    'Security --[HAS_TRADE]--> Trade',
    'Security --[INVOLVED_IN_INVESTMENT]--> Investment'
  ].join(', ');

  return `Generate Cypher MERGE statements from this ${docType} document.

Schema:
Nodes: ${nodeTypes.replace(/\n/g, ' | ')}
Relationships: ${relationships.replace(/\n/g, ' | ')}

IMPORTANT - Use Business-Meaningful Relationship Names:
For financial/business documents, use these relationship types:
${relationshipExamples}
NOT generic names like CONNECTS_TO or RELATED_TO.

Text:
${truncatedChunk}

CRITICAL RULES - Follow These Exactly:

1. ✅ NODE CREATION - Always Explicit:
   - ALWAYS use MERGE (var:LabelName {keyProperty: value}) for nodes
   - NEVER create nodes inline in relationships
   - WRONG: MERGE (a)-[:HAS_ADDRESS]->({addressId: "987"}) ❌
   - CORRECT: 
     MERGE (addr:Address {addressId: "987"})
     MERGE (a)-[:HAS_ADDRESS]->(addr) ✅
   - If a node is mentioned, create it explicitly FIRST, then link it

2. ✅ RELATIONSHIP SEMANTICS - Business-Meaningful & Correct Direction:
   - Use UPPER_SNAKE_CASE for relationship types
   - Use business-meaningful names with CORRECT direction (subject → object):
     * Party → Account: (party)-[:HAS_ACCOUNT]->(account) ✅
     * Account → Address: (account)-[:HAS_ADDRESS]->(address) ✅
     * Account → Trade: (account)-[:EXECUTED_TRADE]->(trade) ✅
     * Account → Position: (account)-[:HAS_POSITION]->(position) ✅
     * Account → Holding: (account)-[:HAS_HOLDING]->(holding) ✅
     * Account → Investment: (account)-[:HAS_INVESTMENT]->(investment) ✅
     * Trade → Security: (trade)-[:ON_SECURITY]->(security) ✅
     * Investment → Security: (investment)-[:IN_SECURITY]->(security) ✅
     * Position → Security: (position)-[:IN_SECURITY]->(security) ✅
     * Holding → Security: (holding)-[:IN_SECURITY]->(security) ✅
   - CRITICAL: Direction must be subject → object:
     * WRONG: (position)-[:HAS_POSITION]->(account) ❌
     * CORRECT: (account)-[:HAS_POSITION]->(position) ✅
     * WRONG: (trade)-[:EXECUTED_TRADE]->(account) ❌
     * CORRECT: (account)-[:EXECUTED_TRADE]->(trade) ✅
   - Avoid redundant bidirectional relationships:
     * Use ONLY: (party)-[:HAS_ACCOUNT]->(account) ✅
     * NOT BOTH: (party)-[:HAS_ACCOUNT]->(account) AND (account)-[:HELD_BY]->(party) ❌
   - Address ownership: Use (party)-[:HAS_ADDRESS]->(address) as primary
   - NOT generic: CONNECTS_TO, RELATED_TO, LINKS_TO ❌

3. ✅ PROPERTIES - Complete and Consistent:
   - Use camelCase: accountId, partyId, securityId, addressId, tradeId
   - Include ALL explicitly mentioned attributes (accountType, tradeDate, etc.)
   - Do NOT invent values - if missing, skip property
   - Keep property names consistent (don't mix productId and securityId)
   - Match property names exactly as shown in schema

4. ✅ NAMING CONSISTENCY:
   - Node labels: PascalCase (Account, Party, Security, Trade, Address)
   - Relationship types: UPPER_SNAKE_CASE (HELD_BY, HAS_ADDRESS, OWNS)
   - Properties: camelCase (accountId, partyId, securityId)

5. ✅ DATES - Valid ISO Format Only:
   - Use date("YYYY-MM-DD") ONLY if ISO format is confirmed
   - If invalid format (e.g., "12/11/25"), skip and comment: // INVALID DATE FORMAT: tradeDate = "12/11/25"
   - If missing, skip property (don't invent dates)

6. ✅ MERGE EVERYWHERE - Idempotent:
   - Use MERGE for ALL nodes and relationships (idempotent)
   - Use SET for updating properties: SET n.property = value
   - Use ON CREATE SET + ON MATCH SET if needed:
     MERGE (a:Account {accountId: "123"})
     ON CREATE SET a.createdAt = datetime()
     ON MATCH SET a.updatedAt = datetime()

7. ✅ MERGE with Literals Only:
   - MERGE nodes using ONLY literal values: MERGE (a:Account {accountId: "123"}) ✅
   - NEVER reference other node properties in MERGE maps: MERGE (t:Trade {securityId: s.securityId}) ❌
   - If linking nodes, use WITH or SET:
     MERGE (s:Security {securityId: "101"})
     WITH s
     MERGE (t:Trade {securityId: "101"}) ✅
   OR:
     MERGE (s:Security {securityId: "101"})
     MERGE (t:Trade {tradeId: "T1"})
     SET t.securityId = s.securityId ✅

8. ✅ RELATIONSHIP SYNTAX:
   - Use -> (not -&gt; or HTML entities)
   - Example: MERGE (a)-[:HELD_BY]->(p) ✅
   - Wrong: MERGE (a)-[:HELD_BY]-&gt;(p) ❌

9. ✅ OUTPUT FORMAT:
   - Output ONLY valid Cypher code
   - No markdown, no explanations, no code blocks
   - One statement per line
   - Include all nodes and relationships from the document

EXAMPLE (CORRECT - Proper Directions):
MERGE (party1:Party {partyId: "P1", firstName: "John", lastName: "Doe"})
MERGE (account1:Account {accountId: "A1", accountType: "Checking", accountStatus: "Active"})
MERGE (address1:Address {addressId: "AD1", street: "123 Main St", city: "New York", state: "NY", zipCode: "10001"})
MERGE (trade1:Trade {tradeId: "T1", tradeAmount: 1000, tradeDate: date("2024-01-15")})
MERGE (security1:Security {securityId: "S1", securityType: "Stock"})
MERGE (position1:Position {positionId: "POS1", quantity: 100})
MERGE (holding1:Holding {holdingId: "HOL1", quantity: 50})
MERGE (investment1:Investment {investmentId: "INV1", investmentAmount: 5000})
MERGE (party1)-[:HAS_ACCOUNT]->(account1)
MERGE (party1)-[:HAS_ADDRESS]->(address1)
MERGE (account1)-[:HAS_ADDRESS]->(address1)
MERGE (account1)-[:EXECUTED_TRADE]->(trade1)
MERGE (account1)-[:HAS_POSITION]->(position1)
MERGE (account1)-[:HAS_HOLDING]->(holding1)
MERGE (account1)-[:HAS_INVESTMENT]->(investment1)
MERGE (trade1)-[:ON_SECURITY]->(security1)
MERGE (investment1)-[:IN_SECURITY]->(security1)
MERGE (position1)-[:IN_SECURITY]->(security1)
MERGE (holding1)-[:IN_SECURITY]->(security1)

EXAMPLE (WRONG - Don't Do This):
MERGE (a)-[:HAS_ADDRESS]->({addressId: "987"}) ❌ - Node created inline
MERGE (t:Trade {securityId: s.securityId}) ❌ - Variable reference in MERGE
MERGE (a)-[:CONNECTS_TO]->(b) ❌ - Generic relationship name
MERGE (s:Security {productId: "101"}) ❌ - Wrong property name
MERGE (t:Trade {tradeDate: date("12/11/25")}) ❌ - Invalid date format
MERGE (pos)-[:HAS_POSITION]->(account) ❌ - Wrong direction (should be account → position)
MERGE (trade)-[:EXECUTED_TRADE]->(account) ❌ - Wrong direction (should be account → trade)
MERGE (account)-[:HELD_BY]->(party) ❌ - Redundant (use party-[:HAS_ACCOUNT]->account instead)
MERGE (a)-[:HasAccount]->(b) ❌ - Wrong case (should be HAS_ACCOUNT)
MERGE (a)-[:HAS_ADDRESS]-&gt;(b) ❌ - HTML entity (should be ->)

Generate Cypher:`;
}

/**
 * Fix common Cypher syntax errors and quality issues
 */
function fixCypherSyntax(cypher) {
  if (!cypher || cypher.trim().length === 0) {
    return cypher;
  }

  let fixed = cypher;

  // Fix 1: Replace HTML entities in relationships (-&gt; -> ->)
  // Do this MULTIPLE times to catch nested/encoded entities
  let previousFixed = '';
  let iterations = 0;
  while (previousFixed !== fixed && iterations < 10) {
    previousFixed = fixed;
    iterations++;
    // Fix arrow patterns (most common)
    fixed = fixed.replace(/-&gt;/g, '->');
    fixed = fixed.replace(/-&lt;/g, '<-');
    // Fix standalone entities
    fixed = fixed.replace(/&gt;/g, '>');
    fixed = fixed.replace(/&lt;/g, '<');
    // Also handle double-encoded entities
    fixed = fixed.replace(/&amp;gt;/g, '>');
    fixed = fixed.replace(/&amp;lt;/g, '<');
    // Handle URL-encoded versions
    fixed = fixed.replace(/%3E/g, '>');
    fixed = fixed.replace(/%3C/g, '<');
    // Handle hex encoded
    fixed = fixed.replace(/\\x3e/gi, '>');
    fixed = fixed.replace(/\\x3c/gi, '<');
  }

  // Final aggressive pass: replace ANY remaining HTML entity patterns
  fixed = fixed.replace(/&#?\w+;?/g, (match) => {
    if (match.includes('gt')) return '>';
    if (match.includes('lt')) return '<';
    return match;
  });

  // Fix 2: Fix common property name typos
  const propertyFixes = [
    { pattern: /accountI\s+d/gi, replacement: 'accountId' },
    { pattern: /partyI\s+d/gi, replacement: 'partyId' },
    { pattern: /securityI\s+d/gi, replacement: 'securityId' },
    { pattern: /productI\s+d/gi, replacement: 'productId' },
    { pattern: /tradeI\s+d/gi, replacement: 'tradeId' },
    { pattern: /positionI\s+d/gi, replacement: 'positionId' },
    { pattern: /holdingI\s+d/gi, replacement: 'holdingId' },
    { pattern: /investmentI\s+d/gi, replacement: 'investmentId' },
    { pattern: /addressI\s+d/gi, replacement: 'addressId' },
    { pattern: /transactionI\s+d/gi, replacement: 'transactionId' },
    { pattern: /referenceI\s+d/gi, replacement: 'referenceId' },
    { pattern: /riskI\s+d/gi, replacement: 'riskId' }
  ];

  for (const fix of propertyFixes) {
    fixed = fixed.replace(fix.pattern, fix.replacement);
  }

  // Fix 3: Fix property name inconsistencies (productId vs securityId for Security nodes)
  // If Security node uses productId, change to securityId
  fixed = fixed.replace(/MERGE\s*\([^:]*:Security\s*\{[^}]*\bproductId\b([^}]*)\}/gi, (match) => {
    return match.replace(/\bproductId\b/gi, 'securityId');
  });

  // Fix 4: MERGE with variable references - convert to WITH + SET pattern
  // Pattern: MERGE (t:Trade {securityId: s.securityId})
  // Should be: MERGE (s:Security {securityId: "101"}) WITH s MERGE (t:Trade {securityId: "101"})
  // Or: Extract the literal value and use it

  // First, find MERGE statements that reference other node properties
  const mergeWithRefPattern = /MERGE\s*\(([^:]+):(\w+)\s*\{([^}]*)\}/g;
  const problematicMerges = [];

  let match;
  while ((match = mergeWithRefPattern.exec(fixed)) !== null) {
    const varName = match[1].trim();
    const label = match[2];
    const props = match[3];

    // Check if properties reference other variables (e.g., s.securityId, a.accountId)
    const varRefPattern = /\b(\w+)\.(\w+)\b/g;
    const varRefs = [];
    let propMatch;
    while ((propMatch = varRefPattern.exec(props)) !== null) {
      varRefs.push({ var: propMatch[1], prop: propMatch[2] });
    }

    if (varRefs.length > 0) {
      problematicMerges.push({
        fullMatch: match[0],
        varName,
        label,
        props,
        varRefs,
        index: match.index
      });
    }
  }

  // Fix problematic MERGE statements by extracting literal values
  // This is a simplified fix - in practice, we'd need to trace back to find the literal value
  // For now, we'll add a WITH clause before the problematic MERGE
  if (problematicMerges.length > 0) {
    // Sort by index (descending) to avoid offset issues
    problematicMerges.sort((a, b) => b.index - a.index);

    for (const prob of problematicMerges) {
      // Find the referenced variable's MERGE statement before this one
      const beforeThis = fixed.substring(0, prob.index);
      const afterThis = fixed.substring(prob.index);

      // Try to find the literal value from the referenced variable's MERGE
      // This is a heuristic - we'll look for MERGE statements with the referenced variable
      for (const ref of prob.varRefs) {
        const refVarPattern = new RegExp(`MERGE\\s*\\(${ref.var}:\\w+\\s*\\{([^}]*)\\b${ref.prop}\\s*:\\s*["']([^"']+)["']`, 'i');
        const refMatch = beforeThis.match(refVarPattern);

        if (refMatch && refMatch[2]) {
          const literalValue = refMatch[2];
          // Replace the variable reference with the literal value
          const newProps = prob.props.replace(new RegExp(`\\b${ref.var}\\.${ref.prop}\\b`, 'g'), `"${literalValue}"`);
          const newMerge = `MERGE (${prob.varName}:${prob.label} {${newProps}})`;
          fixed = beforeThis + newMerge + afterThis.substring(prob.fullMatch.length);
          break;
        }
      }
    }
  }

  // Fix 5: Fix invalid node creation in relationships
  // Pattern: MERGE (a)-[:REL]->({prop: value}) - node created inline
  // Should be: MERGE (node:Label {prop: value}) then MERGE (a)-[:REL]->(node)
  const inlineNodePattern = /MERGE\s*\(([^)]+)\)-\[:([^\]]+)\]->\s*\(\s*\{([^}]+)\}\s*\)/g;
  let inlineNodeMatch;
  const inlineNodes = [];
  let offset = 0;

  while ((inlineNodeMatch = inlineNodePattern.exec(fixed)) !== null) {
    const beforeRel = inlineNodeMatch[1];
    const relType = inlineNodeMatch[2];
    const props = inlineNodeMatch[3];

    // Extract label from props or infer from relationship
    const labelMatch = props.match(/(\w+Id):\s*["']([^"']+)["']/);
    if (labelMatch) {
      const idProp = labelMatch[1];
      const idValue = labelMatch[2];
      // Infer label from property name (e.g., addressId -> Address)
      const label = idProp.charAt(0).toUpperCase() + idProp.slice(1).replace(/Id$/, '');
      const varName = label.toLowerCase().charAt(0);

      inlineNodes.push({
        match: inlineNodeMatch[0],
        index: inlineNodeMatch.index + offset,
        label,
        varName,
        props,
        beforeRel,
        relType
      });
    }
  }

  // Fix inline nodes by creating them explicitly first
  if (inlineNodes.length > 0) {
    inlineNodes.sort((a, b) => b.index - a.index); // Process from end to start

    for (const inlineNode of inlineNodes) {
      const before = fixed.substring(0, inlineNode.index);
      const after = fixed.substring(inlineNode.index + inlineNode.match.length);

      // Create node explicitly first
      const nodeCreation = `MERGE (${inlineNode.varName}:${inlineNode.label} {${inlineNode.props}})\n`;
      const relationship = `MERGE (${inlineNode.beforeRel})-[:${inlineNode.relType}]->(${inlineNode.varName})`;

      fixed = before + nodeCreation + relationship + after;
      offset += nodeCreation.length - inlineNode.match.length;
    }
  }

  // Fix 6: Fix invalid date formats
  // Pattern: date("12/11/25") or date("invalid") -> comment out
  const invalidDatePattern = /date\(["']([^"']+)["']\)/g;
  fixed = fixed.replace(invalidDatePattern, (match, dateValue) => {
    // Check if date is in ISO format (YYYY-MM-DD)
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDatePattern.test(dateValue)) {
      logger.debug('Invalid date format detected', { dateValue });
      return `// INVALID DATE FORMAT: ${match} - Expected YYYY-MM-DD`;
    }
    return match;
  });

  // Fix 7: Fix inverted relationship directions
  // Pattern: (position)-[:HAS_POSITION]->(account) should be (account)-[:HAS_POSITION]->(position)
  const relationshipFixes = [
    // Position/Holding/Investment/Trade relationships - these should come FROM Account
    {
      pattern: /MERGE\s*\((\w+):Position[^)]*\)\s*-\[:HAS_POSITION\]->\s*\((\w+):Account[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:HAS_POSITION]->($1)',
      description: 'Fix Position HAS_POSITION direction'
    },
    {
      pattern: /MERGE\s*\((\w+):Holding[^)]*\)\s*-\[:HAS_HOLDING\]->\s*\((\w+):Account[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:HAS_HOLDING]->($1)',
      description: 'Fix Holding HAS_HOLDING direction'
    },
    {
      pattern: /MERGE\s*\((\w+):Investment[^)]*\)\s*-\[:MADE_INVESTMENT\]->\s*\((\w+):Account[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:HAS_INVESTMENT]->($1)',
      description: 'Fix Investment MADE_INVESTMENT direction and name'
    },
    // Standardize MADE_INVESTMENT to HAS_INVESTMENT
    {
      pattern: /MERGE\s*\((\w+):Account[^)]*\)\s*-\[:MADE_INVESTMENT\]->\s*\((\w+):Investment[^)]*\)/gi,
      replacement: 'MERGE ($1)-[:HAS_INVESTMENT]->($2)',
      description: 'Standardize MADE_INVESTMENT to HAS_INVESTMENT'
    },
    {
      pattern: /MERGE\s*\((\w+):Trade[^)]*\)\s*-\[:EXECUTED_TRADE\]->\s*\((\w+):Account[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:EXECUTED_TRADE]->($1)', // Fix direction: account → trade
      description: 'Fix Trade EXECUTED_TRADE direction (account → trade)'
    },
    // Security relationships - these should go TO Security
    {
      pattern: /MERGE\s*\((\w+):Security[^)]*\)\s*-\[:HasTrade\]->\s*\((\w+):Trade[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:ON_SECURITY]->($1)',
      description: 'Fix Security HasTrade direction and name'
    },
    {
      pattern: /MERGE\s*\((\w+):Security[^)]*\)\s*-\[:InvolvedInInvestment\]->\s*\((\w+):Investment[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:IN_SECURITY]->($1)',
      description: 'Fix Security InvolvedInInvestment direction and name'
    },
    {
      pattern: /MERGE\s*\((\w+):Security[^)]*\)\s*-\[:HeldInPosition\]->\s*\((\w+):Position[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:IN_SECURITY]->($1)',
      description: 'Fix Security HeldInPosition direction and name'
    },
    {
      pattern: /MERGE\s*\((\w+):Security[^)]*\)\s*-\[:HeldInHolding\]->\s*\((\w+):Holding[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:IN_SECURITY]->($1)',
      description: 'Fix Security HeldInHolding direction and name'
    },
    // Fix HELD_IN_POSITION and HELD_IN_HOLDING patterns (should be IN_SECURITY from Position/Holding)
    {
      pattern: /MERGE\s*\((\w+):Security[^)]*\)\s*-\[:HELD_IN_POSITION\]->\s*\((\w+):Position[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:IN_SECURITY]->($1)',
      description: 'Fix Security HELD_IN_POSITION direction and name'
    },
    {
      pattern: /MERGE\s*\((\w+):Security[^)]*\)\s*-\[:HELD_IN_HOLDING\]->\s*\((\w+):Holding[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:IN_SECURITY]->($1)',
      description: 'Fix Security HELD_IN_HOLDING direction and name'
    },
    {
      pattern: /MERGE\s*\((\w+):Position[^)]*\)\s*-\[:HELD_IN_POSITION\]->\s*\((\w+):Security[^)]*\)/gi,
      replacement: 'MERGE ($1)-[:IN_SECURITY]->($2)',
      description: 'Fix Position HELD_IN_POSITION to IN_SECURITY'
    },
    {
      pattern: /MERGE\s*\((\w+):Holding[^)]*\)\s*-\[:HELD_IN_HOLDING\]->\s*\((\w+):Security[^)]*\)/gi,
      replacement: 'MERGE ($1)-[:IN_SECURITY]->($2)',
      description: 'Fix Holding HELD_IN_HOLDING to IN_SECURITY'
    },
    // Party relationships - fix case and direction
    {
      pattern: /MERGE\s*\((\w+):Party[^)]*\)\s*-\[:HasAccount\]->\s*\((\w+):Account[^)]*\)/gi,
      replacement: 'MERGE ($1)-[:HAS_ACCOUNT]->($2)',
      description: 'Fix Party HasAccount case'
    },
    {
      pattern: /MERGE\s*\((\w+):Account[^)]*\)\s*-\[:HAS_ACCOUNT\]->\s*\((\w+):Party[^)]*\)/gi,
      replacement: 'MERGE ($2)-[:HAS_ACCOUNT]->($1)', // Fix direction: party → account
      description: 'Fix HAS_ACCOUNT direction (party → account)'
    },
    {
      pattern: /MERGE\s*\((\w+):Account[^)]*\)\s*-\[:HELD_BY\]->\s*\((\w+):Party[^)]*\)/gi,
      replacement: '', // Remove redundant - we'll use HAS_ACCOUNT from Party
      description: 'Remove redundant HELD_BY relationship'
    },
    // Address relationships - fix case and remove redundant
    {
      pattern: /MERGE\s*\((\w+):Party[^)]*\)\s*-\[:HasAddress\]->\s*\((\w+):Address[^)]*\)/gi,
      replacement: 'MERGE ($1)-[:HAS_ADDRESS]->($2)',
      description: 'Fix Party HasAddress case'
    },
    {
      pattern: /MERGE\s*\((\w+):Address[^)]*\)\s*-\[:BelongsTo\]->\s*\((\w+):(Party|Account)[^)]*\)/gi,
      replacement: '', // Remove redundant - we'll use HAS_ADDRESS
      description: 'Remove redundant BelongsTo relationship'
    }
  ];

  for (const fix of relationshipFixes) {
    const before = fixed;
    fixed = fixed.replace(fix.pattern, fix.replacement);
    if (before !== fixed) {
      logger.debug('Fixed relationship direction', { description: fix.description });
    }
  }

  // Fix 8: Remove duplicate relationship lines (empty lines from removed relationships)
  fixed = fixed.split('\n').filter(line => line.trim().length > 0).join('\n');

  // Fix 9: Ensure all relationship patterns use MERGE
  // Pattern: MATCH (a)-[:REL]->(b) after MERGE statements
  // Split by lines to preserve structure
  const lines = fixed.split('\n');
  const fixedLines = [];
  let hasMergeBefore = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const upperLine = line.toUpperCase();

    // Track if we've seen MERGE statements
    if (upperLine.startsWith('MERGE')) {
      hasMergeBefore = true;
      fixedLines.push(lines[i]);
    } else if (upperLine.startsWith('MATCH')) {
      // Check if this MATCH is for a relationship pattern
      const relationshipPattern = /MATCH\s*(\([^)]+\)\s*-\[[^\]]+\]-\s*\([^)]+\))/i;
      const match = line.match(relationshipPattern);

      if (match && hasMergeBefore) {
        // Convert MATCH relationship to MERGE
        const fixedLine = line.replace(/^MATCH/i, 'MERGE');
        fixedLines.push(fixedLine);
        logger.debug('Fixed MATCH relationship after MERGE', {
          original: line.substring(0, 100),
          fixed: fixedLine.substring(0, 100)
        });
      } else {
        // Keep other MATCH statements as-is (might be valid)
        fixedLines.push(lines[i]);
      }
    } else if (upperLine.startsWith('WITH')) {
      // Reset flag when we see WITH
      hasMergeBefore = false;
      fixedLines.push(lines[i]);
    } else {
      fixedLines.push(lines[i]);
    }
  }

  return fixedLines.join('\n');
}

/**
 * Validate Cypher syntax using EXPLAIN
 */
async function validateCypher(cypher, session) {
  if (!cypher || cypher.trim().length === 0) {
    return { valid: false, error: 'Empty Cypher' };
  }

  try {
    // Try EXPLAIN to check syntax
    await session.run(`EXPLAIN ${cypher}`);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Generate Cypher for a single chunk
 * @param {string} chunkId - MongoDB chunk ID
 * @returns {Promise<string>} - Generated Cypher
 */
export async function generateCypherForChunk(chunkId) {
  const chunk = await DocumentChunk.findById(chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }

  // Check if already generated
  const existing = await ChunkCypherResult.findOne({ chunkId });
  if (existing && existing.status === 'executed') {
    logger.info('Cypher already generated for chunk', { chunkId });
    return existing.generatedCypher;
  }

  // Get schema
  const schemaDoc = await Schema.findOne({ docId: chunk.docId });
  if (!schemaDoc) {
    throw new Error(`Schema not found for document: ${chunk.docId}`);
  }

  const schema = {
    nodes: schemaDoc.nodes,
    relationships: schemaDoc.relationships
  };

  // Detect document type for prompt customization
  const doc = await Document.findById(chunk.docId);
  const docType = doc ? detectDocumentType(doc.filename, doc.fullText || '') : 'general';

  await chunk.updateOne({ status: 'cypher_generating' });

  try {
    logger.info('Generating Cypher for chunk', {
      chunkId,
      chunkIndex: chunk.chunkIndex,
      docType
    });

    const prompt = buildCypherPrompt(schema, chunk.rawText, docType);
    const systemPrompt = 'Generate Cypher MERGE statements only. No explanations, no markdown.';

    let response;
    try {
      // Retry LLM call with exponential backoff
      response = await retryWithBackoff(
        () => callLLM(prompt, systemPrompt, { temperature: 0.1, maxTokens: 1024 }),
        {
          maxRetries: 3,
          initialDelay: 2000,
          maxDelay: 30000,
          shouldRetry: isRetryableError,
          context: `cypher-generation-${chunkId}`
        }
      );
    } catch (llmError) {
      logger.error('LLM call failed after retries', {
        chunkId,
        error: llmError.message
      });
      throw llmError;
    }

    if (!response || typeof response !== 'string') {
      logger.error('Invalid LLM response', {
        chunkId,
        responseType: typeof response,
        response: response ? JSON.stringify(response).substring(0, 500) : 'null'
      });
      throw new Error(`Invalid LLM response: expected string, got ${typeof response}`);
    }

    logger.info('LLM response received', {
      chunkId,
      responseLength: response.length,
      responsePreview: response.substring(0, 500)
    });

    // Extract Cypher from response
    let cypher = extractCypher(response);

    logger.info('Extracted Cypher', {
      chunkId,
      cypherLength: cypher?.length || 0,
      cypherPreview: cypher?.substring(0, 200) || 'empty'
    });

    // Fix common syntax errors
    if (cypher) {
      const originalCypher = cypher;
      cypher = fixCypherSyntax(cypher);
      if (cypher !== originalCypher) {
        logger.info('Fixed Cypher syntax errors', {
          chunkId,
          originalLength: originalCypher.length,
          fixedLength: cypher.length
        });
      }
    }

    // If empty, try retry with more explicit instructions
    if (!cypher || cypher.trim().length === 0) {
      logger.warn('Empty Cypher generated, retrying', {
        chunkId,
        rawResponse: response?.substring(0, 500) || 'null'
      });
      const retryPrompt = `${prompt}\n\nIMPORTANT: Generate Cypher MERGE statements now.`;
      response = await retryWithBackoff(
        () => callLLM(retryPrompt, systemPrompt, { temperature: 0.1, maxTokens: 1024 }),
        {
          maxRetries: 1,
          initialDelay: 1000,
          shouldRetry: isRetryableError,
          context: `cypher-retry-${chunkId}`
        }
      );
      cypher = extractCypher(response);

      logger.debug('Retry Cypher extracted', {
        chunkId,
        cypherLength: cypher?.length || 0
      });
    }

    if (!cypher || cypher.trim().length === 0) {
      const errorMsg = `Generated Cypher is empty after retry. Raw response: ${response?.substring(0, 500) || 'null'}`;
      logger.error('Cypher extraction failed', {
        chunkId,
        rawResponse: response?.substring(0, 1000) || 'null',
        responseLength: response?.length || 0
      });
      throw new Error(errorMsg);
    }

    // Ensure cypher is not empty before saving (double-check)
    const trimmedCypher = cypher.trim();
    if (!trimmedCypher || trimmedCypher.length === 0) {
      throw new Error('Cypher is empty after trimming');
    }

    // Store result
    const result = existing || new ChunkCypherResult({
      docId: chunk.docId,
      chunkId: chunk._id,
      generatedCypher: trimmedCypher, // Use trimmed version
      status: 'generated',
      generationModel: config.azure.deploymentName,
      generationProvider: 'azure'
    });

    if (!existing) {
      await result.save();
    } else {
      await result.updateOne({
        generatedCypher: trimmedCypher, // Use trimmed version
        status: 'generated',
        error: null
      });
    }

    await chunk.updateOne({ status: 'cypher_generated' });

    logger.info('Cypher generated successfully', {
      chunkId,
      cypherLength: cypher.length,
      lines: cypher.split('\n').length
    });

    return cypher;

  } catch (error) {
    logger.error('Cypher generation error caught', {
      chunkId,
      error: error.message,
      errorStack: error.stack?.substring(0, 500)
    });

    await chunk.updateOne({
      status: 'error',
      error: error.message
    });

    // Store error in result - use placeholder to satisfy schema requirement
    try {
      const result = await ChunkCypherResult.findOne({ chunkId });
      if (result) {
        await result.updateOne({
          status: 'error',
          error: error.message
        });
      } else {
        // Use placeholder value to satisfy schema requirement (generatedCypher is required)
        const errorResult = new ChunkCypherResult({
          docId: chunk.docId,
          chunkId: chunk._id,
          generatedCypher: '-- ERROR: No Cypher generated --',
          status: 'error',
          error: error.message,
          generationModel: config.azure.deploymentName,
          generationProvider: 'azure'
        });
        await errorResult.save();
        logger.info('Error result saved', { chunkId });
      }
    } catch (saveError) {
      logger.error('Failed to save error result', {
        chunkId,
        saveError: saveError.message,
        originalError: error.message
      });
      // Don't throw - we want the original error to propagate
    }

    logger.error('Cypher generation failed', { chunkId, error: error.message });
    throw error;
  }
}

/**
 * Generate Cypher for full document
 * @param {string} docId - MongoDB document ID
 * @returns {Promise<string>} - Generated Cypher for entire document
 */
export async function generateCypherForFullDocument(docId) {
  const doc = await Document.findById(docId);
  if (!doc) {
    throw new Error(`Document not found: ${docId}`);
  }

  // Get schema
  const schemaDoc = await Schema.findOne({ docId });
  if (!schemaDoc) {
    throw new Error(`Schema not found for document: ${docId}`);
  }

  const schema = {
    nodes: schemaDoc.nodes,
    relationships: schemaDoc.relationships
  };

  // Get full document text
  let documentText = '';
  if (doc.fullText) {
    documentText = doc.fullText;
  } else {
    // Try to get from chunks
    const chunks = await DocumentChunk.find({ docId }).sort({ chunkIndex: 1 });
    if (chunks.length > 0) {
      documentText = chunks.map(c => c.text).join('\n\n');
    } else {
      throw new Error(`No text found for document ${docId}`);
    }
  }

  // Detect document type
  const docType = detectDocumentType(doc.filename, documentText);

  // Build prompt for full document (use full text, not truncated)
  // For full document, pass a flag or use larger limit in buildCypherPrompt
  // We'll pass the full text and let buildCypherPrompt handle truncation intelligently
  const prompt = buildCypherPrompt(schema, documentText, docType);
  const systemPrompt = 'You are a Cypher query generation expert. Generate complete, valid Neo4j Cypher MERGE statements for the ENTIRE document. Output Cypher code only, no markdown, no explanations. Include ALL nodes and relationships from the document.';

  logger.info('Generating Cypher for full document', {
    docId,
    textLength: documentText.length,
    nodeCount: Object.keys(schema.nodes).length,
    relationshipCount: schema.relationships.length
  });

  // Call LLM with retry logic
  let response;
  try {
    response = await retryWithBackoff(
      () => callLLM(prompt, systemPrompt, { temperature: 0.1, maxTokens: 8192 }),
      {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 30000,
        shouldRetry: isRetryableError,
        context: `cypher-generation-full-${docId}`
      }
    );
  } catch (llmError) {
    logger.error('LLM call failed after retries', {
      docId,
      error: llmError.message
    });
    throw llmError;
  }

  if (!response || typeof response !== 'string') {
    logger.error('Invalid LLM response', {
      docId,
      responseType: typeof response,
      response: response ? JSON.stringify(response).substring(0, 500) : 'null'
    });
    throw new Error(`Invalid LLM response: expected string, got ${typeof response}`);
  }

  logger.info('LLM response received', {
    docId,
    responseLength: response.length,
    responsePreview: response.substring(0, 500)
  });

  // Extract Cypher from response
  let cypher = extractCypher(response);

  logger.info('Extracted Cypher', {
    docId,
    cypherLength: cypher?.length || 0,
    cypherPreview: cypher?.substring(0, 200) || 'empty'
  });

  if (!cypher || cypher.trim().length === 0) {
    logger.warn('No Cypher extracted from response', { docId, responsePreview: response.substring(0, 1000) });
    throw new Error('No Cypher was extracted from LLM response');
  }

  // Fix common Cypher syntax errors
  cypher = fixCypherSyntax(cypher);

  // Format Cypher in structured format (constraints, nodes, relationships)
  try {
    const formattedCypher = formatStructuredCypher(cypher, schema);
    logger.info('Cypher formatted in structured format', {
      docId,
      originalLength: cypher.length,
      formattedLength: formattedCypher.length
    });
    cypher = formattedCypher;
  } catch (formatError) {
    logger.warn('Failed to format Cypher, using raw output', {
      docId,
      error: formatError.message
    });
    // Continue with raw Cypher if formatting fails
  }

  logger.info('Cypher generated for full document', {
    docId,
    cypherLength: cypher.length,
    statementCount: (cypher.match(/MERGE/g) || []).length
  });

  return cypher;
}

export async function generateCypherForAllChunks(docId) {
  const chunks = await DocumentChunk.find({
    docId,
    status: { $in: ['pending', 'error'] }
  }).sort({ chunkIndex: 1 });

  logger.info('Generating Cypher for all chunks', { docId, chunkCount: chunks.length });

  const results = [];
  for (const chunk of chunks) {
    try {
      // Retry failed chunks
      const cypher = await retryWithBackoff(
        () => generateCypherForChunk(chunk._id),
        {
          maxRetries: 2,
          initialDelay: 1000,
          maxDelay: 10000,
          shouldRetry: (error) => {
            // Retry on retryable errors or if chunk status is 'error'
            return isRetryableError(error) || chunk.status === 'error';
          },
          context: `cypher-generation-chunk-${chunk._id}`
        }
      );
      results.push({ chunkId: chunk._id, success: true, cypher });
    } catch (error) {
      logger.error('Failed to generate Cypher for chunk after retries', {
        chunkId: chunk._id,
        error: error.message
      });
      results.push({ chunkId: chunk._id, success: false, error: error.message });
    }
  }

  return results;
}

