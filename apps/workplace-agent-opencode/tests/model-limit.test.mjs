// 칸 모델 문맥 한도 스크립트 테스트(WP-1735) — 규칙은 이슈 채팅(workplace-ai-agent opencode-vision.ts)과 같은 사례 파일(model-limit-cases.json)로,
// 조회(헤더·실패·시간 초과)는 이 프로세스에 띄운 가짜 모델 서버로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchModelLimit, limitFrom, modelMetaFrom } from '../bin/model-limit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, 'model-limit-cases.json'), 'utf8'));

for (const c of cases) {
  test(`limitFrom(modelMetaFrom) — ${c.name}`, () => {
    assert.deepEqual(limitFrom(modelMetaFrom(c.body, c.model), c.providerId) ?? null, c.limit);
  });
}

/** 가짜 모델 서버 — handler 로 답하고, 받은 요청(경로·Authorization)을 남긴다. */
async function modelServer(t, handler) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, seen };
}
const json = (body) => (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

test('fetchModelLimit_readsModelsWithBearerKeyAndIgnoresTrailingSlash', async (t) => {
  const s = await modelServer(t, json({ data: [{ id: 'm', max_model_len: 131072 }] }));
  const warns = [];
  const limit = await fetchModelLimit({ providerId: 'custom', options: { baseURL: `${s.baseURL}/`, apiKey: 'sk-x' } }, 'm', (w) => warns.push(w));
  assert.deepEqual(limit, { context: 131072, output: 0 });
  assert.deepEqual(s.seen, [{ url: '/v1/models', auth: 'Bearer sk-x' }]);
  assert.deepEqual(warns, []);
});

test('fetchModelLimit_failureWarnsWithoutAddressOrKeyAndGivesNoLimit', async (t) => {
  const s = await modelServer(t, (_req, res) => {
    res.writeHead(500);
    res.end('boom');
  });
  const warns = [];
  const login = { providerId: 'custom', options: { baseURL: s.baseURL, apiKey: 'sk-secret' } };
  assert.equal(await fetchModelLimit(login, 'm', (w) => warns.push(w)), undefined);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /경고: 모델 서버에서 문맥 한도를 읽지 못했습니다\(HTTP 500\) — 한도 없이 띄웁니다/);
  assert.doesNotMatch(warns[0], /sk-secret|127\.0\.0\.1/);
  // JSON 이 아닌 답도 같다
  const bad = await modelServer(t, (_req, res) => res.end('not json'));
  warns.length = 0;
  assert.equal(await fetchModelLimit({ ...login, options: { baseURL: bad.baseURL } }, 'm', (w) => warns.push(w)), undefined);
  assert.equal(warns.length, 1);
});

test('fetchModelLimit_withoutBaseUrlDoesNotAsk', async () => {
  const warns = [];
  assert.equal(await fetchModelLimit({ providerId: 'openai', options: { apiKey: 'k' } }, 'm', (w) => warns.push(w)), undefined);
  assert.equal(await fetchModelLimit({ providerId: 'custom', options: { baseURL: '' } }, 'm', (w) => warns.push(w)), undefined);
  assert.deepEqual(warns, []);
});

test('fetchModelLimit_warningNeverCarriesUrlCredentialsOrBodyOnlyReasonCodes', async (t) => {
  // fetch 오류 메시지에는 주소(자격 증명이 든 URL 포함)가, JSON 해석 오류에는 응답 본문 조각이 들어갈 수 있다 — 이유 코드만 남긴다(리뷰 지적).
  const warns = [];
  const warn = (w) => warns.push(w);
  await fetchModelLimit({ providerId: 'custom', options: { baseURL: 'https://user:tok-secret@127.0.0.1:9/v1' } }, 'm', warn);
  await fetchModelLimit({ providerId: 'custom', options: { baseURL: 'not a url sk-secret' } }, 'm', warn);
  // 방금 닫은 서버의 포트 — 연결이 거절된다(9 같은 포트는 fetch 가 「bad port」로 먼저 막는다).
  const closed = createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r));
  await fetchModelLimit({ providerId: 'custom', options: { baseURL: `http://127.0.0.1:${port}/v1` } }, 'm', warn);
  const body = await modelServer(t, (_req, res) => res.end('{"leak": sk-body-secret'));
  await fetchModelLimit({ providerId: 'custom', options: { baseURL: body.baseURL } }, 'm', warn);
  assert.equal(warns.length, 4);
  for (const w of warns) assert.doesNotMatch(w, /secret|127\.0\.0\.1|user:/);
  assert.match(warns[2], /\(ECONNREFUSED\)/);
  assert.match(warns[3], /\(응답이 JSON 이 아님\)/);
});
