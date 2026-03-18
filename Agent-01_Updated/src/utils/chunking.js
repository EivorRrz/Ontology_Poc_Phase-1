/**
 * Text chunking utilities for splitting long documents into manageable pieces
 */

const DEFAULT_CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_WORDS || '1000');
const DEFAULT_OVERLAP = parseInt(process.env.CHUNK_OVERLAP_WORDS || '100');

/**
 * Split text into chunks by word count with overlap
 * @param {string} text - Full text to chunk
 * @param {number} chunkSizeWords - Target words per chunk
 * @param {number} overlapWords - Number of words to overlap between chunks
 * @returns {Array<{text: string, startIndex: number, endIndex: number}>}
 */
export function chunkText(text, chunkSizeWords = DEFAULT_CHUNK_SIZE, overlapWords = DEFAULT_OVERLAP) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const words = text.split(/\s+/);
  const chunks = [];
  
  if (words.length <= chunkSizeWords) {
    return [{
      text: text,
      startIndex: 0,
      endIndex: text.length,
      wordCount: words.length,
      chunkIndex: 0
    }];
  }

  let startIdx = 0;
  let chunkIndex = 0;

  while (startIdx < words.length) {
    const endIdx = Math.min(startIdx + chunkSizeWords, words.length);
    const chunkWords = words.slice(startIdx, endIdx);
    const chunkText = chunkWords.join(' ');
    
    // Find actual text boundaries for this chunk
    const textBeforeChunk = words.slice(0, startIdx).join(' ');
    const textStart = textBeforeChunk.length + (textBeforeChunk.length > 0 ? 1 : 0);
    const textEnd = textStart + chunkText.length;

    chunks.push({
      text: chunkText,
      startIndex: textStart,
      endIndex: textEnd,
      wordCount: chunkWords.length,
      chunkIndex: chunkIndex++
    });

    // Move forward, accounting for overlap
    startIdx += chunkSizeWords - overlapWords;
    
    // Prevent infinite loop
    if (startIdx >= words.length) break;
  }

  return chunks;
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 0.75 words)
 */
export function estimateTokens(text) {
  const words = text.split(/\s+/).length;
  return Math.ceil(words / 0.75);
}

