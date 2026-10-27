// src/clients/workplace-api.ts — PAT 패스스루 REST 클라이언트.
// ai-agent 와 같은 REST 표면을 쓰되, Internal 토큰 + X-On-Behalf-Of 대신 사용자 PAT 를 Bearer 로 그대로 전달한다
// (신원·테넌트는 서버 필터가 토큰에서 해석).
//
// #846: 도구가 부르는 경로 매핑은 공유 패키지(createSharedToolClient)에 있다 — 여기서는 인증 헤더가 붙은 HTTP 인스턴스만 만든다.
import axios from 'axios';
import { createSharedToolClient, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';

/** PAT 클라이언트 — 공유 도구 클라이언트 그대로. */
export type PatApiClient = SharedToolClient;

/** 접속 토큰과 부가 정보 — 도구 호출·토큰 검증이 같은 헤더를 쓴다. */
export interface PatAuth {
  baseURL: string;
  token: string;
  /** AI 키(ak_) 전용 X-On-Behalf-Of-Tenant 값 — 키에는 테넌트가 없어 다중 멤버십 AI 는 이 헤더로 고른다(서버가 멤버십 검증). */
  tenantId?: string;
  /** X-Agent-Tool 헤더 값(수행 도구 이름, WP-377) — 생략하면 'mcp' 라 헤더는 항상 실린다. */
  agentTool?: string;
}

function authHeaders(opts: PatAuth): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}`, 'X-Agent-Tool': opts.agentTool ?? 'mcp' };
  if (opts.tenantId) headers['X-On-Behalf-Of-Tenant'] = opts.tenantId;
  return headers;
}

/** 토큰(PAT 또는 AGENT API 키)을 Authorization: Bearer 헤더로 부착하는 axios 기반 REST 클라이언트를 생성한다. */
export function createPatApiClient(opts: PatAuth): PatApiClient {
  return createSharedToolClient(axios.create({ baseURL: opts.baseURL, headers: authHeaders(opts) }));
}

/**
 * 토큰을 workplace-api(GET /auth/me)로 검증한다 — 실패하면 axios 오류를 던진다(WP-1013).
 * 모든 MCP 요청 앞에서 부르므로 도구 클라이언트 전체를 만들지 않고 한 번만 호출하며, workplace-api 가 멈춰도 요청이 쌓이지 않게 시간 제한을 둔다.
 */
export async function verifyToken(opts: PatAuth & { timeoutMs: number }): Promise<void> {
  await axios.get('/auth/me', { baseURL: opts.baseURL, headers: authHeaders(opts), timeout: opts.timeoutMs });
}
