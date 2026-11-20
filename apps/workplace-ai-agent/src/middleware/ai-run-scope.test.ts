// WP-1828: AI 처리 범위 미들웨어 — 표 경로만 기록, 헤더 우선, 응답 불변.
import { describe, expect, it, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { aiRunScopeMiddleware } from './ai-run-scope.js';
import { currentAiRunScope } from '../ai-run/scope.js';
import type { AiRunRecord } from '../ai-run/types.js';

/** X-AI-Run 헤더 값(base64url(JSON))을 만드는 테스트용 보조 함수(WP-1828). */
const encodeAiRunHeader = (ctx: object) => Buffer.from(JSON.stringify(ctx)).toString('base64url');

function sinkOf(): { records: AiRunRecord[]; sink: { enqueue: (r: AiRunRecord) => void } } {
  const records: AiRunRecord[] = [];
  return { records, sink: { enqueue: (r) => records.push(r) } };
}

/** 가짜 러너 — 범위에 시작·종료를 알린다. */
function fakeRun(): void {
  const s = currentAiRunScope()!;
  s.runnerStarted('m', 'anthropic');
  s.runnerFinished({ ok: true, usage: { inputTokens: 1, outputTokens: 2 } });
}

afterEach(() => vi.restoreAllMocks());

describe('aiRunScopeMiddleware', () => {
  it('표에 있는 경로는 RUNNING·SUCCEEDED 두 건, kind 는 표 값, X-AI-Run 의 runId·tenantId·attempt 를 쓴다', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.post('/mail/reply-draft', (_req, res) => {
      fakeRun();
      res.json({ ok: true });
    });
    const h = encodeAiRunHeader({ runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b', tenantId: 9, attempt: 3 });
    const res = await request(app).post('/mail/reply-draft').set('X-AI-Run', h).send({});
    expect(res.status).toBe(200);
    expect(records.map((r) => r.status)).toEqual(['RUNNING', 'SUCCEEDED']);
    expect(records[1]).toMatchObject({
      runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b', tenantId: 9, attempt: 3, kind: 'MAIL_REPLY_DRAFT', inputTokens: 1, outputTokens: 2,
    });
  });

  it('헤더 kind 가 있으면 표보다 우선', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.post('/ai/chat', (_req, res) => {
      fakeRun();
      res.json({});
    });
    await request(app).post('/ai/chat').set('X-AI-Run', encodeAiRunHeader({ kind: 'PROJECT_REPORT' })).send({});
    expect(records[0].kind).toBe('PROJECT_REPORT');
  });

  it('헤더에 tenantId 가 없으면 body 의 양의 정수 tenantId 를 쓰고, 헤더가 있으면 헤더가 이긴다', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(express.json());
    app.use(aiRunScopeMiddleware(sink));
    app.post('/ai/chat', (_req, res) => {
      fakeRun();
      res.json({});
    });
    await request(app).post('/ai/chat').send({ tenantId: 42 });
    await request(app).post('/ai/chat').set('X-AI-Run', encodeAiRunHeader({ tenantId: 9 })).send({ tenantId: 42 });
    // 양의 정수가 아닌 body 값은 쓰지 않는다 — tenantId 없는 기록은 sink 가 거른다(여기선 null 로 보인다).
    await request(app).post('/ai/chat').send({ tenantId: 0 });
    await request(app).post('/ai/chat').send({ tenantId: '5' });
    const running = records.filter((r) => r.status === 'RUNNING');
    expect(running.map((r) => r.tenantId)).toEqual([42, 9, null, null]);
  });

  it('표에 없는 경로(/health)는 범위가 없다', async () => {
    const { records, sink } = sinkOf();
    let seen: unknown = 'unset';
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.get('/health', (_req, res) => {
      seen = currentAiRunScope();
      res.json({});
    });
    await request(app).get('/health');
    expect(seen).toBeUndefined();
    expect(records).toEqual([]);
  });

  it('러너를 부르지 않고 400 을 돌려준 요청은 아무것도 넣지 않는다', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.post('/ai/chat', (_req, res) => {
      res.status(400).json({ error: 'bad' });
    });
    const res = await request(app).post('/ai/chat').send({});
    expect(res.status).toBe(400);
    expect(records).toEqual([]);
  });

  it('러너를 부른 뒤 500 이면 FAILED·http_500', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.post('/ai/chat', (_req, res) => {
      fakeRun();
      res.status(500).json({});
    });
    await request(app).post('/ai/chat').send({});
    expect(records.map((r) => r.status)).toEqual(['RUNNING', 'FAILED']);
    expect(records[1].errorReason).toBe('http_500');
  });

  it('잘못된 X-AI-Run 이어도 200 이고 새 runId 로 기록', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.post('/ai/chat', (_req, res) => {
      fakeRun();
      res.json({ ok: 1 });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await request(app).post('/ai/chat').set('X-AI-Run', '!!not-base64-json').send({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(records).toHaveLength(2);
    expect(records[0].runId).toMatch(/[0-9a-f-]{36}/);
  });

  it('SSE 중 클라이언트가 끊으면 FAILED·client_closed 한 건', async () => {
    const { records, sink } = sinkOf();
    const app = express();
    app.use(aiRunScopeMiddleware(sink));
    app.post('/wiki/compose', (_req, res) => {
      fakeRun();
      res.write('data: 1\n\n');
    });
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      await new Promise<void>((resolve) => {
        const req = http.request({ port, method: 'POST', path: '/wiki/compose' }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => {});
        req.end();
      });
      await vi.waitFor(() => expect(records.map((r) => r.status)).toEqual(['RUNNING', 'FAILED']));
      expect(records[1].errorReason).toBe('client_closed');
      expect(records).toHaveLength(2);
    } finally {
      server.close();
    }
  });

  it('sink.enqueue 가 throw 해도 응답 코드·본문이 같다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = express();
    app.use(aiRunScopeMiddleware({ enqueue: () => { throw new Error('boom'); } }));
    app.post('/ai/chat', (_req, res) => {
      fakeRun();
      res.status(201).json({ a: 1 });
    });
    const res = await request(app).post('/ai/chat').send({});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ a: 1 });
  });
});
