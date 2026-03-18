/**
 * Metrics routes
 * Provides API endpoints for viewing pipeline metrics
 */

import express from 'express';
import { getSuccessRate } from '../services/metrics.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /metrics
 * Get success rate metrics for a date range
 * Query params: startDate, endDate (ISO date strings), days (number of days back)
 */
router.get('/', async (req, res) => {
  try {
    let startDate, endDate;
    
    if (req.query.days) {
      // Get metrics for last N days
      const days = parseInt(req.query.days) || 7;
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
    } else {
      // Default to last 7 days
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    }
    
    const metrics = await getSuccessRate(startDate, endDate);
    
    res.json({
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      ...metrics
    });
  } catch (error) {
    logger.error('Failed to get metrics', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;

