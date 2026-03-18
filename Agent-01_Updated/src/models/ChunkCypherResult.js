import mongoose from 'mongoose';

// Delete existing model if it exists to force recompilation with updated schema
if (mongoose.models.ChunkCypherResult) {
  delete mongoose.models.ChunkCypherResult;
  delete mongoose.modelSchemas.ChunkCypherResult;
}

const ChunkCypherResultSchema = new mongoose.Schema({
  docId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  chunkId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentChunk',
    required: false, // Optional for full document mode
    default: null,
    index: true,
    // Custom validator to allow null/undefined
    validate: {
      validator: function(v) {
        // Allow null, undefined, or valid ObjectId
        return v === null || v === undefined || mongoose.Types.ObjectId.isValid(v);
      },
      message: 'chunkId must be null, undefined, or a valid ObjectId'
    }
  },
  generatedCypher: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['generated', 'validated', 'executed', 'error'],
    default: 'generated'
  },
  error: {
    type: String,
    default: null
  },
  // Execution metadata
  executionTimeMs: {
    type: Number,
    default: null
  },
  nodesCreated: {
    type: Number,
    default: 0
  },
  relationshipsCreated: {
    type: Number,
    default: 0
  },
  // Model metadata
  generationModel: {
    type: String,
    default: null
  },
  generationProvider: {
    type: String,
    enum: ['ollama', 'huggingface', 'azure'],
    default: 'azure'
  }
}, {
  timestamps: true
});

// Sparse unique index - only applies when chunkId is not null
// This allows multiple full document results (chunkId: null) per docId
ChunkCypherResultSchema.index({ docId: 1, chunkId: 1 }, { unique: true, sparse: true });
ChunkCypherResultSchema.index({ docId: 1, status: 1 });
// Index for full document results (chunkId is null)
ChunkCypherResultSchema.index({ docId: 1 }, { partialFilterExpression: { chunkId: null } });

export default mongoose.model('ChunkCypherResult', ChunkCypherResultSchema);

