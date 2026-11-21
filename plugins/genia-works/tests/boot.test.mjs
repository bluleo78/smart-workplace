// genia-works 플러그인 gw-boot 테스트 — 칸 차단 보고(WP-1913): 가짜 pane 서버로 요청(메서드·주소·본문)을,
// 가짜 HOME·가짜 ps 로 AI 키 신원을 검증한다. 스크립트는 늘 종료 0 이고 표준 출력은 늘 비어야 한다(경고는 표준 오류로만).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'scripts');
let home, bin, table;

// 프로세스 표: 500(이 스크립트를 부른 셸) → 400(claude) → 1 — scripts.test.mjs 와 같은 가짜 ps 표.
function setTable(rows) {
  writeFileSync(table, rows.map((r) => r.join('|')).join('\n') + '\n');
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'gw-boot-'));
  home = join(root, 'home');
  mkdirSync(home);
  bin = join(root, 'bin');
  mkdirSync(bin);
  // ps 만 가짜로 바꾸고 나머지 명령은 진짜를 쓴다.
  symlinkSync(join(here, 'fake-ps'), join(bin, 'ps'));
  chmodSync(join(here, 'fake-ps'), 0o755);
  table = join(root, 'ps-table');
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh /x/scripts/gw-headers'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', 'claude --plugin-dir x'],
  ]);
});

/** 스크립트를 비동기로 띄운다 — 같은 프로세스의 가짜 서버가 답해야 하므로 spawnSync 로는 기다릴 수 없다. */
function runAsync(cmd, args, env = {}) {
  const p = spawn(join(scripts, cmd), args, {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_START_PID: '500', ...env },
  });
  let stdout = '';
  let stderr = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.stderr.on('data', (d) => (stderr += d));
  return new Promise((r) => {
    p.on('error', (e) => r({ status: null, stdout, stderr, error: e }));
    p.on('close', (status) => r({ status, stdout, stderr }));
  });
}

/** 스크립트를 동기로 띄운다 — 키 등록(gw-keys)처럼 서버가 필요 없는 호출용. */
function run(cmd, args, { input, env = {} } = {}) {
  return spawnSync(join(scripts, cmd), args, {
    input,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_START_PID: '500', ...env },
  });
}

/** 가짜 칸 차단 보고 서버 — status·body 를 내고 받은 요청(메서드·주소·헤더·본문)을 모은다. */
async function fakePaneServer({ status = 204, body = '' } = {}) {
  const reqs = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => {
      reqs.push({ method: req.method, url: req.url, headers: req.headers, body: data });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, reqs, close: () => server.close() };
}

/** AI 키 ai-dev(ak_FAKE_DEV) 를 등록한다 — gw_identity_key 가 읽을 신원 키. */
function addKey() {
  assert.equal(run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' }).status, 0);
}

// Works 가 띄운 AI 라는 공통 조건 — generation 있는 키 신원 화면 보고.
const WORKS = { GENIA_AGENT_GENERATION: '7', GENIA_WORKS_AS: 'ai-dev' };

test('blocked 는 PUT /agent-runtime/me/pane 에 state·message 를 보낸다', async () => {
  addKey();
  const srv = await fakePaneServer();
  try {
    const r = await runAsync('gw-boot', ['blocked', '네트워크 탓에 진입하지 못했습니다'], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    assert.equal(srv.reqs.length, 1);
    const [q] = srv.reqs;
    assert.equal(q.method, 'PUT');
    assert.equal(q.url, '/api/v1/agent-runtime/me/pane');
    assert.equal(q.headers.authorization, 'Bearer ak_FAKE_DEV');
    assert.equal(q.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(q.body), { state: 'BLOCKED', message: '네트워크 탓에 진입하지 못했습니다' });
    assert.doesNotMatch(r.stdout + r.stderr, /ak_FAKE_DEV/);
  } finally {
    srv.close();
  }
});

test('메시지가 501자면 500자로 잘라 보낸다', async () => {
  addKey();
  const srv = await fakePaneServer();
  try {
    // 한글은 글자당 3 바이트 — 바이트로 자르면(Server @Size 도 글자 수 기준) 글자가 깨진다. 유니코드 글자 수로 500 자.
    const r = await runAsync('gw-boot', ['blocked', '가'.repeat(501)], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    assert.equal(JSON.parse(srv.reqs[0].body).message, '가'.repeat(500));

    // 영문 섞인 메시지도 글자 수 기준으로 자른다(1001자 → 500자).
    const mixed = 'ab가'.repeat(400); // 1200자
    await runAsync('gw-boot', ['blocked', mixed], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.equal(JSON.parse(srv.reqs[1].body).message, mixed.slice(0, 500));

    // 정확히 500 자면 그대로 보낸다.
    await runAsync('gw-boot', ['blocked', '나'.repeat(500)], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.equal(JSON.parse(srv.reqs[2].body).message, '나'.repeat(500));
  } finally {
    srv.close();
  }
});

test('ok 는 state:OK 만 보낸다(메시지 없음)', async () => {
  addKey();
  const srv = await fakePaneServer();
  try {
    const r = await runAsync('gw-boot', ['ok'], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    assert.equal(srv.reqs.length, 1);
    assert.equal(srv.reqs[0].url, '/api/v1/agent-runtime/me/pane');
    assert.deepEqual(JSON.parse(srv.reqs[0].body), { state: 'OK' });
    assert.equal('message' in JSON.parse(srv.reqs[0].body), false);
  } finally {
    srv.close();
  }
});

test('GENIA_AGENT_GENERATION 이 없으면(외부 실행) 아무것도 보내지 않고 종료 0', async () => {
  addKey();
  const srv = await fakePaneServer();
  try {
    const r = await runAsync('gw-boot', ['blocked', '외부에서 실행됐다'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    assert.equal(srv.reqs.length, 0);
  } finally {
    srv.close();
  }
});

test('AI 키 신원이 없으면 한 줄 경고 후 종료 0(출력 없음)', async () => {
  const srv = await fakePaneServer();
  try {
    // GENIA_WORKS_AS 도 세션 선택도 없다 — gw_identity_key 가 키를 못 낸다.
    const r = await runAsync('gw-boot', ['blocked', '신원 없음'], { GENIA_AGENT_GENERATION: '7', GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gw-boot: /);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.equal(srv.reqs.length, 0);
  } finally {
    srv.close();
  }
});

test('서버가 거절해도(500) 종료 0', async () => {
  addKey();
  const srv = await fakePaneServer({ status: 500, body: '{}' });
  try {
    const r = await runAsync('gw-boot', ['blocked', '서버 오류'], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gw-boot: /);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.doesNotMatch(r.stderr, /ak_FAKE_DEV/);
  } finally {
    srv.close();
  }
});
