// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// 5c-2: CLI + 구독 토큰 모드. CLAUDE_CODE_OAUTH_TOKEN 미설정 시 부트 실패.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

// 필수 환경변수 검증 — 누락 시 fail-fast.
const REQUIRED_ENV = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'INTERNAL_SERVICE_TOKEN',
  'WORKPLACE_AGENT_API_KEY',
  'WORKPLACE_API_BASE_URL',
];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`[ai-agent] ${k} 미설정 — 부트 중단`);
    process.exit(1);
  }
}

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());

// /health 는 인증 없이 노출.
app.use(healthRouter);
// /events 는 사내 서비스 인증 필수.
app.use(internalAuth, createEventsRouter());

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// Claude CLI / MCP child 가 abort 시 던지는 rejection 은 swallow — firehub 패턴.
process.on('unhandledRejection', (reason: unknown) => {
  const m = reason instanceof Error ? reason.message : String(reason);
  if (m.includes('aborted')) {
    console.warn('[process] suppressed abort rejection:', m);
  } else {
    console.error('[process] unhandled rejection:', reason);
  }
});

const server = app.listen(PORT, () => {
  console.log(`workplace-ai-agent listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /events`);
});

function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
