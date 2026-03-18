import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['uploaded', 'parsing', 'parsed', 'schema_extracting', 'schema_extracted', 'cypher_generating', 'cypher_generated', 'ingesting', 'completed', 'error'],
    default: 'uploaded'
  },
  error: {
    type: String,
    default: null
  },
  // Store file path or GridFS reference
  filePath: {
    type: String,
    default: null
  },
  // Full parsed text (stored separately for large docs)
  fullText: {
    type: String,
    default: null
  },
  // Metadata
  uploadTimestamp: {
    type: Date,
    default: Date.now
  },
  processingStartedAt: {
    type: Date,
    default: null
  },
  processingCompletedAt: {
    type: Date,
    default: null
  },
  totalChunks: {
    type: Number,
    default: 0
  },
  processedChunks: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
DocumentSchema.index({ status: 1 });
DocumentSchema.index({ uploadTimestamp: -1 });

export default mongoose.model('Document', DocumentSchema);

