/**
 * Reference Business Process Model Schema
 * Data Migration from Greenplum to Snowflake
 * 
 * This serves as a reference for schema extraction and Cypher generation
 */

export const REFERENCE_BPM_SCHEMA = {
  nodes: {
    Account: ['accountId', 'accountName', 'accountType', 'accountStatus'],
    Party: ['partyId', 'firstName', 'lastName', 'organizationName', 'partyType'],
    Address: ['addressId', 'street', 'city', 'state', 'zipCode', 'country'],
    Accounting: ['transactionId', 'accountId', 'amount', 'transactionDate', 'description'],
    Product: ['productId', 'productName', 'productType', 'price', 'availability'],
    Reference: ['referenceId', 'referenceType', 'referenceValue'],
    Risk: ['riskId', 'riskType', 'riskLevel', 'mitigationStrategy'],
    Security: ['securityId', 'securityType', 'issuer', 'marketPrice'],
    Investment: ['investmentId', 'accountId', 'securityId', 'investmentAmount', 'investmentDate'],
    Trade: ['tradeId', 'securityId', 'tradeAmount', 'tradeDate', 'tradeType'],
    Position: ['positionId', 'accountId', 'securityId', 'quantity', 'marketValue'],
    Holding: ['holdingId', 'accountId', 'securityId', 'quantity', 'acquisitionDate']
  },
  relationships: [
    // Account relationships
    { from: 'Account', type: 'HELD_BY', to: 'Party' },
    { from: 'Account', type: 'HAS_ADDRESS', to: 'Address' },
    { from: 'Account', type: 'EXECUTED_TRADE', to: 'Trade' },
    { from: 'Account', type: 'HAS_POSITION', to: 'Position' },
    { from: 'Account', type: 'HAS_HOLDING', to: 'Holding' },
    { from: 'Account', type: 'HAS_INVESTMENT', to: 'Investment' },
    
    // Party relationships
    { from: 'Party', type: 'HAS_ACCOUNT', to: 'Account' },
    { from: 'Party', type: 'HAS_ADDRESS', to: 'Address' },
    
    // Address relationships
    { from: 'Address', type: 'BELONGS_TO', to: 'Party' },
    { from: 'Address', type: 'BELONGS_TO', to: 'Account' },
    
    // Security relationships
    { from: 'Security', type: 'HAS_TRADE', to: 'Trade' },
    { from: 'Security', type: 'INVOLVED_IN_INVESTMENT', to: 'Investment' },
    { from: 'Security', type: 'HELD_IN_POSITION', to: 'Position' },
    { from: 'Security', type: 'HELD_IN_HOLDING', to: 'Holding' },
    
    // Reference relationships
    { from: 'Reference', type: 'CLASSIFIES', to: 'Investment' },
    { from: 'Reference', type: 'CLASSIFIES', to: 'Trade' },
    { from: 'Reference', type: 'CLASSIFIES', to: 'Security' },
    { from: 'Reference', type: 'CLASSIFIES', to: 'Risk' },
    
    // Risk relationships
    { from: 'Risk', type: 'ASSOCIATED_WITH', to: 'Investment' },
    
    // Accounting relationships
    { from: 'Accounting', type: 'RELATES_TO', to: 'Account' },
    
    // Product relationships
    { from: 'Product', type: 'INVOLVED_IN', to: 'Trade' }
  ]
};

