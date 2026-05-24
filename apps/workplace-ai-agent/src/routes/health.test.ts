// /health 라우트 — supertest 로 in-process 검증.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { healthRouter } from './health.js';

function buildApp() {
  const app = express();
  app.use(healthRouter);
  return app;
}

describe('GET /health', () => {
  it('200 + { status: "ok" }', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
