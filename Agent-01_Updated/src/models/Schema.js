import mongoose from 'mongoose';

const SchemaSchema = new mongoose.Schema({
  docId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    unique: true,
  },
  version: {
    type: Number,
    default: 1
  },
  // Schema structure: { nodes: { LabelName: [props] }, relationships: [...] }
  nodes: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  relationships: {
    type: [mongoose.Schema.Types.Mixed],
    required: true
  },
  // Raw LLM response for debugging
  rawResponse: {
    type: String,
    default: null
  },
  extractionModel: {
    type: String,
    default: null
  },
  extractionProvider: {
    type: String,
    enum: ['ollama', 'huggingface', 'azure'],
    default: 'azure'
  }
}, {
  timestamps: true
});

SchemaSchema.index({ docId: 1, version: 1 });

export default mongoose.model('Schema', SchemaSchema);

