// POST /events — envelope 검증 + type 디스패치. 본 epic 은 분기 0개.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eventsRouter } from './events.js';
import { internalAuth } from '../middleware/internal-auth.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, eventsRouter);
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

describe('POST /events', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp())
      .post('/events')
      .send({ type: 'issue.created', payload: {} });
    expect(res.status).toBe(401);
  });

  it('envelope 누락(type 없음) → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('payload 필드 누락 → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('알 수 없는 type → 400 unsupported_event_type', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'unsupported_event_type', type: 'issue.created' });
  });
});
