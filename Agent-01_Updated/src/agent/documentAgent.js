/**
 * Document-to-Graph Agent (LangGraph)
 * Agentic AI: uses tools to parse, extract schema, generate Cypher, ingest to Neo4j
 */

import { StateGraph, END } from '@langchain/langgraph';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { AzureChatOpenAI } from '@langchain/openai';
import { createPipelineTools } from './tools.js';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are a document-to-graph pipeline agent. Your job is to convert business documents (PDF, DOCX, TXT) into a Neo4j knowledge graph.

You have these tools:
1. parse_document - Extract text from a document (call first)
2. extract_schema - Extract graph schema (nodes, relationships) from parsed text
3. generate_cypher - Generate Neo4j Cypher MERGE statements
4. ingest_to_neo4j - Execute Cypher and load data into Neo4j
5. get_status - Check current pipeline status for a document

When the user asks to "convert document X to graph" or "process document X":
- Call parse_document with the docId
- Then extract_schema
- Then generate_cypher
- Then ingest_to_neo4j

If a step fails, report the error to the user. If the user asks for status, use get_status.

Always use the docId provided by the user. Output clear, concise responses.`;

/**
 * Create and run the document agent
 */
export async function runDocumentAgent(userMessage, docId = null) {
  const azureConfig = config.azure;

  if (!azureConfig?.apiKey || !azureConfig?.endpoint) {
    throw new Error('Azure OpenAI not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT.');
  }

  const endpointUrl = new URL(azureConfig.endpoint);
  const instanceName = endpointUrl.hostname.split('.')[0];

  const llm = new AzureChatOpenAI({
    azureOpenAIApiKey: azureConfig.apiKey,
    azureOpenAIApiInstanceName: instanceName,
    azureOpenAIApiDeploymentName: azureConfig.deploymentName || 'gpt-4.1',
    azureOpenAIApiVersion: azureConfig.apiVersion || '2025-01-01-preview',
    temperature: 0.1,
    maxTokens: 2048,
  });

  const tools = createPipelineTools();
  const llmWithTools = llm.bindTools(tools);

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['human', '{input}'],
  ]);

  const chain = prompt.pipe(llmWithTools);

  const messages = [];
  let input = userMessage;
  if (docId) input += `\n\nDocument ID: ${docId}`;

  let response = await chain.invoke({ input });
  messages.push(new HumanMessage(input));
  messages.push(response);

  let round = 0;
  const maxRounds = 10;

  while (round < maxRounds) {
    const toolCalls = response.tool_calls || [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const tool = tools.find(t => t.name === tc.name);
      const args = typeof tc.args === 'string' ? JSON.parse(tc.args || '{}') : (tc.args || {});
      const docIdToUse = args.docId || docId;

      if (!docIdToUse && tc.name !== 'get_status') {
        messages.push(new ToolMessage({ content: JSON.stringify({ success: false, error: 'docId is required' }), tool_call_id: tc.id }));
        continue;
      }

      let result;
      try {
        result = tool ? await tool.invoke(docIdToUse ? { docId: docIdToUse } : args) : JSON.stringify({ error: `Unknown tool: ${tc.name}` });
      } catch (err) {
        result = JSON.stringify({ success: false, error: err.message });
      }
      messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
    }

    response = await llmWithTools.invoke(messages);
    messages.push(response);
    round++;
  }

  const answer = response?.content || 'Done.';
  logger.info('Document agent completed', { rounds: round, hasAnswer: !!answer });
  return { answer, messages };
}
