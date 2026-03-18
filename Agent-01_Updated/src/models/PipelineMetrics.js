import mongoose from 'mongoose';

const PipelineMetricsSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  // Overall metrics
  totalDocuments: {
    type: Number,
    default: 0
  },
  successfulDocuments: {
    type: Number,
    default: 0
  },
  failedDocuments: {
    type: Number,
    default: 0
  },
  // Stage metrics
  parsing: {
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  schemaExtraction: {
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  cypherGeneration: {
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    retries: { type: Number, default: 0 }
  },
  ingestion: {
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    retries: { type: Number, default: 0 }
  },
  // Document type breakdown
  byDocumentType: {
    business: { success: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
    financial: { success: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
    technical: { success: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
    legal: { success: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },
    general: { success: { type: Number, default: 0 }, failed: { type: Number, default: 0 } }
  },
  // Average processing times (ms)
  avgProcessingTime: {
    parsing: { type: Number, default: 0 },
    schemaExtraction: { type: Number, default: 0 },
    cypherGeneration: { type: Number, default: 0 },
    ingestion: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Index for date-based queries
PipelineMetricsSchema.index({ date: -1 });

export default mongoose.model('PipelineMetrics', PipelineMetricsSchema);

