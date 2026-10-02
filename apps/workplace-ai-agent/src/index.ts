// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown(진행 중 작업 대기, WP-167).
// #34: INTERNAL_SERVICE_TOKEN 단일 부트스트랩. WORKPLACE_AGENT_API_KEY 제거.
// 호출 시 X-On-Behalf-Of 헤더로 대행 AGENT 명시.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { closeAllServers } from './agent/opencode-server-pool.js';
import { DEFAULT_PORT } from './constants.js';
import { gracefulShutdown } from './graceful-shutdown.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';
import { createHomeRouter } from './routes/home.js';
import { createMailRouter } from './routes/mail.js';
import { createMessagingRouter } from './routes/messaging.js';
import { createWikiRouter } from './routes/wiki.js';
import { createIssueRouter } from './routes/issue.js';
import { createDriveRouter } from './routes/drive.js';
import { createInternalBridgeRouter } from './routes/internal-bridge.js';
import { createModelsRouter } from './routes/models.js';

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
app.use(createDriveRouter({ client: workplaceApi }));
app.use(createInternalBridgeRouter());
app.use(createModelsRouter());

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
  console.log('  POST /mail/analyze-content | /mail/analyze-personal | /mail/reply-draft | /mail/draft-coaching | /mail/issue-draft');
  console.log('  POST /messaging/classify');
  console.log('  POST /wiki/compose (SSE)');
  console.log('  POST /internal/bridge/:runId');
  console.log('  POST /models/list');
});

// 종료 대기 상한 — 채팅 실행 타임아웃(300s) 안쪽. 차트의 terminationGracePeriodSeconds 는 preStop 대기 + 이 값보다 커야 한다(WP-167).
const SHUTDOWN_DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS ?? 290_000);
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return; // SIGTERM 뒤 SIGINT 등 중복 신호는 무시 — 이미 대기 중
  shuttingDown = true;
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  void gracefulShutdown({
    server,
    drainTimeoutMs: SHUTDOWN_DRAIN_MS,
    // 진행 중 실행이 끝난 뒤에 opencode 서버(및 그 stdio MCP 자식 프로세스)를 정리 — 안 하면 좀비 프로세스로 남는다.
    // 먼저 닫으면 실행 중이던 에이전트가 끊긴다.
    cleanup: closeAllServers,
    exit: (code) => process.exit(code),
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
