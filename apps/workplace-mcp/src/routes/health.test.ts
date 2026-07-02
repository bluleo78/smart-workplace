// supertest 로 앱 팩토리를 직접 검증 — listen 없이 health 라우트만 확인.
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../index.js';

describe('GET /health', () => {
  it('무인증으로 200 { status: "ok" }', async () => {
    const res = await request(createApp({ apiBaseUrl: 'http://localhost:9090/api/v1' })).get(
      '/health',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
