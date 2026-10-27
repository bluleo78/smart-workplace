// src/mcp/server.ts — 요청별 stateless MCP 서버 구성.
// 세션을 유지하지 않는다: 매 POST 마다 새 McpServer + Transport (수평 확장·재기동 내성).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { describeApiError, toMcpContent, toolAnnotations, toolDefinition } from '@smart-workplace/mcp-tools-shared';
import type { z } from 'zod';

import { agentToolFromUserAgent } from './agent-tool.js';
import type { AuthCache } from './auth-cache.js';
import { createPatApiClient, verifyToken } from '../clients/workplace-api.js';
import { buildUserTools } from '../tools/index.js';
import { buildInstructions } from './instructions.js';
import { FULL_SCOPE, InvalidScopeError, resolveScope, type McpRoute, type McpScope } from './scope.js';

/** 접속 토큰 형식 — 사람 PAT(swp_) 또는 AI 키(ak_). 인증 헤더 검사는 이 정규식 한 번으로 한다. */
const BEARER_TOKEN = /^Bearer (swp_|ak_)/;
const AGENT_KEY_PREFIX = 'ak_';

/** AI(에이전트) 키인지 — 테넌트 선택 헤더 전달 등 AI 키 전용 동작의 판별 기준. */
function isAgentKey(token: string): boolean {
  return token.startsWith(AGENT_KEY_PREFIX);
}

/**
 * X-On-Behalf-Of-Tenant 헤더 값 — AI 키에서만 전달한다(사람 PAT 의 테넌트는 토큰이 정한다).
 * 헤더가 중복돼 배열이면 첫 값, 비어 있으면 undefined.
 */
function readTenantHeader(req: Request, token: string): string | undefined {
  if (!isAgentKey(token)) return undefined;
  const raw = req.headers['x-on-behalf-of-tenant'];
  return (Array.isArray(raw) ? raw[0] : raw) || undefined;
}

/** 도구 배열을 McpServer 에 등록. 핸들러 반환 → content(문자열은 text 블록, 블록 배열은 그대로 — WP-240), 예외 → isError. */
export function buildMcpServer(
  apiBaseUrl: string,
  token: string,
  scope: McpScope = FULL_SCOPE,
  /** X-On-Behalf-Of-Tenant(ak_ 전용) — workplace-api 호출 헤더에 쓴다. */
  tenantId?: string,
  /** 수행 도구 이름(User-Agent 에서 추출) — X-Agent-Tool 헤더로 실린다(WP-377). */
  agentTool?: string,
): McpServer {
  const client = createPatApiClient({ baseURL: apiBaseUrl, token, tenantId, agentTool });
  // serverInfo — name 은 설정 키가 없을 때 도구 이름 접두사로 쓰는 클라이언트가 있어 영문·숫자·-·_ 만 쓰고,
  // 브랜드 표기(콜론·공백 포함)는 표시용 title 로 둔다(WP-334).
  // WP-350: 연결 범위에 맞춰 도구를 추리고, instructions 도 로드된 도구만 설명하도록 같은 목록으로 만든다.
  const tools = buildUserTools(client, scope);
  const server = new McpServer(
    { name: 'genia-works', title: 'Gen:iA Works', version: '0.1.0' },
    { instructions: buildInstructions(tools, scope) },
  );
  for (const t of tools) {
    // WP-342: 힌트는 kind(노출 여부)가 아니라 연산 성격(추가/덮어쓰기·제거, 멱등, 외부 접근)으로 계산한다.
    // 클라이언트(Claude·ChatGPT)는 이 값으로 읽기는 자동 승인하고, 덮어쓰기·제거는 확인을 받는다.
    const annotations = toolAnnotations(t);
    server.registerTool(
      t.name,
      {
        // 표시 이름 — tools/list 는 아래 toolDefinition 으로 바꿔 끼우므로 top-level title 만 나간다(annotations.title 은 중복이라 뺀다).
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
  // WP-340 웨이브 5: tools/list 응답을 공유 패키지의 toolDefinition 출력으로 바꿔 끼운다 — 도구 정의 크기 상한(tool-naming.test.ts)이 재는 값이
  // 곧 나가는 값이 되고, SDK 가 도구마다 붙이던 `$schema`·안전 정수 경계·execution 과 null 허용 표시가 빠진다. 호출(tools/call)과 입력 검증은
  // 위 registerTool 그대로다(SDK 가 zod shape 로 검증). 도구 핸들러 초기화는 첫 registerTool 에서만 일어나 이 교체를 덮어쓰지 않는다.
  // 도구가 하나도 없으면 SDK 가 tools 기능 자체를 등록하지 않아 교체할 대상도 없다.
  // 등록 시점 스냅샷이다 — 등록 도구의 disable()/update() 는 반영하지 않는다(현재 호출처 없음, 서버는 요청마다 새로 만든다).
  if (tools.length > 0) {
    const definitions = tools.map(toolDefinition);
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: definitions }));
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
/** 토큰 검증(/auth/me) 시간 제한. */
const AUTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * 토큰 검증 실패를 HTTP 상태와 JSON-RPC 오류로 바꾼다(WP-1013).
 * - 401: 토큰이 만료·폐기됨 → 401(클라이언트가 재인증).
 * - 그 밖의 4xx(403 테넌트 권한·429·400 등): 같은 상태 + 서버 메시지 — 토큰은 멀쩡할 수 있어 401 로 뭉개지 않는다.
 * - 응답 없음(연결 실패·시간 초과)·5xx: 503 — 401 로 주면 클라이언트가 멀쩡한 토큰을 버린다.
 */
function authFailure(e: unknown): [number, { code: number; message: string }] {
  const response = axiosLike(e) ? e.response : undefined;
  const status = response?.status;
  if (status === 401) return [401, { code: -32001, message: '토큰 인증 실패 — 만료·폐기 여부를 확인하세요' }];
  if (status !== undefined && status >= 400 && status < 500) {
    return [status, { code: -32001, message: `토큰 확인이 거절되었습니다 — ${describeApiError(status, response?.data)}` }];
  }
  return [503, { code: -32603, message: '인증 서버에 연결할 수 없습니다 — 잠시 후 다시 시도하세요' }];
}

function axiosLike(e: unknown): e is { response?: { status?: number; data?: unknown } } {
  return typeof e === 'object' && e !== null && 'response' in e;
}

/**
 * POST /mcp 계열 핸들러 — Bearer swp_(사람 PAT) 또는 ak_(AI 키) 추출 → 연결 범위 검증 → /auth/me 로 토큰 검증(성공은 authCache 가 잠깐 기억) → stateless 처리.
 * route 는 라우터가 URL 에서 읽은 범위(WP-350)이고, 기본 `/mcp` 는 생략한다(= 전체 노출, 헤더 없으면 기존과 동일).
 */
export async function handleMcpPost(
  apiBaseUrl: string,
  authCache: AuthCache,
  req: Request,
  res: Response,
  route: McpRoute = { readOnly: false },
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !BEARER_TOKEN.test(auth)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'PAT(Bearer swp_...) 또는 AI 키(Bearer ak_...) 가 필요합니다' },
      id: null,
    });
    return;
  }
  const token = auth.slice('Bearer '.length);
  const tenantId = readTenantHeader(req, token);
  // WP-377: AI 작업 보고의 출처 — 클라이언트 User-Agent 의 제품 토큰을 X-Agent-Tool 로 api 에 넘긴다.
  const agentTool = agentToolFromUserAgent(req.headers['user-agent']);

  // 앱 이름이 틀리면 도구를 일부만 싣지 않고 400 + 사용 가능한 목록으로 거절한다. 인증 뒤·/auth/me 앞에서 해 불필요한 API 호출을 피한다.
  // 본문은 이 서버의 다른 사전 거절(401)과 같은 JSON-RPC 오류 모양이다 — Streamable HTTP 클라이언트는 비 2xx 본문을 오류 메시지로 보여 준다.
  let scope: McpScope;
  try {
    scope = resolveScope(route, req.headers['x-mcp-toolsets']);
  } catch (e) {
    if (!(e instanceof InvalidScopeError)) throw e;
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32602, message: e.message, data: { availableApps: e.available } }, id: null });
    return;
  }

  // 모든 요청에서 토큰을 workplace-api 로 검증한다(WP-1013). 전에는 initialize 만 검증해, 형식만 맞춘 가짜 토큰으로도
  // tools/list 가 도구 목록을 내줬고 그런 요청마다 도구 전체를 등록한 서버를 새로 만들었다. 성공은 잠깐 기억해 요청마다 부르지 않는다.
  try {
    // /auth/me 는 사람·AI 모두 인증된 userId 로 응답한다(AGENT 키 필터도 userId principal 을 세움).
    await authCache.verify(token, tenantId, () =>
      verifyToken({ baseURL: apiBaseUrl, token, tenantId, agentTool, timeoutMs: AUTH_CHECK_TIMEOUT_MS }),
    );
  } catch (e) {
    const [status, error] = authFailure(e);
    res.status(status).json({ jsonrpc: '2.0', error, id: null });
    return;
  }

  const server = buildMcpServer(apiBaseUrl, token, scope, tenantId, agentTool);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
