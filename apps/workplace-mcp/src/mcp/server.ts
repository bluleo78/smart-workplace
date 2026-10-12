// src/mcp/server.ts — 요청별 stateless MCP 서버 구성.
// 세션을 유지하지 않는다: 매 POST 마다 새 McpServer + Transport (수평 확장·재기동 내성).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { describeApiError, toMcpContent, toolAnnotations } from '@smart-workplace/mcp-tools-shared';
import type { z } from 'zod';

import { createPatApiClient } from '../clients/workplace-api.js';
import { buildUserTools } from '../tools/index.js';

/** 도구 배열을 McpServer 에 등록. 핸들러 반환 → content(문자열은 text 블록, 블록 배열은 그대로 — WP-240), 예외 → isError. */
export function buildMcpServer(apiBaseUrl: string, token: string): McpServer {
  const client = createPatApiClient({ baseURL: apiBaseUrl, token });
  // serverInfo — name 은 설정 키가 없을 때 도구 이름 접두사로 쓰는 클라이언트가 있어 영문·숫자·-·_ 만 쓰고,
  // 브랜드 표기(콜론·공백 포함)는 표시용 title 로 둔다(WP-334).
  const server = new McpServer({ name: 'genia-works', title: 'Gen:iA Works', version: '0.1.0' });
  for (const t of buildUserTools(client)) {
    // WP-342: 힌트는 kind(노출 여부)가 아니라 연산 성격(추가/덮어쓰기·제거, 멱등, 외부 접근)으로 계산한다.
    // 클라이언트(Claude·ChatGPT)는 이 값으로 읽기는 자동 승인하고, 덮어쓰기·제거는 확인을 받는다.
    const annotations = toolAnnotations(t);
    server.registerTool(
      t.name,
      {
        // 표시 이름 — 클라이언트 도구 목록에는 top-level title 이 쓰이고, annotations.title 은 구버전 클라이언트용이다.
        title: annotations.title,
        description: t.description,
        inputSchema: (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape,
        annotations,
      },
      async (args: unknown) => {
        try {
          return { content: toMcpContent(await t.handler(args)) };
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
    if (s === 401) {
      return 'API 인증 실패(401) — 토큰이 만료·폐기되었을 수 있습니다. 설정에서 새 토큰을 발급하세요.';
    }
    // #840: 서버 ErrorResponse 를 ai-agent 와 같은 한 줄 요약으로(원문 JSON 덤프 대신 message·필드 오류).
    return describeApiError(s, e.response?.data);
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
