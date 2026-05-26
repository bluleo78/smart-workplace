// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// 5c-2 후속 (#33): OAuth 토큰은 매 spawn 시 workplace-api 에서 fetch — 호스트 ~/.claude/ 의존 없음.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const REQUIRED_ENV = [
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

// OAuth 토큰 fetch + 도메인 호출 모두에 사용되는 단일 client.
const workplaceApi = createWorkplaceApiClient({
  baseURL: process.env.WORKPLACE_API_BASE_URL,
  apiKey: process.env.WORKPLACE_AGENT_API_KEY ?? '',
});

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());
app.use(healthRouter);
app.use(internalAuth, createEventsRouter({ client: workplaceApi }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

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
