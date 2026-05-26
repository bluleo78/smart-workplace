// Workplace MCP server — Claude CLI 가 stdio child 로 띄우는 entry point.
// #34: INTERNAL_SERVICE_TOKEN + ACTING_AGENT_ID env 로부터 agentId 를 받아 closure 바인딩.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { createWorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools } from './tools.js';

async function main(): Promise<void> {
  const baseURL = process.env.WORKPLACE_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const actingAgentIdRaw = process.env.ACTING_AGENT_ID;
  const actingAgentId = Number(actingAgentIdRaw);

  if (!baseURL || !internalToken || !Number.isFinite(actingAgentId)) {
    console.error('[workplace-mcp] 환경변수 누락 또는 ACTING_AGENT_ID 형식 오류', {
      hasBaseURL: !!baseURL,
      hasInternalToken: !!internalToken,
      actingAgentIdRaw,
    });
    process.exit(1);
  }

  const client = createWorkplaceApiClient({ baseURL, internalToken });
  const tools = buildTools(client, actingAgentId);

  const server = new Server(
    { name: 'workplace', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema as never, {
        $refStrategy: 'none',
      }) as never,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const out = await tool.handler(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: out }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: 'text', text: msg }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[workplace-mcp] connected via stdio (acting as agent', actingAgentId, ')');
}

main().catch((e) => {
  console.error('[workplace-mcp] fatal:', e);
  process.exit(1);
});
