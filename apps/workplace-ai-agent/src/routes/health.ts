// liveness probe — 외부 의존성 검사 없이 단순 200.
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
