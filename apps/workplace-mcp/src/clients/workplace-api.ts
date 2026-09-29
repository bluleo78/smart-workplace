// src/clients/workplace-api.ts — PAT 패스스루 REST 클라이언트.
// ai-agent 와 같은 REST 표면을 쓰되, Internal 토큰 + X-On-Behalf-Of 대신 사용자 PAT 를 Bearer 로 그대로 전달한다
// (신원·테넌트는 서버 필터가 토큰에서 해석).
//
// #846: 도구가 부르는 경로 매핑은 공유 패키지(createSharedToolClient)에 있다 — 여기서는 인증 헤더가 붙은 HTTP 인스턴스만 만든다.
import axios from 'axios';
import { createSharedToolClient, type SharedToolClient } from '@smart-workplace/mcp-tools-shared';

/** PAT 클라이언트 — 공유 도구 클라이언트 그대로. initialize 토큰 조기 검증도 공유 getMe(GET /auth/me)를 쓴다. */
export type PatApiClient = SharedToolClient;

/** PAT 토큰을 Authorization: Bearer 헤더로 부착하는 axios 기반 REST 클라이언트를 생성한다. */
export function createPatApiClient(opts: { baseURL: string; token: string }): PatApiClient {
  const http = axios.create({ baseURL: opts.baseURL, headers: { Authorization: `Bearer ${opts.token}` } });
  return createSharedToolClient(http);
}
