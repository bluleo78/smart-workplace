// src/mcp/server.ts — 요청별 stateless MCP 서버 구성.
// 세션을 유지하지 않는다: 매 POST 마다 새 McpServer + Transport (수평 확장·재기동 내성).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

import { createPatApiClient } from '../clients/workplace-api.js';
import { buildUserTools } from '../tools/index.js';

/** 도구 배열을 McpServer 에 등록. 핸들러 문자열 반환 → content 로 래핑, 예외 → isError. */
export function buildMcpServer(apiBaseUrl: string, token: string): McpServer {
  const client = createPatApiClient({ baseURL: apiBaseUrl, token });
  const server = new McpServer({ name: 'smart-workplace', version: '0.1.0' });
  for (const t of buildUserTools(client)) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema.shape },
      async (args: unknown) => {
        try {
          return { content: [{ type: 'text' as const, text: await t.handler(args) }] };
        } catch (e) {
          // axios 에러는 상태코드+서버 메시지를 요약해 전달 (토큰 만료/권한 부족이 즉시 드러나도록)
          const msg = summarizeError(e);
          return { isError: true, content: [{ type: 'text' as const, text: msg }] };
        }
      },
    );
  }
  return server;
}

function summarizeError(e: unknown): string {
  if (axiosLike(e)) {
    const s = e.response?.status;
    const m = JSON.stringify(e.response?.data ?? '');
    if (s === 401) {
      return 'API 인증 실패(401) — 토큰이 만료·폐기되었을 수 있습니다. 설정에서 새 토큰을 발급하세요.';
    }
    return `API 오류 ${s ?? ''}: ${m}`;
  }
  return e instanceof Error ? e.message : String(e);
}
function axiosLike(e: unknown): e is { response?: { status?: number; data?: unknown } } {
  return typeof e === 'object' && e !== null && 'response' in e;
}

/** POST /mcp 핸들러 — Bearer swp_ 추출 → (initialize 면 /auth/me 로 조기 검증) → stateless 처리. */
export async function handleMcpPost(apiBaseUrl: string, req: Request, res: Response): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer swp_')) {
    res
      .status(401)
      .json({ jsonrpc: '2.0', error: { code: -32001, message: 'PAT(Bearer swp_...) 가 필요합니다' }, id: null });
    return;
  }
  const token = auth.slice('Bearer '.length);

  // initialize 요청이면 workplace-api 로 토큰을 조기 검증해 연결 시점에 401 을 돌려준다 (UX).
  const isInit = Array.isArray(req.body)
    ? req.body.some((m) => m?.method === 'initialize')
    : req.body?.method === 'initialize';
  if (isInit) {
    try {
      await createPatApiClient({ baseURL: apiBaseUrl, token }).getMe();
    } catch {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: '토큰 인증 실패 — 만료·폐기 여부를 확인하세요' },
        id: null,
      });
      return;
    }
  }

  const server = buildMcpServer(apiBaseUrl, token);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
