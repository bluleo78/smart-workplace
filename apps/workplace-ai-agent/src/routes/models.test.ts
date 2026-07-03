// Task10: 모델 목록 프로브 라우트 — OpenAI 호환 baseURL+apiKey 로 GET {baseURL}/models 위임.
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import nock from 'nock';

import { createModelsRouter } from './models.js';
import { internalAuth } from '../middleware/internal-auth.js';

process.env.INTERNAL_SERVICE_TOKEN = 'tk-internal';

function app() {
  const a = express();
  a.use(express.json());
  a.use(internalAuth);
  a.use(createModelsRouter());
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
