// POST /events — envelope 검증 + payload 재검증 + 4 type 핸들러 분기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { internalAuth } from '../middleware/internal-auth.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { createEventsRouter } from './events.js';

function mockClient(): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn(),
  };
}

function buildApp(client: WorkplaceApiClient) {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createEventsRouter(client));
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

const validCreatedPayload = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' }],
  occurredAt: '2026-05-25T12:00:00Z',
  status: 'TODO',
  priority: 'MID',
};

describe('POST /events', () => {
  let client: WorkplaceApiClient;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    client = mockClient();
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(401);
  });

  it('envelope 누락(type 없음) → 400 invalid_payload', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('알 수 없는 type → 400 unsupported_event_type', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'wiki.created', payload: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_event_type',
      type: 'wiki.created',
    });
  });

  it('issue.assigned payload 의 added 누락 → 400 invalid_payload', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({
        type: 'issue.assigned',
        payload: {
          ...validCreatedPayload,
          removed: [],
          // added 누락
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('issue.created 정상 → 202 + addIssueComment 1회', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });
    expect(client.addIssueComment).toHaveBeenCalledOnce();
  });
});
