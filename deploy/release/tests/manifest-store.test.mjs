// 릴리스 매니페스트 저장소(GitLab generic package) 테스트 (WP-440) — 가짜 fetch 만 쓰고 네트워크는 쓰지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadManifest, uploadManifest } from '../lib/manifest-store.mjs';

const ENV = { CI_API_V4_URL: 'https://gitlab.example/api/v4', CI_PROJECT_ID: '42' };
const PROJECT_URL = 'https://gitlab.example/api/v4/projects/42';
const URL_090 = 'https://gitlab.example/api/v4/projects/42/packages/generic/release-manifest/0.9.0/release-manifest.json';

/** 호출을 기록하고 정해 둔 응답을 돌려주는 가짜 fetch. 앞의 failures 번은 연결 오류(TypeError)로 throw 한다. */
function fakeFetch(response, failures = 0) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (calls.length <= failures) throw new TypeError('fetch failed');
    return response;
  };
  fn.calls = calls;
  return fn;
}
/** URL 별 응답을 돌려주는 가짜 fetch — 패키지 URL 과 프로젝트 조회 URL(404 확인용)을 구분한다. */
function routedFetch({ pkg, project }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return url === PROJECT_URL ? project : pkg;
  };
  fn.calls = calls;
  return fn;
}
const res = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });

test('다운로드: URL 형식과 CI_JOB_TOKEN → JOB-TOKEN 헤더', async () => {
  const fetch = fakeFetch(res(200, '{"schemaVersion":1}'));
  const m = await downloadManifest('0.9.0', { fetch, env: { ...ENV, CI_JOB_TOKEN: 'jt', GITLAB_TOKEN: 'pt' } });
  assert.deepEqual(m, { schemaVersion: 1 });
  assert.equal(fetch.calls[0].url, URL_090);
  assert.equal(fetch.calls[0].init.headers['JOB-TOKEN'], 'jt');
  assert.equal(fetch.calls[0].init.headers['PRIVATE-TOKEN'], undefined);
});

test('CI_JOB_TOKEN 이 없으면 GITLAB_TOKEN → PRIVATE-TOKEN 헤더', async () => {
  const fetch = fakeFetch(res(200, '{}'));
  await downloadManifest('0.9.0', { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } });
  assert.equal(fetch.calls[0].init.headers['PRIVATE-TOKEN'], 'pt');
  assert.equal(fetch.calls[0].init.headers['JOB-TOKEN'], undefined);
});

test('404 + 프로젝트는 200 → null (그 버전의 매니페스트가 없다), 프로젝트 조회에 같은 인증 헤더를 쓴다', async () => {
  const fetch = routedFetch({ pkg: res(404), project: res(200, '{}') });
  assert.equal(await downloadManifest('0.9.0', { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } }), null);
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].url, PROJECT_URL);
  assert.equal(fetch.calls[1].init.headers['PRIVATE-TOKEN'], 'pt');
});

test('404 + 프로젝트 조회도 실패(잘못된 프로젝트 ID·접근 권한 없음) → "없음"이 아니라 상태 코드를 담아 throw', async () => {
  for (const status of [404, 401, 403]) {
    const fetch = routedFetch({ pkg: res(404), project: res(status) });
    await assert.rejects(downloadManifest('0.9.0', { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } }), (err) => err.message.includes(String(status)) && /CI_PROJECT_ID/.test(err.message));
  }
});

test('404 이외 실패는 throw — 인증 오류를 "매니페스트 없음"으로 오인하지 않는다', async () => {
  await assert.rejects(downloadManifest('0.9.0', { fetch: fakeFetch(res(401)), env: { ...ENV, GITLAB_TOKEN: 'pt' } }), /401/);
});

test('토큰이 둘 다 없으면 throw, fetch 는 호출되지 않는다', async () => {
  const fetch = fakeFetch(res(200, '{}'));
  await assert.rejects(downloadManifest('0.9.0', { fetch, env: ENV }), /CI_JOB_TOKEN|GITLAB_TOKEN/);
  await assert.rejects(uploadManifest('0.9.0', {}, { fetch, env: ENV }), /CI_JOB_TOKEN|GITLAB_TOKEN/);
  assert.equal(fetch.calls.length, 0);
});

test('CI_API_V4_URL·CI_PROJECT_ID 가 없으면 throw', async () => {
  await assert.rejects(downloadManifest('0.9.0', { fetch: fakeFetch(res(200)), env: { GITLAB_TOKEN: 'pt' } }), /CI_API_V4_URL|CI_PROJECT_ID/);
});

test('업로드: PUT, 같은 URL, JSON 본문', async () => {
  const fetch = fakeFetch(res(201));
  await uploadManifest('0.9.0', { schemaVersion: 1, version: '0.9.0' }, { fetch, env: { ...ENV, CI_JOB_TOKEN: 'jt' } });
  const { url, init } = fetch.calls[0];
  assert.equal(url, URL_090);
  assert.equal(init.method, 'PUT');
  assert.deepEqual(JSON.parse(init.body), { schemaVersion: 1, version: '0.9.0' });
  assert.equal(init.headers['JOB-TOKEN'], 'jt');
});

test('업로드 실패(비 2xx)는 throw — 서버가 응답한 실패는 다시 보내지 않는다', async () => {
  const fetch = fakeFetch(res(500));
  await assert.rejects(uploadManifest('0.9.0', {}, { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } }), /500/);
  assert.equal(fetch.calls.length, 1);
});

test('업로드: 연결 오류(닫힌 keep-alive 등)는 한 번 다시 보낸다', async () => {
  const fetch = fakeFetch(res(201), 1);
  await uploadManifest('0.9.0', { version: '0.9.0' }, { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } });
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(JSON.parse(fetch.calls[1].init.body), { version: '0.9.0' });
});

test('업로드: 연결 오류가 두 번이면 throw', async () => {
  const fetch = fakeFetch(res(201), 2);
  await assert.rejects(uploadManifest('0.9.0', {}, { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } }), /fetch failed/);
  assert.equal(fetch.calls.length, 2);
});

test('CI 잡 토큰이면 404 를 프로젝트 조회 없이 null 로 본다(잡 토큰은 GET /projects/<id> 를 허용하지 않는다)', async () => {
  const fetch = routedFetch({ pkg: res(404), project: res(403) });
  assert.equal(await downloadManifest('0.9.0', { fetch, env: { ...ENV, CI_JOB_TOKEN: 'jt' } }), null);
  assert.equal(fetch.calls.length, 1);
});

test('다운로드: 연결 오류도 한 번 다시 보낸다', async () => {
  const fetch = fakeFetch(res(200, '{"version":"0.9.0"}'), 1);
  assert.deepEqual(await downloadManifest('0.9.0', { fetch, env: { ...ENV, CI_JOB_TOKEN: 'jt' } }), { version: '0.9.0' });
  assert.equal(fetch.calls.length, 2);
});

test('연결 오류가 아닌 throw(코드 오류 등)는 다시 보내지 않는다', async () => {
  const calls = [];
  const fetch = async () => { calls.push(1); throw new RangeError('bug'); };
  await assert.rejects(uploadManifest('0.9.0', {}, { fetch, env: { ...ENV, GITLAB_TOKEN: 'pt' } }), /bug/);
  assert.equal(calls.length, 1);
});
