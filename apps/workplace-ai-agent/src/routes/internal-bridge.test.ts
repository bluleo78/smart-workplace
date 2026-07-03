import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { internalAuth } from '../middleware/internal-auth.js';
import { createInternalBridgeRouter } from './internal-bridge.js';
import { registerBridge, releaseBridge } from '../agent/bridge-registry.js';
import type { HostBridge } from '../mcp/tools.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createInternalBridgeRouter());
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

describe('POST /internal/bridge/:runId', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    releaseBridge('run-1');
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp())
      .post('/internal/bridge/run-1')
      .send({ kind: 'submit_response', data: 'hi' });
    expect(res.status).toBe(401);
  });

  it('본문이 스키마와 안 맞으면 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/internal/bridge/run-1')
      .set('Authorization', AUTH)
      .send({ kind: 'proposal', data: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('미등록 runId → 404', async () => {
    const res = await request(buildApp())
      .post('/internal/bridge/never-registered')
      .set('Authorization', AUTH)
      .send({ kind: 'submit_response', data: 'hi' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('run_not_found');
  });

  it('kind=proposal → 등록된 브리지의 onProposal 호출 + 200', async () => {
    const bridge: HostBridge = {
      onProposal: vi.fn(),
      onSubmitResponse: vi.fn(),
      onUnassignResult: vi.fn(),
    };
    registerBridge('run-1', bridge);
    const payload = { actionType: 'calendar.create_event', summary: '요약', params: { a: 1 } };
    const res = await request(buildApp())
      .post('/internal/bridge/run-1')
      .set('Authorization', AUTH)
      .send({ kind: 'proposal', data: payload });
    expect(res.status).toBe(200);
    expect(bridge.onProposal).toHaveBeenCalledWith(payload);
    expect(bridge.onSubmitResponse).not.toHaveBeenCalled();
    expect(bridge.onUnassignResult).not.toHaveBeenCalled();
  });

  it('kind=submit_response → 등록된 브리지의 onSubmitResponse 호출 + 200', async () => {
    const bridge: HostBridge = {
      onProposal: vi.fn(),
      onSubmitResponse: vi.fn(),
      onUnassignResult: vi.fn(),
    };
    registerBridge('run-1', bridge);
    const res = await request(buildApp())
      .post('/internal/bridge/run-1')
      .set('Authorization', AUTH)
      .send({ kind: 'submit_response', data: '답변 텍스트' });
    expect(res.status).toBe(200);
    expect(bridge.onSubmitResponse).toHaveBeenCalledWith('답변 텍스트');
  });

  it('kind=unassign → 등록된 브리지의 onUnassignResult 호출 + 200', async () => {
    const bridge: HostBridge = {
      onProposal: vi.fn(),
      onSubmitResponse: vi.fn(),
      onUnassignResult: vi.fn(),
    };
    registerBridge('run-1', bridge);
    const res = await request(buildApp())
      .post('/internal/bridge/run-1')
      .set('Authorization', AUTH)
      .send({ kind: 'unassign', data: { ok: false, canonical: '실패했습니다.' } });
    expect(res.status).toBe(200);
    expect(bridge.onUnassignResult).toHaveBeenCalledWith({ ok: false, canonical: '실패했습니다.' });
  });
});
