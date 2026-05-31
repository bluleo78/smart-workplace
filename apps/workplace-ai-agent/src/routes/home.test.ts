import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-home-compose.js', () => ({
  runHomeCompose: vi.fn(),
  HomeComposerNotConfiguredError: class extends Error {},
}));

import { createHomeRouter } from './home.js';
import { runHomeCompose, HomeComposerNotConfiguredError } from '../agent/run-home-compose.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createHomeRouter({ client: {} as never }));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /home/compose', () => {
  it('정상 → 200 + {message, widgets}', async () => {
    vi.mocked(runHomeCompose).mockResolvedValue({ message: 'ok', widgets: [{ type: 'my_tasks', params: {} }] });
    const res = await request(buildApp()).post('/home/compose').send({ query: '내 할 일' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'ok', widgets: [{ type: 'my_tasks', params: {} }] });
    expect(runHomeCompose).toHaveBeenCalledWith(
      { query: '내 할 일', recentContext: undefined },
      expect.anything(),
    );
  });

  it('query 누락 → 400', async () => {
    const res = await request(buildApp()).post('/home/compose').send({});
    expect(res.status).toBe(400);
    expect(runHomeCompose).not.toHaveBeenCalled();
  });

  it('composer 미설정 → 503', async () => {
    vi.mocked(runHomeCompose).mockRejectedValue(new HomeComposerNotConfiguredError());
    const res = await request(buildApp()).post('/home/compose').send({ query: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('home_composer_not_configured');
  });

  it('러너 오류 → 502', async () => {
    vi.mocked(runHomeCompose).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/home/compose').send({ query: 'x' });
    expect(res.status).toBe(502);
  });
});
