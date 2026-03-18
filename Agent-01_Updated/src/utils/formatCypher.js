/**
 * Format Cypher output in structured format:
 * 1) Constraints
 * 2) Nodes with sequential variable names
 * 3) Relationships using those variables
 */

import Schema from '../models/Schema.js';
import { logger } from './logger.js';

/**
 * Generate constraint statements from schema
 * @param {object} schema - Schema object with nodes
 * @returns {string} - Formatted constraint statements
 */
function generateConstraints(schema) {
  const constraints = [];
  
  // Validate schema structure
  if (!schema || !schema.nodes || typeof schema.nodes !== 'object') {
    logger.warn('Invalid schema structure for constraint generation', { 
      hasSchema: !!schema,
      hasNodes: !!(schema && schema.nodes),
      schemaType: typeof schema?.nodes
    });
    return '/* --- 1) Add uniqueness constraints (run once) --- */\n\n-- No constraints: Invalid schema structure\n\n';
  }
  
  for (const [label, props] of Object.entries(schema.nodes)) {
    // Skip if props is not an array
    if (!Array.isArray(props) || props.length === 0) {
      logger.debug('Skipping constraint for label with no properties', { label });
      continue;
    }
    
    // Find TRUE ID properties only - must match {label}Id pattern
    // Examples: Account -> accountId, Trade -> tradeId, NOT accountId in Trade (that's a foreign key)
    const labelLower = label.toLowerCase();
    const trueIdPattern = new RegExp(`^${labelLower}id$|^${labelLower}_id$`, 'i');
    
    const trueIdProps = props.filter(p => {
      if (typeof p !== 'string') return false;
      const lowerProp = p.toLowerCase();
      // Match exact pattern: {label}Id
      return trueIdPattern.test(lowerProp);
    });
    
    // If no true ID found, check for generic id/uuid
    const idProps = trueIdProps.length > 0 ? trueIdProps : props.filter(p => {
      if (typeof p !== 'string') return false;
      const lowerProp = p.toLowerCase();
      return /^(id|_id|uuid)$/.test(lowerProp);
    });

    // Create constraint ONLY for true ID properties (not foreign keys)
    for (const idProp of idProps) {
      // Generate variable name prefix from label (e.g., Party -> p, Account -> a)
      const varPrefix = label.toLowerCase().charAt(0);
      const constraintName = `${label.toLowerCase()}_${idProp}_unique`;
      
      // Handle special cases for variable names
      let varName = varPrefix;
      if (label === 'Accounting') {
        varName = 'acc2'; // Use acc2 to avoid conflict with Account (a)
      } else if (label === 'Address') {
        varName = 'addr';
      } else if (label === 'Reference') {
        varName = 'ref';
      } else if (label === 'Investment') {
        varName = 'inv';
      } else if (label === 'Position') {
        varName = 'pos';
      } else if (label === 'Holding') {
        varName = 'h';
      } else if (label === 'Risk') {
        varName = 'r';
      } else if (label === 'Security') {
        varName = 's';
      } else if (label === 'Trade') {
        varName = 't';
      } else if (label === 'Account') {
        varName = 'a';
      } else if (label === 'Party') {
        varName = 'p';
      }
      
      // Normalize property name to camelCase for consistency with nodes
      // Schema might have AccountId but nodes use accountId (Neo4j is case-sensitive)
      const normalizedProp = idProp.charAt(0).toLowerCase() + idProp.slice(1);
      
      constraints.push({
        label,
        property: normalizedProp, // Use camelCase to match nodes
        varName,
        constraintName
      });
    }
  }

  // Format constraints
  let constraintCypher = '/* --- 1) Add uniqueness constraints (run once) --- */\n\n';
  
  if (constraints.length === 0) {
    logger.warn('No constraints generated from schema', { 
      schemaNodes: schema?.nodes ? Object.keys(schema.nodes) : 'no nodes',
      schemaStructure: schema?.nodes ? Object.entries(schema.nodes).map(([label, props]) => ({ label, props })) : []
    });
    // Return header with comment explaining no constraints
    constraintCypher += '-- No constraints generated from schema.\n';
    constraintCypher += '-- Constraints will be inferred from generated Cypher nodes.\n\n';
    return constraintCypher;
  }
  
  for (const constraint of constraints) {
    const padding = ' '.repeat(Math.max(0, 30 - constraint.varName.length));
    constraintCypher += `CREATE CONSTRAINT IF NOT EXISTS FOR (${constraint.varName}:${constraint.label})${padding}REQUIRE ${constraint.varName}.${constraint.property} IS UNIQUE;\n`;
  }

  return constraintCypher;
}

/**
 * Generate constraints from parsed nodes (fallback when schema doesn't have ID properties)
 * @param {Array} nodes - Parsed node objects
 * @returns {string} - Formatted constraint statements
 */
function generateConstraintsFromNodes(nodes) {
  const constraints = [];
  const seenLabels = new Set();
  
  // Group nodes by label
  const nodesByLabel = new Map();
  for (const node of nodes) {
    if (!nodesByLabel.has(node.label)) {
      nodesByLabel.set(node.label, []);
    }
    nodesByLabel.get(node.label).push(node);
  }
  
  // Generate constraints for each label based on ID properties found in nodes
  for (const [label, labelNodes] of nodesByLabel.entries()) {
    // Find the ID property used in MERGE statements
    const idProps = new Set();
    for (const node of labelNodes) {
      if (node.idProp) {
        idProps.add(node.idProp);
      }
    }
    
    // Use the first ID property found, or check if it matches {label}Id pattern
    if (idProps.size > 0) {
      const idProp = Array.from(idProps)[0];
      const labelLower = label.toLowerCase();
      const trueIdPattern = new RegExp(`^${labelLower}id$|^${labelLower}_id$`, 'i');
      
      // Only create constraint if it's a true ID (matches pattern) or generic id/uuid
      if (trueIdPattern.test(idProp.toLowerCase()) || /^(id|_id|uuid)$/i.test(idProp)) {
        // Generate variable name
        let varName = label.toLowerCase().charAt(0);
        if (label === 'Accounting') varName = 'acc2';
        else if (label === 'Address') varName = 'addr';
        else if (label === 'Reference') varName = 'ref';
        else if (label === 'Investment') varName = 'inv';
        else if (label === 'Position') varName = 'pos';
        else if (label === 'Holding') varName = 'h';
        else if (label === 'Risk') varName = 'r';
        else if (label === 'Security') varName = 's';
        else if (label === 'Trade') varName = 't';
        else if (label === 'Account') varName = 'a';
        else if (label === 'Party') varName = 'p';
        
        // Normalize property name to camelCase
        const normalizedProp = idProp.charAt(0).toLowerCase() + idProp.slice(1);
        
        constraints.push({
          label,
          property: normalizedProp,
          varName
        });
        seenLabels.add(label);
      }
    }
  }
  
  // Format constraints
  let constraintCypher = '/* --- 1) Add uniqueness constraints (run once) --- */\n\n';
  
  if (constraints.length === 0) {
    constraintCypher += '-- No constraints generated (no ID properties found in nodes).\n';
    constraintCypher += '-- You may need to manually add constraints based on your data model.\n\n';
  } else {
    for (const constraint of constraints) {
      const padding = ' '.repeat(Math.max(0, 30 - constraint.varName.length));
      constraintCypher += `CREATE CONSTRAINT IF NOT EXISTS FOR (${constraint.varName}:${constraint.label})${padding}REQUIRE ${constraint.varName}.${constraint.property} IS UNIQUE;\n`;
    }
  }
  
  return constraintCypher;
}

/**
 * Parse Cypher to extract nodes and relationships
 * @param {string} cypher - Raw Cypher text
 * @returns {object} - Parsed nodes and relationships
 */
function parseCypher(cypher) {
  const nodes = [];
  const relationships = [];
  
  // Extract MERGE node statements
  const nodePattern = /MERGE\s*\((\w+):(\w+)\s*\{([^}]+)\}\)/g;
  let nodeMatch;
  const nodeMap = new Map(); // Map of (label, idValue) -> variableName
  
  while ((nodeMatch = nodePattern.exec(cypher)) !== null) {
    const varName = nodeMatch[1];
    const label = nodeMatch[2];
    const props = nodeMatch[3];
    
    // Extract ID property: prefer {label}Id, id, _id, uuid; fallback to first property
    let idProp, idValue;
    let idMatch = props.match(/(\w+Id|id|_id|uuid):\s*["']([^"']+)["']/i);
    if (idMatch) {
      idProp = idMatch[1];
      idValue = idMatch[2];
    } else {
      // Fallback: use first property with string, number, or date value
      const firstStr = props.match(/(\w+):\s*["']([^"']+)["']/);
      const firstNum = props.match(/(\w+):\s*(\d+)/);
      const firstDate = props.match(/(\w+):\s*date\(["']([^"']+)["']\)/);
      if (firstStr) {
        idProp = firstStr[1];
        idValue = firstStr[2];
      } else if (firstDate) {
        idProp = firstDate[1];
        idValue = firstDate[2];
      } else if (firstNum) {
        idProp = firstNum[1];
        idValue = firstNum[2];
      }
    }
    if (idProp && idValue) {
      const key = `${label}:${idValue}`;
      nodes.push({
        originalVar: varName,
        label,
        props,
        idProp,
        idValue,
        key
      });
      nodeMap.set(key, varName);
    }
  }
  
  // Extract MERGE relationship statements
  // Handle both -> and -&gt; (HTML entity) patterns
  const relPattern = /MERGE\s*\(([^)]+)\)-\[:([^\]]+)\](?:-&gt;|->)\(([^)]+)\)/g;
  let relMatch;
  
  while ((relMatch = relPattern.exec(cypher)) !== null) {
    const fromVar = relMatch[1].trim();
    let relType = relMatch[2];
    const toVar = relMatch[3].trim();
    
    // Fix HTML entities in relationship type as well
    relType = relType.replace(/-&gt;/g, '->').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
    
    relationships.push({
      from: fromVar,
      type: relType,
      to: toVar
    });
  }
  
  return { nodes, relationships, nodeMap };
}

/**
 * Generate sequential variable names
 * @param {Array} nodes - Array of node objects
 * @returns {Map} - Map of original variable -> new sequential variable
 */
function generateSequentialVariables(nodes) {
  const varMap = new Map();
  let counter = 1;
  
  // Group nodes by label to assign sequential numbers
  const nodesByLabel = {};
  for (const node of nodes) {
    if (!nodesByLabel[node.label]) {
      nodesByLabel[node.label] = [];
    }
    nodesByLabel[node.label].push(node);
  }
  
  // Assign sequential variables
  for (const node of nodes) {
    // Generate variable name based on label and counter
    let varPrefix = node.label.toLowerCase().charAt(0);
    
    // Handle special cases
    if (node.label === 'Accounting') {
      varPrefix = 'acc2';
    } else if (node.label === 'Address') {
      varPrefix = 'addr';
    } else if (node.label === 'Reference') {
      varPrefix = 'ref';
    } else if (node.label === 'Investment') {
      varPrefix = 'inv';
    } else if (node.label === 'Position') {
      varPrefix = 'pos';
    } else if (node.label === 'Holding') {
      varPrefix = 'h';
    } else if (node.label === 'Risk') {
      varPrefix = 'r';
    } else if (node.label === 'Security') {
      varPrefix = 's';
    } else if (node.label === 'Trade') {
      varPrefix = 't';
    } else if (node.label === 'Account') {
      varPrefix = 'account';
    } else if (node.label === 'Party') {
      varPrefix = 'party';
    }
    
    const newVarName = `${varPrefix}${counter}`;
    varMap.set(node.originalVar, newVarName);
    varMap.set(node.key, newVarName); // Also map by key for lookup
    counter++;
  }
  
  return varMap;
}

/**
 * Format Cypher in structured format
 * @param {string} rawCypher - Raw Cypher from LLM
 * @param {object} schema - Schema object
 * @returns {string} - Formatted Cypher
 */
export function formatStructuredCypher(rawCypher, schema) {
  try {
    // Fix HTML escapes first
    let cleanedCypher = rawCypher;
    cleanedCypher = cleanedCypher.replace(/-&gt;/g, '->');
    cleanedCypher = cleanedCypher.replace(/-&lt;/g, '<-');
    cleanedCypher = cleanedCypher.replace(/&gt;/g, '>');
    cleanedCypher = cleanedCypher.replace(/&lt;/g, '<');
    
    // Parse Cypher to extract nodes and relationships FIRST
    const { nodes, relationships } = parseCypher(cleanedCypher);
    
    if (nodes.length === 0) {
      logger.warn('No nodes found in Cypher, returning raw Cypher');
      return rawCypher;
    }
    
    // Generate constraints section from schema
    let constraintsSection = generateConstraints(schema);
    
    // If no constraints from schema, infer from parsed nodes
    if (constraintsSection.includes('No constraints generated')) {
      constraintsSection = generateConstraintsFromNodes(nodes);
    }
    
    // Generate sequential variable names
    const varMap = generateSequentialVariables(nodes);
    
    // Format nodes section
    let nodesSection = '\n/* --- 2) Create nodes with unique variable names --- */\n\n';
    let nodeCounter = 1;
    const nodeVarMap = new Map(); // Map to track which variables we've used
    
    for (const node of nodes) {
      const newVarName = varMap.get(node.originalVar) || `${node.label.toLowerCase().charAt(0)}${nodeCounter}`;
      
      // Avoid duplicates
      if (!nodeVarMap.has(node.key)) {
        const padding = ' '.repeat(Math.max(0, 20 - newVarName.length));
        nodesSection += `MERGE (${newVarName}:${node.label}${padding}{${node.idProp}: "${node.idValue}"})\n`;
        nodeVarMap.set(node.key, newVarName);
        nodeCounter++;
      }
    }
    
    nodesSection += ';\n\n';
    
    // Format relationships section
    let relationshipsSection = '/* --- 3) Now MERGE relationships (use variables from above) --- */\n\n';
    
    // Create a map of variable names to node info for quick lookup
    const varToNodeMap = new Map();
    for (const node of nodes) {
      varToNodeMap.set(node.originalVar, node);
      varToNodeMap.set(node.key, node);
    }
    
    // Track relationships to avoid duplicates
    const relationshipSet = new Set();
    
    // Track which nodes need security links
    const investmentNodes = nodes.filter(n => n.label === 'Investment');
    const securityNodes = nodes.filter(n => n.label === 'Security');
    const tradeNodes = nodes.filter(n => n.label === 'Trade');
    const accountNodes = nodes.filter(n => n.label === 'Account');
    const investmentSecurityLinks = new Set();
    const tradeAccountLinks = new Set(); // Track account → trade links
    const tradeSecurityLinks = new Set(); // Track trade → security links
    
    for (const rel of relationships) {
      // Try to map variables using the varMap
      let fromVar = rel.from.trim();
      let toVar = rel.to.trim();
      
      // Try to find matching node for fromVar
      const fromNode = varToNodeMap.get(fromVar);
      if (fromNode) {
        fromVar = varMap.get(fromNode.originalVar) || fromVar;
      } else {
        // Try to find by matching variable name in nodes
        for (const node of nodes) {
          if (node.originalVar === fromVar || fromVar.includes(node.originalVar)) {
            fromVar = varMap.get(node.originalVar) || fromVar;
            break;
          }
        }
      }
      
      // Try to find matching node for toVar
      const toNode = varToNodeMap.get(toVar);
      if (toNode) {
        toVar = varMap.get(toNode.originalVar) || toVar;
      } else {
        // Try to find by matching variable name in nodes
        for (const node of nodes) {
          if (node.originalVar === toVar || toVar.includes(node.originalVar)) {
            toVar = varMap.get(node.originalVar) || toVar;
            break;
          }
        }
      }
      
      // Fix relationship directions based on business logic
      let finalFromVar = fromVar;
      let finalToVar = toVar;
      let finalRelType = rel.type;
      
      // Find node labels for direction checking - create reverse map for faster lookup
      const varToLabelMap = new Map();
      for (const node of nodes) {
        const mappedVar = varMap.get(node.originalVar);
        if (mappedVar) {
          varToLabelMap.set(mappedVar, node.label);
        }
      }
      
      const fromNodeLabel = varToLabelMap.get(fromVar);
      const toNodeLabel = varToLabelMap.get(toVar);
      
      // Fix HAS_ACCOUNT: Should be party → account, not account → party
      if (rel.type === 'HAS_ACCOUNT' && fromNodeLabel === 'Account' && toNodeLabel === 'Party') {
        finalFromVar = toVar;
        finalToVar = fromVar;
        logger.debug('Fixed HAS_ACCOUNT direction', { from: fromVar, to: toVar });
      }
      
      // Fix EXECUTED_TRADE: Should be account → trade, not trade → account
      if (rel.type === 'EXECUTED_TRADE' && fromNodeLabel === 'Trade' && toNodeLabel === 'Account') {
        finalFromVar = toVar;
        finalToVar = fromVar;
        logger.debug('Fixed EXECUTED_TRADE direction', { from: fromVar, to: toVar });
      }
      
      // Fix HELD_IN_POSITION and HELD_IN_HOLDING: Should be Position/Holding → Security (IN_SECURITY)
      if ((rel.type === 'HELD_IN_POSITION' || rel.type === 'HELD_IN_HOLDING') && fromNodeLabel === 'Security') {
        // Security → Position/Holding is wrong, should be Position/Holding → Security
        finalFromVar = toVar;
        finalToVar = fromVar;
        finalRelType = 'IN_SECURITY';
        logger.debug('Fixed HELD_IN_POSITION/HELD_IN_HOLDING direction', { 
          originalType: rel.type, 
          from: fromVar, 
          to: toVar 
        });
      } else if ((rel.type === 'HELD_IN_POSITION' || rel.type === 'HELD_IN_HOLDING') && toNodeLabel === 'Security') {
        // Position/Holding → Security is correct direction, just rename to IN_SECURITY
        finalRelType = 'IN_SECURITY';
        logger.debug('Renamed HELD_IN_POSITION/HELD_IN_HOLDING to IN_SECURITY', { originalType: rel.type });
      }
      
      // Standardize MADE_INVESTMENT to HAS_INVESTMENT
      if (rel.type === 'MADE_INVESTMENT') {
        finalRelType = 'HAS_INVESTMENT';
        logger.debug('Standardized MADE_INVESTMENT to HAS_INVESTMENT');
      }
      
      // Track Investment → Security links (for IN_SECURITY relationship type)
      if (rel.type === 'IN_SECURITY' && fromNodeLabel === 'Investment' && toNodeLabel === 'Security') {
        investmentSecurityLinks.add(fromVar);
      }
      
      // Track Trade links
      if (rel.type === 'EXECUTED_TRADE' && fromNodeLabel === 'Account' && toNodeLabel === 'Trade') {
        tradeAccountLinks.add(finalToVar); // Track the trade variable
      }
      if (rel.type === 'ON_SECURITY' && fromNodeLabel === 'Trade' && toNodeLabel === 'Security') {
        tradeSecurityLinks.add(finalFromVar); // Track the trade variable
      }
      
      // Create relationship key for deduplication
      const relKey = `${finalFromVar}-[:${finalRelType}]->${finalToVar}`;
      
      // Skip if duplicate
      if (relationshipSet.has(relKey)) {
        logger.debug('Skipping duplicate relationship', { relKey });
        continue;
      }
      relationshipSet.add(relKey);
      
      // Handle inline node creation in relationships
      const inlineNodePattern = /\{(\w+Id|id|_id|uuid):\s*["']([^"']+)["']\}/i;
      const inlineMatch = finalToVar.match(inlineNodePattern);
      
      if (inlineMatch) {
        // This is an inline node creation - we need to create the node first
        const idProp = inlineMatch[1];
        const idValue = inlineMatch[2];
        // Infer label from property name
        const inferredLabel = idProp.charAt(0).toUpperCase() + idProp.slice(1).replace(/Id$/, '');
        const newVarName = `${inferredLabel.toLowerCase().charAt(0)}${nodeCounter}`;
        
        relationshipsSection += `MERGE (${newVarName}:${inferredLabel} {${idProp}: "${idValue}"})\n`;
        relationshipsSection += `MERGE (${finalFromVar})-[:${finalRelType}]->(${newVarName});\n\n`;
        nodeCounter++;
      } else {
        // Normal relationship - use mapped variables
        relationshipsSection += `MERGE (${finalFromVar})-[:${finalRelType}]->(${finalToVar});\n\n`;
      }
    }
    
    // Add missing Investment → Security links
    if (investmentNodes.length > 0 && securityNodes.length > 0) {
      for (const invNode of investmentNodes) {
        const invVar = varMap.get(invNode.originalVar);
        if (!investmentSecurityLinks.has(invVar)) {
          // Link first investment to first security if not already linked
          const secVar = varMap.get(securityNodes[0].originalVar);
          const relKey = `${invVar}-[:IN_SECURITY]->${secVar}`;
          if (!relationshipSet.has(relKey)) {
            relationshipsSection += `MERGE (${invVar})-[:IN_SECURITY]->(${secVar});\n\n`;
            relationshipSet.add(relKey);
            logger.debug('Added missing Investment → Security link', { invVar, secVar });
          }
        }
      }
    }
    
    // Add missing Trade links
    if (tradeNodes.length > 0) {
      for (const tradeNode of tradeNodes) {
        const tradeVar = varMap.get(tradeNode.originalVar);
        
        // Ensure Trade is linked to Account (if accounts exist)
        if (accountNodes.length > 0 && !tradeAccountLinks.has(tradeVar)) {
          const accountVar = varMap.get(accountNodes[0].originalVar);
          const relKey = `${accountVar}-[:EXECUTED_TRADE]->${tradeVar}`;
          if (!relationshipSet.has(relKey)) {
            relationshipsSection += `MERGE (${accountVar})-[:EXECUTED_TRADE]->(${tradeVar});\n\n`;
            relationshipSet.add(relKey);
            logger.debug('Added missing Account → Trade link', { accountVar, tradeVar });
          }
        }
        
        // Ensure Trade is linked to Security (if securities exist)
        if (securityNodes.length > 0 && !tradeSecurityLinks.has(tradeVar)) {
          const secVar = varMap.get(securityNodes[0].originalVar);
          const relKey = `${tradeVar}-[:ON_SECURITY]->${secVar}`;
          if (!relationshipSet.has(relKey)) {
            relationshipsSection += `MERGE (${tradeVar})-[:ON_SECURITY]->(${secVar});\n\n`;
            relationshipSet.add(relKey);
            logger.debug('Added missing Trade → Security link', { tradeVar, secVar });
          }
        }
      }
    }
    
    // Combine all sections
    let finalCypher = constraintsSection + nodesSection + relationshipsSection;
    
    // Final cleanup: Ensure NO HTML entities remain anywhere
    finalCypher = finalCypher.replace(/-&gt;/g, '->');
    finalCypher = finalCypher.replace(/-&lt;/g, '<-');
    finalCypher = finalCypher.replace(/&gt;/g, '>');
    finalCypher = finalCypher.replace(/&lt;/g, '<');
    
    return finalCypher;
    
  } catch (error) {
    logger.error('Failed to format Cypher', { error: error.message });
    // Return raw Cypher if formatting fails, but still fix HTML entities
    let fallbackCypher = rawCypher;
    fallbackCypher = fallbackCypher.replace(/-&gt;/g, '->');
    fallbackCypher = fallbackCypher.replace(/-&lt;/g, '<-');
    fallbackCypher = fallbackCypher.replace(/&gt;/g, '>');
    fallbackCypher = fallbackCypher.replace(/&lt;/g, '<');
    return fallbackCypher;
  }
}

