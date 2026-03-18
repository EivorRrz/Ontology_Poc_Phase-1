import mongoose from 'mongoose';

const DocumentChunkSchema = new mongoose.Schema({
  docId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  chunkIndex: {
    type: Number,
    required: true
  },
  rawText: {
    type: String,
    required: true
  },
  wordCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'cypher_generating', 'cypher_generated', 'ingesting', 'ingested', 'error'],
    default: 'pending'
  },
  error: {
    type: String,
    default: null
  },
  startIndex: {
    type: Number,
    default: 0
  },
  endIndex: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Compound index for efficient querying
DocumentChunkSchema.index({ docId: 1, chunkIndex: 1 }, { unique: true });
DocumentChunkSchema.index({ docId: 1, status: 1 });

export default mongoose.model('DocumentChunk', DocumentChunkSchema);

