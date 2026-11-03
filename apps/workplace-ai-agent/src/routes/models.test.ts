// Task10: 모델 목록 프로브 라우트 — OpenAI 호환 baseURL+apiKey 로 GET {baseURL}/models 위임.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import nock from 'nock';

import { anthropicEfforts, createModelsRouter, type ModelsRouterDeps } from './models.js';
import { internalAuth } from '../middleware/internal-auth.js';

process.env.INTERNAL_SERVICE_TOKEN = 'tk-internal';

// WP-1322: opencode variant 조회는 실제로 서버를 띄우므로 갈아 끼운다 — 기본은 아무것도 알아내지 못함(efforts 없이 응답).
const lookupOpencodeEfforts = vi.fn<ModelsRouterDeps['lookupOpencodeEfforts']>();
beforeEach(() => {
  lookupOpencodeEfforts.mockReset().mockResolvedValue(new Map());
});

function app() {
  const a = express();
  a.use(express.json());
  a.use(internalAuth);
  a.use(createModelsRouter({ lookupOpencodeEfforts }));
  return a;
}

const AUTH = { Authorization: 'Internal tk-internal' };

afterEach(() => {
  nock.cleanAll();
});

describe('POST /models/list', () => {
  it('internal-auth 헤더 없으면 401', async () => {
    const res = await request(app())
      .post('/models/list')
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(401);
  });

  it('표준 OpenAI 형태(data 배열) → 200 { models }', async () => {
    nock('https://api.test')
      .matchHeader('authorization', 'Bearer sk-x')
      .get('/models')
      .reply(200, {
        object: 'list',
        data: [
          { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
          { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
        ],
      });
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
  });

  it('변형 형태(배열 직접 반환) → 200 { models }', async () => {
    nock('https://api.test')
      .get('/models')
      .reply(200, [{ id: 'model-a' }, { id: 'model-b' }]);
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [{ id: 'model-a' }, { id: 'model-b' }] });
  });

  it('네트워크 오류 → 502', async () => {
    nock('https://api.test').get('/models').replyWithError('연결 거부');
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('message');
    expect(JSON.stringify(res.body)).not.toContain('sk-x');
  });

  it('upstream 비-2xx → 502', async () => {
    nock('https://api.test').get('/models').reply(401, { error: 'invalid_api_key' });
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk-x');
  });

  it('파싱 불가 응답(모델 id 배열 없음) → 502', async () => {
    nock('https://api.test').get('/models').reply(200, { unexpected: 'shape' });
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(502);
  });

  it('body 스키마 위반 → 400', async () => {
    const res = await request(app()).post('/models/list').set(AUTH).send({ options: { baseURL: 'https://api.test' } });
    expect(res.status).toBe(400);
  });
});

describe('POST /models/list 생각의 깊이(WP-1322)', () => {
  it('withEfforts 면 variant 조회 결과를 모델별 efforts 로 싣고(알아내지 못한 모델은 뺀다), npm 을 조회에 넘긴다', async () => {
    nock('https://api.test').get('/models').reply(200, { data: [{ id: 'gpt-5' }, { id: 'qwen3' }, { id: 'unknown' }] });
    lookupOpencodeEfforts.mockResolvedValue(new Map([['gpt-5', ['low', 'medium', 'high']], ['qwen3', []]]));
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' }, npm: '@ai-sdk/openai-compatible', withEfforts: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      models: [{ id: 'gpt-5', efforts: ['LOW', 'MEDIUM', 'HIGH'] }, { id: 'qwen3', efforts: [] }, { id: 'unknown' }],
    });
    expect(lookupOpencodeEfforts).toHaveBeenCalledWith('@ai-sdk/openai-compatible', ['gpt-5', 'qwen3', 'unknown']);
  });

  it('withEfforts 가 없으면(등록 전 검증 프로브) 단계를 묻지 않는다', async () => {
    nock('https://api.test').get('/models').reply(200, { data: [{ id: 'gpt-5' }] });
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' }, npm: null, withEfforts: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [{ id: 'gpt-5' }] });
    expect(lookupOpencodeEfforts).not.toHaveBeenCalled();
  });

  it('조회가 예외여도 목록은 efforts 없이 200, npm null(구·미지정 api)도 받는다', async () => {
    nock('https://api.test').get('/models').reply(200, { data: [{ id: 'gpt-5' }] });
    lookupOpencodeEfforts.mockRejectedValue(new Error('boom'));
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' }, npm: null, withEfforts: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [{ id: 'gpt-5' }] });
  });
});

describe('anthropicEfforts', () => {
  it('supported 인 단계만 낮은 순으로, capabilities·effort 가 없으면 undefined(모름)', () => {
    const sup = (v: boolean) => ({ supported: v });
    expect(
      anthropicEfforts({ effort: { low: sup(true), medium: sup(true), high: sup(true), xhigh: sup(false), max: sup(true), supported: true } }),
    ).toEqual(['LOW', 'MEDIUM', 'HIGH', 'MAX']);
    expect(anthropicEfforts(null)).toBeUndefined();
    expect(anthropicEfforts({})).toBeUndefined();
    expect(anthropicEfforts({ effort: { low: sup(false), medium: sup(false), high: sup(false), xhigh: sup(false), max: sup(false) } })).toEqual([]);
  });
});

describe('POST /models/anthropic/list', () => {
  const ANTHROPIC = 'https://api.anthropic.com';

  it('capabilities.effort 가 있으면 모델별 efforts 를 싣는다(WP-1322)', async () => {
    const sup = (v: boolean) => ({ supported: v });
    nock(ANTHROPIC)
      .get('/v1/models')
      .query(true)
      .reply(200, {
        data: [
          {
            type: 'model',
            id: 'claude-opus-5-5',
            display_name: 'Claude Opus 5.5',
            created_at: '2026-09-21T00:00:00Z',
            capabilities: { effort: { low: sup(true), medium: sup(true), high: sup(true), xhigh: sup(true), max: sup(true), supported: true } },
          },
          { type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-15T00:00:00Z', capabilities: null },
        ],
        has_more: false,
      });
    const res = await request(app()).post('/models/anthropic/list').set(AUTH).send({ token: 'sk-ant-oat01-x' });
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'] },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ]);
  });

  it('구독 OAuth 토큰 → Bearer+oauth 베타 헤더로 조회, 최신순 {id,label} 반환', async () => {
    nock(ANTHROPIC)
      .matchHeader('authorization', 'Bearer sk-ant-oat01-x')
      .matchHeader('anthropic-beta', /oauth-2025-04-20/)
      .get('/v1/models')
      .query(true)
      .reply(200, {
        data: [
          { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-28T00:00:00Z' },
          { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-21T00:00:00Z' },
        ],
        has_more: false,
        first_id: 'claude-sonnet-5-5',
        last_id: 'claude-opus-5-5',
      });

    const res = await request(app()).post('/models/anthropic/list').set(AUTH).send({ token: 'sk-ant-oat01-x' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      models: [
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      ],
    });
  });

  it('API 키 → x-api-key 헤더로 조회', async () => {
    nock(ANTHROPIC)
      .matchHeader('x-api-key', 'sk-ant-api03-x')
      .get('/v1/models')
      .query(true)
      .reply(200, {
        data: [{ type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-15T00:00:00Z' }],
        has_more: false,
      });

    const res = await request(app()).post('/models/anthropic/list').set(AUTH).send({ token: 'sk-ant-api03-x' });

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([{ id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }]);
  });

  it('upstream 401 → 502 (토큰 비노출)', async () => {
    nock(ANTHROPIC).get('/v1/models').query(true).reply(401, { type: 'error', error: { type: 'authentication_error' } });

    const res = await request(app()).post('/models/anthropic/list').set(AUTH).send({ token: 'sk-ant-oat01-secret' });

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk-ant-oat01-secret');
  });

  it('빈 목록 → 502', async () => {
    nock(ANTHROPIC).get('/v1/models').query(true).reply(200, { data: [], has_more: false });

    const res = await request(app()).post('/models/anthropic/list').set(AUTH).send({ token: 'sk-ant-oat01-x' });

    expect(res.status).toBe(502);
  });

  it('token 누락 → 400', async () => {
    const res = await request(app()).post('/models/anthropic/list').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  // WP-596: 사용자가 적은 주소로 서버가 대신 접속하므로 내부망(메타데이터·루프백·사설)으로는 나가지 않는다.
  it('내부 IP 리터럴 baseURL 은 접속하지 않고 400', async () => {
    const scope = nock('http://169.254.169.254').get('/latest/models').reply(200, { data: [{ id: 'x' }] });
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'http://169.254.169.254/latest', apiKey: 'sk-x' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('내부망');
    expect(scope.isDone()).toBe(false);
  });

  it('리다이렉트는 따라가지 않는다(내부 주소로 돌려 보내도 502)', async () => {
    nock('https://api.test').get('/models').reply(302, '', { Location: 'http://127.0.0.1:9000/models' });
    const internal = nock('http://127.0.0.1:9000').get('/models').reply(200, { data: [{ id: 'leak' }] });
    const res = await request(app())
      .post('/models/list')
      .set(AUTH)
      .send({ options: { baseURL: 'https://api.test', apiKey: 'sk-x' } });
    expect(res.status).toBe(502);
    expect(internal.isDone()).toBe(false);
  });
});
