/**
 * Pipeline Metrics Service
 * Tracks success rates and performance metrics
 */

import PipelineMetrics from '../models/PipelineMetrics.js';
import Document from '../models/Document.js';
import { logger } from '../utils/logger.js';
import { detectDocumentType } from '../utils/documentTypeDetector.js';

/**
 * Record pipeline metrics
 * @param {object} metrics - Metrics to record
 * @param {string} metrics.stage - Pipeline stage (parsing, schemaExtraction, cypherGeneration, ingestion)
 * @param {boolean} metrics.success - Whether stage succeeded
 * @param {number} metrics.processingTime - Processing time in ms
 * @param {string} metrics.docId - Document ID
 * @param {string} metrics.docType - Document type (optional, will be detected if not provided)
 */
export async function recordMetrics({ stage, success, processingTime, docId, docType = null }) {
  try {
    // Get or create today's metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let metrics = await PipelineMetrics.findOne({ date: today });
    
    if (!metrics) {
      metrics = new PipelineMetrics({ date: today });
    }
    
    // Update overall metrics
    if (stage === 'parsing') {
      if (success) {
        metrics.parsing.success++;
      } else {
        metrics.parsing.failed++;
      }
      metrics.avgProcessingTime.parsing = updateAverage(
        metrics.avgProcessingTime.parsing,
        processingTime,
        metrics.parsing.success + metrics.parsing.failed
      );
    } else if (stage === 'schemaExtraction') {
      if (success) {
        metrics.schemaExtraction.success++;
      } else {
        metrics.schemaExtraction.failed++;
      }
      metrics.avgProcessingTime.schemaExtraction = updateAverage(
        metrics.avgProcessingTime.schemaExtraction,
        processingTime,
        metrics.schemaExtraction.success + metrics.schemaExtraction.failed
      );
    } else if (stage === 'cypherGeneration') {
      if (success) {
        metrics.cypherGeneration.success++;
      } else {
        metrics.cypherGeneration.failed++;
      }
      metrics.avgProcessingTime.cypherGeneration = updateAverage(
        metrics.avgProcessingTime.cypherGeneration,
        processingTime,
        metrics.cypherGeneration.success + metrics.cypherGeneration.failed
      );
    } else if (stage === 'ingestion') {
      if (success) {
        metrics.ingestion.success++;
      } else {
        metrics.ingestion.failed++;
      }
      metrics.avgProcessingTime.ingestion = updateAverage(
        metrics.avgProcessingTime.ingestion,
        processingTime,
        metrics.ingestion.success + metrics.ingestion.failed
      );
    }
    
    // Detect document type if not provided
    if (docId && !docType) {
      try {
        const doc = await Document.findById(docId);
        if (doc) {
          docType = detectDocumentType(doc.filename, doc.fullText || '');
        }
      } catch (error) {
        logger.warn('Failed to detect document type for metrics', { docId, error: error.message });
      }
    }
    
    // Update document type metrics
    if (docType && metrics.byDocumentType[docType]) {
      if (success) {
        metrics.byDocumentType[docType].success++;
      } else {
        metrics.byDocumentType[docType].failed++;
      }
    }
    
    await metrics.save();
    
  } catch (error) {
    logger.error('Failed to record metrics', { error: error.message, stage, success });
    // Don't throw - metrics are non-critical
  }
}

/**
 * Record document completion
 * @param {string} docId - Document ID
 * @param {boolean} success - Whether document processing succeeded
 */
export async function recordDocumentCompletion(docId, success) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let metrics = await PipelineMetrics.findOne({ date: today });
    
    if (!metrics) {
      metrics = new PipelineMetrics({ date: today });
    }
    
    metrics.totalDocuments++;
    if (success) {
      metrics.successfulDocuments++;
    } else {
      metrics.failedDocuments++;
    }
    
    // Get document type
    let docType = 'general';
    try {
      const doc = await Document.findById(docId);
      if (doc) {
        docType = detectDocumentType(doc.filename, doc.fullText || '');
      }
    } catch (error) {
      logger.warn('Failed to detect document type', { docId, error: error.message });
    }
    
    if (metrics.byDocumentType[docType]) {
      if (success) {
        metrics.byDocumentType[docType].success++;
      } else {
        metrics.byDocumentType[docType].failed++;
      }
    }
    
    await metrics.save();
    
  } catch (error) {
    logger.error('Failed to record document completion', { error: error.message, docId });
  }
}

/**
 * Record retry
 * @param {string} stage - Pipeline stage
 */
export async function recordRetry(stage) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let metrics = await PipelineMetrics.findOne({ date: today });
    
    if (!metrics) {
      metrics = new PipelineMetrics({ date: today });
    }
    
    if (stage === 'cypherGeneration') {
      metrics.cypherGeneration.retries++;
    } else if (stage === 'ingestion') {
      metrics.ingestion.retries++;
    }
    
    await metrics.save();
    
  } catch (error) {
    logger.error('Failed to record retry', { error: error.message, stage });
  }
}

/**
 * Get success rate for a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<object>} - Success rate metrics
 */
export async function getSuccessRate(startDate, endDate) {
  try {
    const metrics = await PipelineMetrics.find({
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: -1 });
    
    if (metrics.length === 0) {
      return {
        totalDocuments: 0,
        successRate: 0,
        byStage: {},
        byDocumentType: {}
      };
    }
    
    // Aggregate metrics
    const aggregated = {
      totalDocuments: 0,
      successfulDocuments: 0,
      failedDocuments: 0,
      byStage: {
        parsing: { success: 0, failed: 0 },
        schemaExtraction: { success: 0, failed: 0 },
        cypherGeneration: { success: 0, failed: 0, retries: 0 },
        ingestion: { success: 0, failed: 0, retries: 0 }
      },
      byDocumentType: {
        business: { success: 0, failed: 0 },
        financial: { success: 0, failed: 0 },
        technical: { success: 0, failed: 0 },
        legal: { success: 0, failed: 0 },
        general: { success: 0, failed: 0 }
      }
    };
    
    for (const metric of metrics) {
      aggregated.totalDocuments += metric.totalDocuments;
      aggregated.successfulDocuments += metric.successfulDocuments;
      aggregated.failedDocuments += metric.failedDocuments;
      
      // Aggregate by stage
      for (const stage in aggregated.byStage) {
        aggregated.byStage[stage].success += metric[stage]?.success || 0;
        aggregated.byStage[stage].failed += metric[stage]?.failed || 0;
        aggregated.byStage[stage].retries += metric[stage]?.retries || 0;
      }
      
      // Aggregate by document type
      for (const docType in aggregated.byDocumentType) {
        aggregated.byDocumentType[docType].success += metric.byDocumentType[docType]?.success || 0;
        aggregated.byDocumentType[docType].failed += metric.byDocumentType[docType]?.failed || 0;
      }
    }
    
    // Calculate success rates
    const successRate = aggregated.totalDocuments > 0 
      ? (aggregated.successfulDocuments / aggregated.totalDocuments) * 100 
      : 0;
    
    const stageSuccessRates = {};
    for (const stage in aggregated.byStage) {
      const total = aggregated.byStage[stage].success + aggregated.byStage[stage].failed;
      stageSuccessRates[stage] = total > 0 
        ? (aggregated.byStage[stage].success / total) * 100 
        : 0;
    }
    
    const docTypeSuccessRates = {};
    for (const docType in aggregated.byDocumentType) {
      const total = aggregated.byDocumentType[docType].success + aggregated.byDocumentType[docType].failed;
      docTypeSuccessRates[docType] = total > 0 
        ? (aggregated.byDocumentType[docType].success / total) * 100 
        : 0;
    }
    
    return {
      totalDocuments: aggregated.totalDocuments,
      successfulDocuments: aggregated.successfulDocuments,
      failedDocuments: aggregated.failedDocuments,
      successRate: Math.round(successRate * 100) / 100,
      byStage: {
        ...aggregated.byStage,
        successRates: stageSuccessRates
      },
      byDocumentType: {
        ...aggregated.byDocumentType,
        successRates: docTypeSuccessRates
      }
    };
    
  } catch (error) {
    logger.error('Failed to get success rate', { error: error.message });
    throw error;
  }
}

/**
 * Update running average
 */
function updateAverage(currentAvg, newValue, count) {
  if (count === 1) {
    return newValue;
  }
  return Math.round(((currentAvg * (count - 1) + newValue) / count) * 100) / 100;
}

