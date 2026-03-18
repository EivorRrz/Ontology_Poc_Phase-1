/**
 * Retry utility with exponential backoff
 */

import { logger } from './logger.js';

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {Function} options.shouldRetry - Function to determine if error should be retried (default: retry all)
 * @param {string} options.context - Context for logging (default: 'retry')
 * @returns {Promise<any>} - Result of the function
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    context = 'retry'
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      
      if (attempt > 0) {
        logger.info('Retry succeeded', { 
          context, 
          attempt, 
          totalAttempts: attempt + 1 
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if we should retry this error
      if (!shouldRetry(error)) {
        logger.warn('Error not retryable', { 
          context, 
          error: error.message,
          attempt 
        });
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt >= maxRetries) {
        logger.error('Max retries exceeded', { 
          context, 
          attempts: attempt + 1,
          error: error.message 
        });
        break;
      }
      
      logger.warn('Retry attempt failed', { 
        context, 
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        error: error.message,
        nextDelayMs: delay 
      });
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }
  
  throw lastError;
}

/**
 * Check if error is retryable (network errors, timeouts, etc.)
 * @param {Error} error - Error to check
 * @returns {boolean} - Whether error is retryable
 */
export function isRetryableError(error) {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorCode = error.code?.toLowerCase() || '';
  
  // Network errors
  if (errorCode === 'econnrefused' || errorCode === 'etimedout' || 
      errorCode === 'enotfound' || errorCode === 'econnreset') {
    return true;
  }
  
  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return true;
  }
  
  // HTTP 5xx errors (server errors)
  if (error.status >= 500 && error.status < 600) {
    return true;
  }
  
  // Rate limiting (429)
  if (error.status === 429) {
    return true;
  }
  
  // Neo4j transaction errors (can be retried)
  if (errorMessage.includes('transaction') && 
      (errorMessage.includes('rollback') || errorMessage.includes('timeout'))) {
    return true;
  }
  
  // Don't retry validation errors, syntax errors, etc.
  if (errorMessage.includes('validation') || 
      errorMessage.includes('syntax') ||
      errorMessage.includes('invalid')) {
    return false;
  }
  
  return false;
}

