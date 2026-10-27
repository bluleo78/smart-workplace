// workplace-mcp 부트스트랩.
// 무비밀(secretless) 게이트웨이: 시크릿 env 없음. 클라이언트 PAT 를 workplace-api 로 패스스루한다.
import type { Server } from 'node:http';

import dotenv from 'dotenv';
import express from 'express';

import { DEFAULT_API_BASE_URL, DEFAULT_PORT } from './constants.js';
import type { McpRoute } from './mcp/scope.js';
import { createAuthCache } from './mcp/auth-cache.js';
import { handleMcpPost } from './mcp/server.js';
import { healthRouter } from './routes/health.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

export interface AppDeps {
  apiBaseUrl: string;
}

/** Express 앱 팩토리 — 테스트에서 listen 없이 supertest 로 검증하기 위해 분리. */
export function createApp(deps: AppDeps): express.Express {
  const app = express();
  // 토큰 검증 성공 기억(WP-1013) — 앱마다 하나라 테스트도 앱을 새로 만들면 비어 있다.
  const authCache = createAuthCache();
  app.use(express.json({ limit: '4mb' }));
  app.use(healthRouter); // 인증 앞 — 무인증
  // 연결 범위(WP-350): /mcp(전체) · /mcp/readonly · /mcp/x/{apps} · /mcp/x/{apps}/readonly. 헤더 X-MCP-Toolsets 는 핸들러가 읽는다.
  // 라우트별로 읽은 범위만 넘기고, 검증(앱 이름)과 도구 선택은 handleMcpPost 가 한다.
  const post = (route: McpRoute): express.RequestHandler<{ apps?: string }> => (req, res) => {
    const pathApps = req.params.apps; // :apps 가 있는 라우트에서만 값이 있다(문자열 하나)
    handleMcpPost(deps.apiBaseUrl, authCache, req, res, pathApps === undefined ? route : { ...route, pathApps }).catch((e) => {
      console.error('[mcp] request failed', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
    });
  };
  app.post('/mcp', post({ readOnly: false }));
  app.post('/mcp/readonly', post({ readOnly: true }));
  app.post('/mcp/x/:apps', post({ readOnly: false }));
  app.post('/mcp/x/:apps/readonly', post({ readOnly: true }));
  // stateless 모드 — 세션 스트림/종료 미지원을 명시(범위 경로도 같다).
  const notAllowed: express.RequestHandler = (_req, res) => {
    res.status(405).set('Allow', 'POST').end();
  };
  for (const path of ['/mcp', '/mcp/readonly', '/mcp/x/:apps', '/mcp/x/:apps/readonly']) {
    app.get(path, notAllowed);
    app.delete(path, notAllowed);
  }
  return app;
}

/**
 * 앞단 nginx 의 upstream keep-alive(ingress-nginx 기본 60초)보다 Node 가 유휴 연결을 늦게 닫게 한다(WP-1013).
 * Node 기본값(5초)이면 nginx 가 이미 닫힌 연결을 다시 써 요청 하나가 502(upstream prematurely closed)로 끝난다.
 * headersTimeout 은 keepAliveTimeout 보다 커야 한다(Node 문서 권고).
 */
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;

/** 앱을 띄우고 keep-alive 시간을 맞춘 서버를 돌려준다. */
export function listen(app: express.Express, port: number, onListening?: () => void): Server {
  const server = app.listen(port, onListening);
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}

// 직접 실행시에만 listen (테스트에서는 createApp 만 사용).
if (process.env.VITEST === undefined) {
  const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
  const apiBaseUrl = process.env.WORKPLACE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const server = listen(createApp({ apiBaseUrl }), PORT, () => {
    console.log(`[workplace-mcp] listening on :${PORT} → ${apiBaseUrl}`);
  });
  // graceful shutdown — ai-agent index.ts 의 SIGTERM/SIGINT 처리 미러.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5_000).unref();
    });
  }
}
