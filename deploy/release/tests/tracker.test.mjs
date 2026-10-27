// 릴리스 ↔ WP 버전 연동(lib/tracker.mjs·tracker.mjs) 테스트 (WP-1005) — 가짜 fetch·가짜 트래커로 네트워크 없이 요청 모양과 멱등을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachVersion, bestEffort, setReleased, trackerFromEnv, versionName } from '../lib/tracker.mjs';
import { main } from '../tracker.mjs';
import { REPO, answerAbandoned, fakeTracker } from './helpers.mjs';

const ENV = { GENIA_WORKS_API_URL: 'https://works.example.com/', GENIA_WORKS_RELEASE_TOKEN: 'swp_secret' };

/** 요청을 기록하고 정해 둔 응답을 돌려주는 가짜 fetch. reply(method, path, body) → { status, body }. */
function fakeFetch(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    const path = url.replace('https://works.example.com/api/v1/projects/WP', '');
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ url, method: init.method, path, body, headers: init.headers });
    const { status = 200, body: out = null } = reply(init.method, path, body) ?? {};
    return { ok: status >= 200 && status < 300, status, json: async () => out };
  };
  fetch.calls = calls;
  return fetch;
}

test('versionName: 사람이 만든 기존 버전(v0.9.23)과 같은 v 접두 형식', () => {
  assert.equal(versionName('0.9.24'), 'v0.9.24');
});

test('trackerFromEnv: 주소·토큰 중 하나라도 없으면 null(연동 안 함)', () => {
  assert.equal(trackerFromEnv({}), null);
  assert.equal(trackerFromEnv({ GENIA_WORKS_API_URL: 'https://x' }), null);
  assert.equal(trackerFromEnv({ GENIA_WORKS_RELEASE_TOKEN: 'swp_x' }), null);
  assert.equal(trackerFromEnv({ GENIA_WORKS_API_URL: ' ', GENIA_WORKS_RELEASE_TOKEN: 'swp_x' }), null);
});

test('trackerFromEnv: WP 프로젝트 API 경로·Bearer 토큰·JSON 본문으로 부르고, 끝 / 는 걷는다', async () => {
  const fetch = fakeFetch((method, path) => (method === 'GET' && path === '/versions' ? { body: [{ id: 1, name: 'v0.9.0' }] } : { body: {} }));
  const t = trackerFromEnv(ENV, { fetch });
  assert.deepEqual(await t.listVersions(), [{ id: 1, name: 'v0.9.0' }]);
  await t.createVersion({ name: 'v0.9.1' });
  await t.releaseVersion(7);
  await t.unreleaseVersion(7);
  await t.getIssue(12);
  await t.replaceFixVersions(12, [3, 7]);
  assert.deepEqual(fetch.calls.map((c) => [c.method, c.path, c.body]), [
    ['GET', '/versions', undefined],
    ['POST', '/versions', { name: 'v0.9.1' }],
    ['POST', '/versions/7/release', {}],
    ['POST', '/versions/7/unrelease', undefined],
    ['GET', '/issues/12', undefined],
    ['PUT', '/issues/12/versions', { fixVersionIds: [3, 7] }],
  ]);
  assert.ok(fetch.calls.every((c) => c.url.startsWith('https://works.example.com/api/v1/projects/WP/')));
  assert.ok(fetch.calls.every((c) => c.headers.Authorization === 'Bearer swp_secret'));
  assert.equal(fetch.calls[1].headers['Content-Type'], 'application/json');
});

test('trackerFromEnv: 2xx 가 아니면 상태 코드와 서버 메시지로 throw 하고, 토큰은 문구에 넣지 않는다', async () => {
  const t = trackerFromEnv(ENV, { fetch: fakeFetch(() => ({ status: 403, body: { message: '권한이 없습니다' } })) });
  await assert.rejects(t.listVersions(), (err) => /GET \/versions → HTTP 403 권한이 없습니다/.test(err.message) && !err.message.includes('swp_secret'));
});

test('trackerFromEnv: 응답이 없으면 시간 초과로 throw 한다(반영·롤백이 멈춰 기다리지 않게)', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t = trackerFromEnv(ENV, { fetch: hang, timeoutMs: 20 });
  await assert.rejects(t.listVersions(), /timeout|aborted/i);
});

test('attachVersion: 버전이 없으면 만들고, 이슈마다 기존 수정 버전에 더해 집합으로 보낸다', async () => {
  const t = fakeTracker({ versions: [{ id: 1, name: 'v0.9.0', status: 'RELEASED' }], issues: { 5: [1] } });
  const r = await attachVersion(t, { version: '0.9.1', issueKeys: ['WP-5', 'WP-6'] });
  assert.equal(r.created, true);
  assert.deepEqual(t.calls.find((c) => c[0] === 'create'), ['create', { name: 'v0.9.1', description: '릴리스 v0.9.1' }]);
  assert.deepEqual(r.attached, ['WP-5', 'WP-6']);
  // WP-5 는 이미 붙은 v0.9.0(1)을 지키며 새 버전을 더한다 — 교체가 집합 교체라 기존 것을 빠뜨리면 지워진다.
  assert.deepEqual(t.issues, { 5: [1, 100], 6: [100] });
});

test('attachVersion: 다시 돌려도 같다 — 있는 버전은 만들지 않고 이미 붙은 이슈는 건너뛴다', async () => {
  const t = fakeTracker({ versions: [{ id: 9, name: 'v0.9.1', status: 'UNRELEASED' }], issues: { 5: [9] } });
  const r = await attachVersion(t, { version: '0.9.1', issueKeys: ['WP-5'] });
  assert.equal(r.created, false);
  assert.deepEqual(r.skipped, ['WP-5']);
  assert.ok(!t.calls.some((c) => c[0] === 'create' || c[0] === 'put'));
});

test('attachVersion: 다른 프로젝트 키는 건너뛰고, 이슈 하나가 실패해도 나머지는 붙이고 경고한다', async () => {
  const t = fakeTracker({ failIssues: [7] });
  const logs = [];
  const r = await attachVersion(t, { version: '0.9.1', issueKeys: ['GW-3', 'WP-7', 'WP-8'], log: (l) => logs.push(l) });
  assert.deepEqual(r.attached, ['WP-8']);
  assert.deepEqual(r.failed.map((f) => f.key), ['WP-7']);
  assert.ok(!t.calls.some((c) => c[0] === 'get' && c[1] === 3), 'GW-3 은 조회하지 않는다');
  assert.match(logs.join('\n'), /경고: WP-7 에 수정 버전을 붙이지 못했다 \(GET \/issues\/7 → HTTP 404\)/);
});

test('attachVersion: 이슈 응답에 summary.fixVersions 가 없으면 교체하지 않는다(기존 수정 버전이 지워지지 않게)', async () => {
  const t = { ...fakeTracker(), getIssue: async () => ({ fixVersions: [{ id: 1 }] }) };
  const r = await attachVersion(t, { version: '0.9.1', issueKeys: ['WP-5'] });
  assert.deepEqual(r.attached, []);
  assert.match(r.failed[0].error, /summary\.fixVersions 가 없다/);
  assert.ok(!t.calls.some((c) => c[0] === 'put'));
});

test('setReleased: 미출시면 출시, 이미 출시면 건드리지 않는다(출시일이 덮이지 않게)', async () => {
  const t = fakeTracker({ versions: [{ id: 1, name: 'v0.9.1', status: 'UNRELEASED' }] });
  assert.equal(await setReleased(t, { version: '0.9.1', released: true }), 'changed');
  assert.equal(await setReleased(t, { version: '0.9.1', released: true }), 'unchanged');
  assert.deepEqual(t.calls.filter((c) => c[0] === 'release'), [['release', 1]]);
  assert.equal(await setReleased(t, { version: '0.9.1', released: false }), 'changed');
  assert.deepEqual(t.calls.at(-1), ['unrelease', 1]);
});

test('setReleased: 버전이 없으면 만들지 않고, 보관된 버전은 바꾸지 않는다', async () => {
  const t = fakeTracker({ versions: [{ id: 2, name: 'v0.9.0', status: 'ARCHIVED' }] });
  assert.equal(await setReleased(t, { version: '0.9.9', released: true }), 'missing');
  assert.equal(await setReleased(t, { version: '0.9.0', released: true }), 'archived');
  assert.ok(!t.calls.some((c) => ['create', 'release', 'unrelease'].includes(c[0])));
});

test('bestEffort: 설정이 없으면 안내 한 줄, 실패하면 경고 한 줄 — 어느 쪽도 던지지 않는다', async () => {
  const logs = [];
  const log = (l) => logs.push(l);
  assert.equal(await bestEffort({ tracker: null, log, what: '출시 처리' }, () => assert.fail('부르지 않는다')), null);
  assert.match(logs[0], /설정\(GENIA_WORKS_API_URL·GENIA_WORKS_RELEASE_TOKEN\)이 없어 건너뛴다 — 출시 처리/);
  assert.equal(await bestEffort({ tracker: {}, log, what: '출시 처리' }, async () => { throw new Error('HTTP 403'); }), null);
  assert.match(logs[1], /경고: 트래커 출시 처리 실패 — 릴리스는 계속한다 \(HTTP 403\)/);
});

/** attach 의 plan 이 부르는 git 질의만 답하는 가짜 exec(--base 를 주는 경로). */
function planGit(log) {
  return (cmd, args) => {
    const line = args.join(' ');
    const a = answerAbandoned(line, null);
    if (a) return a;
    if (line.startsWith('rev-parse --verify')) return { stdout: `${line.includes('v0.9.1') ? 'f'.repeat(40) : '1'.repeat(40)}\n` };
    if (line.startsWith('log --no-merges')) return { stdout: log };
    if (line.startsWith('rev-parse --abbrev-ref')) return { stdout: `${args[2]}\n` };
    if (line.startsWith('tag --list v')) return { stdout: '' };
    throw new Error(`예상 못한 git 호출: ${line}`);
  };
}

test('CLI attach: 태그 v<x.y.z> 까지의 범위에서 WP 키(제목·Refs:)를 모아 버전에 붙인다', async () => {
  const log = ['a'.repeat(40), 'feat(web): 연락처 (WP-5)', 'Refs: WP-6'].join('\x1f') + '\x1e\n' + ['b'.repeat(40), 'test(web): 정리 (WP-7)', ''].join('\x1f') + '\x1e\n';
  const t = fakeTracker();
  const r = await main(['attach', '0.9.1', '--base', 'v0.9.0', '--base-version', '0.9.0'], { exec: planGit(log), repoRoot: REPO, log: () => {}, tracker: t });
  // 내부 커밋(test)의 이슈도 이 릴리스에 들어간 이슈라 함께 붙인다 — 노트에서 빠지는 것과 별개다.
  assert.deepEqual(r.attached, ['WP-5', 'WP-6', 'WP-7']);
  assert.equal(t.versions[0].name, 'v0.9.1');
});

test('CLI: 트래커 설정이 없으면 안내만 하고 성공(null), 인자가 틀리면 사용법으로 거부', async () => {
  const logs = [];
  assert.equal(await main(['release', '0.9.1'], { log: (l) => logs.push(l), tracker: null }), null);
  assert.match(logs.join('\n'), /건너뛴다/);
  await assert.rejects(main(['release'], { tracker: null }), /사용법/);
  await assert.rejects(main(['ship', '0.9.1'], { tracker: null }), /사용법/);
  await assert.rejects(main(['release', 'v0.9.1'], { tracker: null }), /0\.9\.1|버전/);
});

test('CLI release·unrelease: 버전 상태를 바꾼다', async () => {
  const t = fakeTracker({ versions: [{ id: 3, name: 'v0.9.1', status: 'UNRELEASED' }] });
  assert.equal(await main(['release', '0.9.1'], { log: () => {}, tracker: t }), 'changed');
  assert.equal(await main(['unrelease', '0.9.1'], { log: () => {}, tracker: t }), 'changed');
  assert.deepEqual(t.calls.filter((c) => c[0] !== 'list'), [['release', 3], ['unrelease', 3]]);
});

