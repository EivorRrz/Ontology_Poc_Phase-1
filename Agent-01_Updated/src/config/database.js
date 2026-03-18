/**
 * Database connection configuration
 * MongoDB (Mongoose) for staging/audit
 * Neo4j for graph storage
 */

import mongoose from 'mongoose';
import neo4j from 'neo4j-driver';
import { logger } from '../utils/logger.js';

// MongoDB connection
let mongoClient = null;

const LOCAL_MONGODB_URI = 'mongodb://localhost:27017/document-graph-pipeline';

export async function connectMongoDB() {
  if (mongoClient) {
    return mongoClient;
  }

  // Use local MongoDB when Atlas is unreachable (network/firewall/querySrv issues)
  const useLocal = process.env.MONGODB_USE_LOCAL === 'true' || process.env.MONGODB_USE_LOCAL === '1';
  const uri = useLocal
    ? LOCAL_MONGODB_URI
    : (process.env.MONGODB_URI || LOCAL_MONGODB_URI);

  const maxRetries = parseInt(process.env.MONGODB_CONNECT_RETRIES || '2', 10) || 2;
  const retryDelayMs = parseInt(process.env.MONGODB_CONNECT_RETRY_DELAY_MS || '3000', 10) || 3000;

  const connectOptions = {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      mongoClient = await mongoose.connect(uri, connectOptions);
      logger.info('MongoDB connected', {
        uri: uri.replace(/\/\/.*@/, '//***@'),
        mode: useLocal ? 'local' : 'atlas',
      });
      return mongoClient;
    } catch (error) {
      logger.error('MongoDB connection error', {
        attempt,
        maxAttempts: maxRetries + 1,
        error: error.message,
      });
      if (attempt <= maxRetries) {
        logger.info(`Retrying in ${retryDelayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      } else {
        const isSrvError = error.message.includes('ECONNREFUSED') || error.message.includes('querySrv');
        const hint = isSrvError
          ? `Atlas unreachable (network/firewall). Set MONGODB_USE_LOCAL=true and run: docker run -d -p 27017:27017 --name mongo mongo:latest`
          : '';
        throw new Error(`MongoDB connection failed after ${maxRetries + 1} attempts. ${hint} ${error.message}`);
      }
    }
  }
}

// Neo4j connection
let neo4jDriver = null;

export function getNeo4jDriver() {
  if (neo4jDriver) {
    return neo4jDriver;
  }

  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const user = process.env.NEO4J_USER || process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  if (!password) {
    throw new Error('NEO4J_PASSWORD environment variable is required');
  }

  // Debug logging
  logger.info('Neo4j connection attempt', {
    uri: uri.substring(0, 50) + '...',
    user,
    passwordSet: !!password
  });

  // For Neo4j Aura, we need to handle the connection differently
  // Aura uses neo4j+s:// or neo4j+ssc:// protocols (encryption is in URL)
  const driverConfig = {
    maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
  };

  // For Neo4j Aura, try neo4j+ssc:// if neo4j+s:// fails (self-signed certificate)
  // Some Aura instances require ssc:// protocol
  let actualUri = uri;
  if (uri.startsWith('neo4j+s://')) {
    // Try ssc:// first as it's more compatible with Aura
    actualUri = uri.replace('neo4j+s://', 'neo4j+ssc://');
    logger.info('Using neo4j+ssc:// protocol for Aura', { uri: actualUri.substring(0, 50) + '...' });
  }

  neo4jDriver = neo4j.driver(actualUri, neo4j.auth.basic(user, password), driverConfig);

  // Verify connectivity with better error handling
  neo4jDriver.verifyConnectivity()
    .then(() => {
      logger.info('Neo4j connected successfully', { uri: actualUri.substring(0, 50) + '...' });
    })
    .catch((error) => {
      logger.error('Neo4j connection error', {
        error: error.message,
        uri: actualUri.substring(0, 50) + '...',
        hint: 'If using Aura, ensure NEO4J_URI uses neo4j+ssc:// protocol'
      });
    });

  return neo4jDriver;
}

export function getNeo4jSession(mode = neo4j.session.READ) {
  const driver = getNeo4jDriver();
  return driver.session({ defaultAccessMode: mode });
}

export async function closeConnections() {
  if (mongoClient) {
    await mongoose.disconnect();
    mongoClient = null;
    logger.info('MongoDB disconnected');
  }

  if (neo4jDriver) {
    await neo4jDriver.close();
    neo4jDriver = null;
    logger.info('Neo4j disconnected');
  }
}

