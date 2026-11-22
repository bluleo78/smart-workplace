// genia-works 플러그인 gw-boot 테스트 — 칸 차단 보고(WP-1913): 가짜 pane 서버로 요청(메서드·주소·본문)을,
// 가짜 HOME·가짜 ps 로 AI 키 신원을 검증한다. 성공은 종료 0, 실패는 종료 1 — 감독 회차가 이 코드로 성공을 판정한다(표준 오류의 무해한
// 경고까지 실패로 보지 않게, WP-1913 리뷰 반려 ③). 표준 출력은 어느 쪽이든 늘 비어 있고 경고는 표준 오류로만 낸다.
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
// GW_PROC_DIR 를 없는 경로로 둬 Pod 시작 시각을 모르는 환경으로 고정한다 — 실제 /proc 이 읽히는 Linux 에서도 본문이 같게(WP-1958).
const WORKS = { GENIA_AGENT_GENERATION: '7', GENIA_WORKS_AS: 'ai-dev', GW_PROC_DIR: '/nonexistent-proc' };

/** 가짜 /proc — 1/stat(starttime 이 20번째 필드)과 uptime 을 만든다. 지금 기준 startAgoSec 초 전에 PID 1 이 시작한 것으로 흉내 낸다. */
function fakeProc({ startAgoSec, uptimeSec = 100000 }) {
  const hz = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim());
  const dir = mkdtempSync(join(tmpdir(), 'gw-proc-'));
  mkdirSync(join(dir, '1'));
  // starttime = (uptime - 시작 후 경과) 초를 tick 으로. comm 에 공백·괄호가 있어도 읽혀야 하므로 「(a b)」 로 둔다.
  const ticks = (uptimeSec - startAgoSec) * hz;
  // ") " 뒤 필드: state(1번째) + 0 18개 + starttime(20번째).
  writeFileSync(join(dir, '1', 'stat'), `1 (a b) S ${'0 '.repeat(18)}${ticks} 0 0\n`);
  writeFileSync(join(dir, 'uptime'), `${uptimeSec}.50 1.00\n`);
  return dir;
}

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
    // 본문에 generation 을 함께 실어 옛 Pod 의 늦은 보고를 서버가 걸러 내게 한다(WP-1913 리뷰 반려 ①).
    assert.deepEqual(JSON.parse(q.body), { state: 'BLOCKED', message: '네트워크 탓에 진입하지 못했습니다', generation: 7 });
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

    // 서버 @Size 는 UTF-16 코드 유닛으로 센다 — 이모지(글자 1개 = 유닛 2개)는 글자 수로 자르면 500 유닛을 넘겨 400 이 난다(WP-1913 리뷰 반려 ③).
    await runAsync('gw-boot', ['blocked', '😀'.repeat(300)], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    const emoji = JSON.parse(srv.reqs[3].body).message;
    assert.equal(emoji.length, 500, 'UTF-16 코드 유닛 500 자로 잘라야 한다');
    assert.equal(emoji, '😀'.repeat(250));

    // 유닛이 남지 않는 자리에서 자른다 — 499 유닛 뒤에 이모지(2 유닛)를 못 넣고 498 유닛에서 멈춘다.
    await runAsync('gw-boot', ['blocked', 'a' + '😀'.repeat(300)], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    const mixedEmoji = JSON.parse(srv.reqs[4].body).message;
    assert.equal(mixedEmoji.length, 499);
    assert.equal(mixedEmoji, 'a' + '😀'.repeat(249));
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
    assert.deepEqual(JSON.parse(srv.reqs[0].body), { state: 'OK', generation: 7 });
    assert.equal('message' in JSON.parse(srv.reqs[0].body), false);
  } finally {
    srv.close();
  }
});

test('blocked/ok 본문에 podStartedAt 을 싣는다 (WP-1958)', async () => {
  addKey();
  const srv = await fakePaneServer();
  const proc = fakeProc({ startAgoSec: 600 });
  try {
    const env = { ...WORKS, GW_PROC_DIR: proc, GENIA_WORKS_API_URL: srv.url };
    await runAsync('gw-boot', ['blocked', '막힘'], env);
    await runAsync('gw-boot', ['ok'], env);
    const expected = Date.now() - 600 * 1000;
    for (const q of srv.reqs) {
      const body = JSON.parse(q.body);
      assert.match(body.podStartedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.ok(Math.abs(Date.parse(body.podStartedAt) - expected) <= 5000, `podStartedAt=${body.podStartedAt}`);
    }
    assert.equal(srv.reqs.length, 2);
  } finally {
    srv.close();
  }
});

test('podStartedAt 을 모르면(/proc 을 못 읽음) 싣지 않는다 (WP-1958)', async () => {
  addKey();
  const srv = await fakePaneServer();
  try {
    const r = await runAsync('gw-boot', ['ok'], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    assert.equal('podStartedAt' in JSON.parse(srv.reqs[0].body), false);
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

test('AI 키 신원이 없으면 한 줄 경고 후 종료 1(실패 — 감독 회차가 재시도하게)', async () => {
  const srv = await fakePaneServer();
  try {
    // GENIA_WORKS_AS 도 세션 선택도 없다 — gw_identity_key 가 키를 못 낸다.
    const r = await runAsync('gw-boot', ['blocked', '신원 없음'], { GENIA_AGENT_GENERATION: '7', GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gw-boot: /);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.equal(srv.reqs.length, 0);
  } finally {
    srv.close();
  }
});

test('서버가 거절해도(500) 종료 1 — 출력이 아니라 종료 코드가 실패다', async () => {
  addKey();
  const srv = await fakePaneServer({ status: 500, body: '{}' });
  try {
    const r = await runAsync('gw-boot', ['blocked', '서버 오류'], { ...WORKS, GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gw-boot: /);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.doesNotMatch(r.stderr, /ak_FAKE_DEV/);
  } finally {
    srv.close();
  }
});
