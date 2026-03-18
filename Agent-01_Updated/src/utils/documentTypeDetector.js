/**
 * Document Type Detection Utility
 * Detects document type from filename and content to customize prompts
 */

/**
 * Detect document type from filename and content
 * @param {string} filename - Document filename
 * @param {string} text - Document text content (optional)
 * @returns {string} - Document type: 'business', 'financial', 'technical', 'legal', 'general'
 */
export function detectDocumentType(filename, text = '') {
  const lowerFilename = filename.toLowerCase();
  const lowerText = text.toLowerCase().substring(0, 5000); // Sample first 5k chars

  // BPM (Business Process Model) documents - check first
  const bpmKeywords = ['business process model', 'data migration', 'greenplum', 'snowflake', 
    'account id', 'party id', 'security id', 'bpm'];
  const bpmFilenamePatterns = /(bpm|business.process.model|data.migration)/i;
  
  if (bpmFilenamePatterns.test(lowerFilename) || 
      bpmKeywords.some(kw => lowerText.includes(kw))) {
    return 'business'; // Use business type for BPM documents
  }

  // Financial documents
  const financialKeywords = ['account', 'transaction', 'payment', 
    'invoice', 'financial', 'accounting', 'trade', 'investment', 'security', 'holding', 
    'position', 'risk', 'portfolio', 'balance sheet', 'income statement'];
  const financialFilenamePatterns = /(financial|account|invoice|statement|report|balance)/i;
  
  if (financialFilenamePatterns.test(lowerFilename) || 
      financialKeywords.some(kw => lowerText.includes(kw))) {
    return 'financial';
  }

  // Business documents
  const businessKeywords = ['company', 'organization', 'department', 'employee', 'manager',
    'process', 'workflow', 'procedure', 'policy', 'strategy', 'business plan', 'meeting'];
  const businessFilenamePatterns = /(business|company|organization|process|procedure|policy)/i;
  
  if (businessFilenamePatterns.test(lowerFilename) || 
      businessKeywords.some(kw => lowerText.includes(kw))) {
    return 'business';
  }

  // Technical documents
  const technicalKeywords = ['api', 'system', 'architecture', 'database', 'server', 'client',
    'code', 'function', 'class', 'method', 'interface', 'protocol', 'algorithm', 'framework'];
  const technicalFilenamePatterns = /(technical|api|system|architecture|design|spec|guide)/i;
  
  if (technicalFilenamePatterns.test(lowerFilename) || 
      technicalKeywords.some(kw => lowerText.includes(kw))) {
    return 'technical';
  }

  // Legal documents
  const legalKeywords = ['contract', 'agreement', 'terms', 'conditions', 'legal', 'law',
    'clause', 'party', 'signature', 'liability', 'warranty', 'disclaimer'];
  const legalFilenamePatterns = /(legal|contract|agreement|terms|law|clause)/i;
  
  if (legalFilenamePatterns.test(lowerFilename) || 
      legalKeywords.some(kw => lowerText.includes(kw))) {
    return 'legal';
  }

  // Default to general
  return 'general';
}

/**
 * Get document type-specific prompt enhancements
 * @param {string} docType - Document type
 * @returns {object} - Prompt enhancements
 */
export function getDocumentTypePrompts(docType) {
  const prompts = {
    financial: {
      schemaHint: 'Focus on financial entities: accounts, transactions, parties, securities, trades, positions, holdings, and their relationships.',
      cypherHint: 'Pay special attention to financial identifiers (accountID, transactionID, tradeID) and ensure all numeric values are properly formatted. Relationships often involve ownership, transactions, and holdings.'
    },
    business: {
      schemaHint: 'Focus on business entities: companies, departments, employees, roles, processes, and organizational relationships. For Data Migration BPM documents, use relationship names like HELD_BY, HAS_ADDRESS, EXECUTED_TRADE, HAS_POSITION, HAS_HOLDING, HAS_INVESTMENT, INVOLVED_IN_INVESTMENT, IN_SECURITY, ON_SECURITY, CLASSIFIES, ASSOCIATED_WITH. Use business-meaningful names, not generic CONNECTS_TO.',
      cypherHint: 'Emphasize organizational hierarchies, reporting structures, and business processes. Use clear identifiers for entities. For BPM documents, use relationship types like HELD_BY, HAS_ADDRESS, EXECUTED_TRADE, HAS_POSITION, HAS_HOLDING, HAS_INVESTMENT, IN_SECURITY, ON_SECURITY. Ensure all IDs (accountId, partyId, securityId) are properly extracted.'
    },
    technical: {
      schemaHint: 'Focus on technical entities: systems, components, APIs, services, databases, and their technical relationships.',
      cypherHint: 'Pay attention to technical identifiers, version numbers, and system dependencies. Relationships often involve dependencies, integrations, and data flows.'
    },
    legal: {
      schemaHint: 'Focus on legal entities: parties, contracts, clauses, terms, obligations, and legal relationships. Include unique IDs: contractReference/contractId for Contract, organizationName for Party, productCode for Product.',
      cypherHint: 'Emphasize party relationships, contract terms, and legal obligations. Use contractReference, organizationName, productCode as MERGE keys.'
    },
    general: {
      schemaHint: 'Extract all relevant entities, their properties, and relationships from the document.',
      cypherHint: 'Generate Cypher statements that accurately represent the entities and relationships found in the text.'
    }
  };

  return prompts[docType] || prompts.general;
}

