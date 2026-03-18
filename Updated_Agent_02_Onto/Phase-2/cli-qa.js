/**
 * CLI Q&A for PHYSICAL MODEL leaders
 *
 * - Reads precomputed JSON artifacts:
 *   - physical_lineage.json
 *   - physical_impact.json
 *   - physical_graph_insights.json
 * - Sends ONLY those facts to the LLM
 * - LLM answers in simple English (leader/manager friendly)
 * - LLM does NOT change the model or compute anything
 *
 * Usage:
 *   node cli-qa.js <fileId>
 */

// CRITICAL: Load .env FIRST before any other imports
import './loadEnv.js';

import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import config from './src/config.js';
import { readJSON } from './src/utils/fileUtils.js';
import { initializeLangChain, isLangChainReady } from '../Phase-1/src/llm/azureLangChainService.js';
import { runQaAgent } from './src/agents/qaAgent.js';
import { buildModelContext } from './src/agents/metadataAnalyzer.js';
import { verifyEnv } from './loadEnv.js';

function log(msg) {
  console.log(msg);
}

async function loadArtifactSafe(p, label) {
  try {
    const data = await readJSON(p);
    log(`✓ Loaded ${label} from ${p}`);
    return data;
  } catch {
    log(`⚠ ${label} not found or unreadable at ${p}`);
    return null;
  }
}

async function main() {
  const fileId = process.argv[2];
  if (!fileId) {
    console.error('Usage: node cli-qa.js <fileId>');
    process.exit(1);
  }

  log('');
  log(`📊 PHYSICAL MODEL Q&A CLI`);
  log(`File ID: ${fileId}`);
  log('');
  
  // Verify environment is loaded
  const envStatus = verifyEnv();
  if (!envStatus.hasApiKey || !envStatus.hasEndpoint) {
    log(`⚠ Environment check: API Key=${envStatus.hasApiKey}, Endpoint=${envStatus.hasEndpoint}`);
    log(`   Looking for .env at: ${path.join(__dirname, '..', 'Phase-1', '.env')}`);
  }

  // Determine artifact paths (Phase-1 artifacts for this fileId)
  const baseDir = config.phase1ArtifactsDir;
  const physicalDir = path.join(baseDir, fileId, 'physical');

  const lineagePath = path.join(physicalDir, 'physical_lineage.json');
  const impactPath = path.join(physicalDir, 'physical_impact.json');
  const insightsPath = path.join(physicalDir, 'physical_graph_insights.json');

  // Load metadata.json (required)
  const metadataPath = path.join(baseDir, fileId, 'json', 'metadata.json');
  const metadata = await loadArtifactSafe(metadataPath, 'Metadata');
  
  if (!metadata) {
    console.error('❌ Metadata file not found.');
    console.error(`   Expected: ${metadataPath}`);
    process.exit(1);
  }
  
  log('✓ Loaded metadata.json');
  
  // Try to load precomputed analysis artifacts (optional)
  const [precomputedLineage, precomputedImpact, precomputedInsights] = await Promise.all([
    loadArtifactSafe(lineagePath, 'Precomputed Lineage'),
    loadArtifactSafe(impactPath, 'Precomputed Impact'),
    loadArtifactSafe(insightsPath, 'Precomputed Graph insights')
  ]);
  
  // Extract lineage, impact, and insights directly from metadata
  log('✓ Analyzing metadata to extract lineage, impact, and graph insights...');
  const modelContext = buildModelContext(metadata);
  
  // Use precomputed if available, otherwise use extracted
  const lineage = precomputedLineage || modelContext.lineage;
  const impact = precomputedImpact || modelContext.impact;
  const insights = precomputedInsights || modelContext.insights;
  
  log('✓ Model analysis complete - Ready for questions!');

  // Initialize LangChain once
  try {
    if (!isLangChainReady()) {
      await initializeLangChain();
    }
  } catch (err) {
    console.error(`❌ LangChain initialization failed: ${err.message}`);
    console.error('You can still inspect JSON artifacts manually in the physical folder.');
    process.exit(1);
  }

  log('');
  log('💬 Talk directly to your data model! Ask ANYTHING:');
  log('');
  log('   Examples:');
  log('   - "Tell me everything about sec_master table"');
  log('   - "What are all the relationships in this model?"');
  log('   - "Show me the complete dependency graph"');
  log('   - "What are the risks and issues?"');
  log('   - "Compare tables in the Security domain"');
  log('   - "What columns are missing primary keys?"');
  log('   - "Explain the lineage of customer_id column"');
  log('   - "What happens if I modify order table?"');
  log('   - "Give me a complete overview of this model"');
  log('   - "What are the patterns in column naming?"');
  log('   - "Show me statistics and metrics"');
  log('   - "What domains exist and what tables belong to them?"');
  log('   - "Tell me everything" or "What can you tell me?"');
  log('');
  log('   Ask ANYTHING - the model has complete information!');
  log('Type "exit" to quit.');
  log('');

  // Build context for Q&A agent - talk directly to the model
  const qaContext = {
    fileId,
    lineage: lineage,
    impact: impact,
    insights: insights,
    metadata: metadata, // Full metadata for deep analysis
  };

  // Conversation history (maintained across questions)
  let conversationHistory = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Q> '
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const question = line.trim();
    if (!question || question.toLowerCase() === 'exit' || question.toLowerCase() === 'quit') {
      rl.close();
      return;
    }

    try {
      console.log('\n…Thinking based on lineage, impact and graph insights…\n');

      // Use LangGraph Q&A agent with memory and automatic retries
      const result = await runQaAgent(question, qaContext, conversationHistory);
      
      // Update conversation history
      conversationHistory = result.conversationHistory;

      const trimmed = (result.answer || '').trim();

      if (!trimmed) {
        console.log('');
        console.log('A> The system did not return a response. Please try again.');
        console.log('');
      } else {
        console.log('');
        if (result.retryCount > 0) {
          console.log(`A> ${trimmed} (Retried ${result.retryCount} time(s))`);
        } else {
          console.log(`A> ${trimmed}`);
        }
        console.log('');
      }
    } catch (err) {
      console.error(`❌ LangChain error: ${err.message}`);
      logger.error({ error: err.message, stack: err.stack }, "Q&A CLI error");
    }

    rl.prompt();
  }).on('close', () => {
    console.log('\n👋 Done. Closing PHYSICAL MODEL Q&A CLI.');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});


