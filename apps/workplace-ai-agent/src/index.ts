// Express 부트 — 미들웨어 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// 5c-1 부터 events 라우터가 workplace-api client 를 주입받는다.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

// workplace-api 호출용 client — AGENT API key 로 인증.
const workplaceApi = createWorkplaceApiClient({
  baseURL: process.env.WORKPLACE_API_BASE_URL,
  apiKey: process.env.WORKPLACE_AGENT_API_KEY ?? '',
});

app.use(express.json());

// /health 는 인증 없이 노출 — k8s 프로브 등을 가정.
app.use(healthRouter);
// /events 는 사내 서비스 인증 필수.
app.use(internalAuth, createEventsRouter(workplaceApi));

// 전역 에러 핸들러 — 라우트에서 처리 못 한 throw 의 안전망.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  console.log(`workplace-ai-agent listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /events`);
});

// SIGTERM/SIGINT 시 진행 중 요청 5초 대기 후 강제 종료.
function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
