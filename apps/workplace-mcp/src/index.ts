// workplace-mcp 부트스트랩.
// 무비밀(secretless) 게이트웨이: 시크릿 env 없음. 클라이언트 PAT 를 workplace-api 로 패스스루한다.
import dotenv from 'dotenv';
import express from 'express';

import { DEFAULT_API_BASE_URL, DEFAULT_PORT } from './constants.js';
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
  app.use(express.json({ limit: '4mb' }));
  app.use(healthRouter); // 인증 앞 — 무인증
  app.post('/mcp', (req, res) => {
    handleMcpPost(deps.apiBaseUrl, req, res).catch((e) => {
      console.error('[mcp] request failed', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
    });
  });
  // stateless 모드 — 세션 스트림/종료 미지원을 명시.
  app.get('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').end();
  });
  app.delete('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').end();
  });
  return app;
}

// 직접 실행시에만 listen (테스트에서는 createApp 만 사용).
if (process.env.VITEST === undefined) {
  const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
  const apiBaseUrl = process.env.WORKPLACE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const server = createApp({ apiBaseUrl }).listen(PORT, () => {
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
