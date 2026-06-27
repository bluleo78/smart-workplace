// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// #34: INTERNAL_SERVICE_TOKEN 단일 부트스트랩. WORKPLACE_AGENT_API_KEY 제거.
// 호출 시 X-On-Behalf-Of 헤더로 대행 AGENT 명시.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';
import { createHomeRouter } from './routes/home.js';
import { createMailRouter } from './routes/mail.js';
import { createMessagingRouter } from './routes/messaging.js';
import { createWikiRouter } from './routes/wiki.js';
import { createIssueRouter } from './routes/issue.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const REQUIRED_ENV = [
  'INTERNAL_SERVICE_TOKEN',
  'WORKPLACE_API_BASE_URL',
];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`[ai-agent] ${k} 미설정 — 부트 중단`);
    process.exit(1);
  }
}

// 모든 workplace-api 호출은 Internal 인증 + X-On-Behalf-Of 헤더로 대행 AGENT 명시.
const workplaceApi = createWorkplaceApiClient({
  baseURL: process.env.WORKPLACE_API_BASE_URL,
  internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
});

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());
app.use(healthRouter);
app.use(internalAuth);
app.use(createEventsRouter({ client: workplaceApi }));
app.use(createHomeRouter({ client: workplaceApi }));
app.use(createMailRouter({ client: workplaceApi }));
app.use(createMessagingRouter({ client: workplaceApi }));
app.use(createWikiRouter({ client: workplaceApi }));
app.use(createIssueRouter({ client: workplaceApi }));

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
  console.log('  POST /ai/chat');
  console.log('  POST /mail/classify | /mail/summarize | /mail/reply-draft');
  console.log('  POST /messaging/classify');
  console.log('  POST /wiki/compose (SSE)');
});

function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
