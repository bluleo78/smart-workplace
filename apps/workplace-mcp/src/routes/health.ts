// 무인증 헬스체크 — docker healthcheck / 로드밸런서 프로브용. 인증 미들웨어 앞단에 마운트.
import { Router } from 'express';

export const healthRouter = Router();
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
