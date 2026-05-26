// Workplace MCP server — Claude CLI 가 stdio child 로 띄우는 entry point.
// `node dist/mcp/workplace-mcp-server.js` 로 실행. 환경변수에서 workplace-api
// 접속 정보를 읽고 4 도구를 등록한다.
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
  const apiKey = process.env.WORKPLACE_AGENT_API_KEY;
  if (!baseURL || !apiKey) {
    console.error(
      '[workplace-mcp] WORKPLACE_API_BASE_URL / WORKPLACE_AGENT_API_KEY 미설정',
    );
    process.exit(1);
  }

  const client = createWorkplaceApiClient({ baseURL, apiKey });
  const tools = buildTools(client);

  const server = new Server(
    { name: 'workplace', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      // zod-to-json-schema 는 zod v3 타입을 기대 — runtime 형상은 v4 와 호환되므로 cast.
      inputSchema: zodToJsonSchema(t.inputSchema as never, {
        $refStrategy: 'none',
      }),
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
  console.error('[workplace-mcp] connected via stdio');
}

main().catch((e) => {
  console.error('[workplace-mcp] fatal:', e);
  process.exit(1);
});
