// genia-works 플러그인 sh 스크립트 테스트 — 가짜 HOME·가짜 ps 로 키 저장소·세션 선택·세션 키를 검증한다.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, statSync, existsSync, readdirSync, chmodSync, symlinkSync, utimesSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'scripts');
let home, bin, table;

// 프로세스 표: 500(이 스크립트를 부른 셸) → 400(claude) → 1
function setTable(rows) {
  writeFileSync(table, rows.map((r) => r.join('|')).join('\n') + '\n');
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'gw-test-'));
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

function run(cmd, args = [], { input, env = {} } = {}) {
  return spawnSync(join(scripts, cmd), args, {
    input,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_START_PID: '500', ...env },
  });
}

test('gw-session-key: 가장 가까운 claude 조상의 pid-시작시각', () => {
  const r = run('gw-session-key');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '400-Thu_Oct_15_06_00_00_2026');
});

test('gw-session-key: npm 설치(node …/bin/claude)도 claude 로 본다', () => {
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh gw-headers'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', 'node /opt/homebrew/bin/claude'],
  ]);
  assert.equal(run('gw-session-key').stdout.trim(), '400-Thu_Oct_15_06_00_00_2026');
});

test('gw-session-key: 절대 경로 실행(/…/claude --resume …)도 claude 로 본다', () => {
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh gw-headers'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', '/Users/x/.local/bin/claude --resume abc'],
  ]);
  assert.equal(run('gw-session-key').stdout.trim(), '400-Thu_Oct_15_06_00_00_2026');
});

// WP-1292 — Claude Code 밖의 실행기(genia·codex) 아래에서도 그 세션을 「이 세션」으로 잡는다.
for (const [name, args] of [
  ['genia(실행 스크립트가 exec 한 ~/.genia/app/genia)', '/Users/x/.genia/app/genia --approve /gw-loop WP'],
  ['codex(네이티브)', 'codex --dangerously-bypass-approvals-and-sandbox'],
  ['codex(npm — node …/bin/codex.js)', 'node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js exec'],
]) {
  test(`gw-session-key: ${name} 도 이 세션으로 본다`, () => {
    setTable([
      ['500', '450', 'Thu Oct 15 06:40:01 2026', 'sh gw-headers'],
      ['450', '400', 'Thu Oct 15 06:39:00 2026', '/bin/bash -c x'],
      ['400', '1', 'Thu Oct 15 06:00:00 2026', args],
    ]);
    assert.equal(run('gw-session-key').stdout.trim(), '400-Thu_Oct_15_06_00_00_2026');
  });
}

test('gw-session-key: 이름만 비슷한 프로그램(geniax·codexify)은 세션으로 보지 않는다', () => {
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh gw-headers'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', '/usr/bin/geniax codexify'],
  ]);
  assert.equal(run('gw-session-key').status, 1);
});

test('gw-session-key: claude 조상이 없으면 실패', () => {
  setTable([['500', '1', 'Thu Oct 15 06:40:01 2026', 'sh gw-headers']]);
  assert.equal(run('gw-session-key').status, 1);
});

test('gw-keys add/has/list/remove: 폴더 700·파일 600, list 는 키 값을 내지 않는다', () => {
  assert.equal(run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_ABC123\n' }).status, 0);
  const dir = join(home, '.genia-works', 'keys');
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, 'ai-dev')).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, 'ai-dev'), 'utf8'), 'ak_FAKE_ABC123\n');
  assert.equal(run('gw-keys', ['has', 'ai-dev']).status, 0);
  const list = run('gw-keys', ['list']).stdout;
  assert.match(list, /^ai-dev\t\d\d-\d\d$/m);
  assert.doesNotMatch(list, /ak_/);
  assert.equal(run('gw-keys', ['remove', 'ai-dev']).status, 0);
  assert.equal(run('gw-keys', ['has', 'ai-dev']).status, 1);
});

test('gw-keys add: 이름·키 형식 검사, 임시 파일이 남지 않는다', () => {
  assert.equal(run('gw-keys', ['add', '../evil'], { input: 'ak_FAKE_A\n' }).status, 2);
  assert.equal(run('gw-keys', ['add', '..'], { input: 'ak_FAKE_A\n' }).status, 2);
  assert.equal(run('gw-keys', ['add', 'me'], { input: 'ak_FAKE_A\n' }).status, 2);
  assert.equal(run('gw-keys', ['add', 'ai dev'], { input: 'ak_FAKE_A\n' }).status, 2);
  assert.equal(run('gw-keys', ['add', 'ai-dev'], { input: 'swp_FAKE_ME\n' }).status, 3);
  assert.equal(run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE "x"\n' }).status, 3);
  assert.equal(run('gw-keys', ['add', 'ai-dev'], { input: '\n' }).status, 3);
  const dir = join(home, '.genia-works', 'keys');
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
});

test('gw-session select/show/clear: 키가 있는 이름만, me 는 언제나', () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_ABC123\n' });
  assert.equal(run('gw-session', ['select', 'nobody']).status, 4);
  // 내용이 깨진 키 파일은 헤더 스크립트가 거부하므로 고를 수도 없다(같은 기준 gw_key_ok).
  writeFileSync(join(home, '.genia-works', 'keys', 'broken'), 'ak_FAKE "x"\n');
  assert.equal(run('gw-session', ['select', 'broken']).status, 4);
  assert.equal(run('gw-session', ['select', 'ai-dev']).status, 0);
  assert.equal(run('gw-session', ['show']).stdout.trim(), 'ai-dev');
  const f = join(home, '.genia-works', 'sessions', '400-Thu_Oct_15_06_00_00_2026');
  assert.equal(readFileSync(f, 'utf8').trim(), 'ai-dev');
  assert.equal(run('gw-session', ['select', 'me']).status, 0);
  assert.equal(run('gw-session', ['show']).stdout.trim(), 'me');
  assert.equal(run('gw-session', ['clear']).status, 0);
  assert.equal(existsSync(f), false);
  assert.equal(run('gw-session', ['show']).stdout.trim(), '');
});

test('성공한 add/select 뒤에도 .tmp.* 임시 파일이 남지 않는다', () => {
  assert.equal(run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_ABC123\n' }).status, 0);
  assert.equal(run('gw-session', ['select', 'ai-dev']).status, 0);
  for (const d of ['keys', 'sessions']) {
    const files = readdirSync(join(home, '.genia-works', d));
    assert.equal(files.some((n) => n.startsWith('.tmp.')), false, d);
    assert.equal(files.length, 1, d);
  }
});

test('gw_prune_sessions: 시작 시각이 다른 세션 파일은 지우고 같은 것은 둔다', () => {
  const dir = join(home, '.genia-works', 'sessions');
  mkdirSync(dir, { recursive: true });
  const good = join(dir, '400-Thu_Oct_15_06_00_00_2026');
  const reused = join(dir, '400x-Thu_Oct_15_06_00_00_2026');
  const stale = join(dir, '400-Wed_Oct_14_01_00_00_2026');
  const dead = join(dir, '999-Thu_Oct_15_06_00_00_2026');
  for (const f of [good, stale, dead]) writeFileSync(f, 'me\n');
  writeFileSync(reused, 'me\n');
  const r = spawnSync('sh', ['-c', '. "$1/gw-lib.sh"; gw_prune_sessions', 'sh', scripts], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_PRUNE_PS_ONLY: '1' },
  });
  assert.equal(r.status, 0);
  assert.equal(existsSync(good), true);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(dead), false);
  assert.equal(existsSync(reused), false);
});

// 정리만 따로 돌린다 — kill 검사는 건너뛰고(GW_PRUNE_PS_ONLY) 가짜 ps 표만 본다.
function prune() {
  return spawnSync('sh', ['-c', '. "$1/gw-lib.sh"; gw_prune_sessions', 'sh', scripts], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_PRUNE_PS_ONLY: '1' },
  });
}

test('gw_prune_sessions: ps 가 시작 시각을 일시적으로 못 읽어도 살아 있는 세션 파일은 지우지 않는다', () => {
  const dir = join(home, '.genia-works', 'sessions');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, '400-Thu_Oct_15_06_00_00_2026');
  writeFileSync(f, 'ai-dev\n');
  // pid 400 은 표에 있지만(살아 있음) lstart 칸이 비어 있다 — ps 일시 실패 모사
  setTable([['400', '1', '', 'claude --plugin-dir x']]);
  assert.equal(prune().status, 0);
  assert.equal(existsSync(f), true);
});

test('gw_prune_sessions: 끝난 프로세스(pid 없음)의 파일은 지우고 pid 재사용(시작 시각 다름)도 지운다', () => {
  const dir = join(home, '.genia-works', 'sessions');
  mkdirSync(dir, { recursive: true });
  const dead = join(dir, '777-Thu_Oct_15_06_00_00_2026');
  const reused = join(dir, '400-Wed_Oct_14_01_00_00_2026');
  const live = join(dir, '401-Thu_Oct_15_06_00_00_2026');
  for (const f of [dead, reused, live]) writeFileSync(f, 'ai-dev\n');
  setTable([
    ['400', '1', 'Thu Oct 15 06:00:00 2026', 'claude'],
    ['401', '1', 'Thu Oct 15 06:00:00 2026', 'claude'],
  ]);
  assert.equal(prune().status, 0);
  assert.equal(existsSync(dead), false);
  assert.equal(existsSync(reused), false);
  assert.equal(existsSync(live), true);
});

test('gw-headers: 선택 없음·GENIA_WORKS_AS 없음 → {} (고정 헤더 사용)', () => {
  const r = run('gw-headers');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

test('gw-headers: GENIA_WORKS_AS 로 고른 AI 키', () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_ABC123\n' });
  const r = run('gw-headers', [], { env: { GENIA_WORKS_AS: 'ai-dev' } });
  assert.deepEqual(JSON.parse(r.stdout), { Authorization: 'Bearer ak_FAKE_ABC123' });
});

test('gw-headers: 세션 선택이 GENIA_WORKS_AS 보다 먼저, me 선택은 {}', () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  run('gw-keys', ['add', 'ai-rev'], { input: 'ak_FAKE_REV\n' });
  run('gw-session', ['select', 'ai-rev']);
  const a = run('gw-headers', [], { env: { GENIA_WORKS_AS: 'ai-dev' } });
  assert.deepEqual(JSON.parse(a.stdout), { Authorization: 'Bearer ak_FAKE_REV' });
  run('gw-session', ['select', 'me']);
  const b = run('gw-headers', [], { env: { GENIA_WORKS_AS: 'ai-dev' } });
  assert.equal(b.stdout.trim(), '{}');
});

// 판정 3: 헤더 스크립트가 실패하면 Claude Code 가 고정 헤더(내 토큰)로 조용히 접속하므로,
// 키 없는 이름은 실패(exit 1) 대신 무효 토큰을 내서 접속 자체를 거부시킨다.
test('gw-headers: 키 없는 이름·이상한 이름은 무효 토큰을 내고 다른 파일을 읽지 않는다', () => {
  writeFileSync(join(home, 'secret'), 'ak_FAKE_SHOULD_NOT_READ\n');
  for (const as of ['nobody', '../secret', '../../home/secret', 'a b']) {
    const r = run('gw-headers', [], { env: { GENIA_WORKS_AS: as } });
    assert.equal(r.stdout.includes('SHOULD_NOT_READ'), false, as);
    assert.equal(r.status, 0, as);
    assert.equal(JSON.parse(r.stdout).Authorization, 'Bearer invalid', as);
    assert.match(r.stderr, /키가 없습니다/, as);
  }
});

test('gw-headers: pid 재사용(시작 시각 다름) 세션 선택은 무시하고 지운다', () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const dir = join(home, '.genia-works', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '400-Wed_Oct_14_01_00_00_2026'), 'ai-dev\n'); // 같은 pid, 옛 시작 시각
  writeFileSync(join(dir, '999-Thu_Oct_15_01_00_00_2026'), 'ai-dev\n'); // 없는 pid
  const r = run('gw-headers');
  assert.equal(r.stdout.trim(), '{}');
  assert.deepEqual(readdirSync(dir), []);
});

test('gw-headers: 빈 키·따옴표/공백/역슬래시 든 키 파일은 없는 키와 같이 Bearer invalid', () => {
  const dir = join(home, '.genia-works', 'keys');
  mkdirSync(dir, { recursive: true });
  const bad = { empty: '', blank: '   \n', quote: 'ak_FA"KE\n', space: 'ak_FA KE\n', slash: 'ak_FA\\KE\n' };
  for (const [n, content] of Object.entries(bad)) {
    writeFileSync(join(dir, n), content);
    const r = run('gw-headers', [], { env: { GENIA_WORKS_AS: n } });
    assert.equal(r.status, 0, n);
    assert.equal(JSON.parse(r.stdout).Authorization, 'Bearer invalid', n);
  }
});

test('gw-headers: GENIA_WORKS_AS=me → {}', () => {
  const r = run('gw-headers', [], { env: { GENIA_WORKS_AS: 'me' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

test('gw-keys add: 따옴표 든 키는 exit 3', () => {
  const r = run('gw-keys', ['add', 'ai-x'], { input: 'ak_FA"KE\n' });
  assert.equal(r.status, 3);
  assert.equal(existsSync(join(home, '.genia-works', 'keys', 'ai-x')), false);
});

// 최종 리뷰 1: 세션 키가 지역 시간대에 좌우되면 세션 도중 TZ/DST 가 바뀔 때 신원이 조용히 뒤집힌다 — 진짜 ps 로 확인한다.
test('gw_proc_key: 진짜 ps 로 TZ 가 달라도 같은 키', (t) => {
  const probe = spawnSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' });
  if (probe.status !== 0 || !probe.stdout.trim()) return t.skip('ps -o lstart= 를 쓸 수 없는 환경');
  const keyUnder = (tz) =>
    spawnSync('sh', ['-c', '. "$1/gw-lib.sh"; gw_proc_key "$2"', 'sh', scripts, String(process.pid)], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, TZ: tz },
    });
  const a = keyUnder('Asia/Seoul');
  const b = keyUnder('America/New_York');
  assert.equal(a.status, 0);
  assert.equal(a.stdout.trim(), b.stdout.trim());
  assert.match(a.stdout.trim(), new RegExp(`^${process.pid}-`));
});

// 최종 리뷰 2: logout = select me — GENIA_WORKS_AS 로 띄운 세션에서도 내 토큰({})으로 간다. clear 면 GENIA_WORKS_AS 로 되돌아간다.
test('gw-headers: GENIA_WORKS_AS 세션에서 select me 하면 {} 이고 clear 하면 AS 키로 돌아간다', () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const env = { GENIA_WORKS_AS: 'ai-dev' };
  assert.equal(run('gw-session', ['select', 'me'], { env }).status, 0);
  assert.equal(run('gw-headers', [], { env }).stdout.trim(), '{}');
  run('gw-session', ['clear'], { env });
  assert.deepEqual(JSON.parse(run('gw-headers', [], { env }).stdout), { Authorization: 'Bearer ak_FAKE_DEV' });
});

// 최종 리뷰 10: has 도 헤더 스크립트와 같은 내용 검사를 한다.
test('gw-keys has: 빈 파일·따옴표/공백/역슬래시 든 파일은 없는 키와 같다', () => {
  const dir = join(home, '.genia-works', 'keys');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'good'), 'ak_FAKE_OK\n');
  assert.equal(run('gw-keys', ['has', 'good']).status, 0);
  const bad = { empty: '', blank: '   \n', quote: 'ak_FA"KE\n', space: 'ak_FA KE\n', slash: 'ak_FA\\KE\n' };
  for (const [n, content] of Object.entries(bad)) {
    writeFileSync(join(dir, n), content);
    assert.notEqual(run('gw-keys', ['has', n]).status, 0, n);
  }
});

// WP-376 work-loop 잠금(loop-lock) — 가짜 ps 표의 400 이 이 세션의 claude 다. kill 검사는 건너뛴다(GW_PRUNE_PS_ONLY).
function lock(cmd, main) {
  return run('loop-lock', [cmd, main], { env: { GW_PRUNE_PS_ONLY: '1' } });
}
function lockMain(line) {
  const main = mkdtempSync(join(tmpdir(), 'gw-main-'));
  const f = join(main, '.work-loop', 'state', 'loop.lock');
  if (line !== undefined) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, line + '\n');
  }
  return { main, f, read: () => readFileSync(f, 'utf8').trim() };
}
const MY_KEY = '400-Thu_Oct_15_06_00_00_2026';

test('loop-lock acquire: 잠금이 없으면 내 claude 의 pid-시작시각으로 쓰고 ok, 다시 불러도 ok', () => {
  const { main, read } = lockMain();
  const r = lock('acquire', main);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'ok');
  assert.equal(read(), MY_KEY);
  assert.equal(lock('acquire', main).stdout.trim(), 'ok');
  assert.equal(read(), MY_KEY);
});

test('loop-lock acquire: genia 세션 아래에서도 그 세션의 pid-시작시각으로 잡는다(WP-1292)', () => {
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh loop-lock'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', '/Users/x/.genia/app/genia --approve /gw-loop WP'],
  ]);
  const { main, read } = lockMain();
  assert.equal(lock('acquire', main).stdout.trim(), 'ok');
  assert.equal(read(), MY_KEY);
});

test('loop-lock acquire: 다른 살아 있는 claude 가 시작 시각도 맞게 쥐고 있으면 held <pid> 로 exit 1, 파일은 그대로', () => {
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh loop-lock'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', 'claude --plugin-dir x'],
    ['300', '1', 'Wed Oct 14 09:00:00 2026', 'node /opt/homebrew/bin/claude'],
  ]);
  const { main, read } = lockMain('300-Wed_Oct_14_09_00_00_2026');
  const r = lock('acquire', main);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), 'held 300');
  assert.equal(read(), '300-Wed_Oct_14_09_00_00_2026');
});

test('loop-lock acquire: 죽은 pid·시작 시각이 다른 pid(재사용)·claude 아닌 pid·예전 모양 줄은 넘겨받는다', () => {
  setTable([
    ['500', '400', 'Thu Oct 15 06:40:01 2026', 'sh loop-lock'],
    ['400', '1', 'Thu Oct 15 06:00:00 2026', 'claude --plugin-dir x'],
    ['300', '1', 'Thu Oct 15 05:00:00 2026', 'claude'],
    ['301', '1', 'Wed Oct 14 09:00:00 2026', 'vim notes.md'],
  ]);
  for (const line of [
    '999-Wed_Oct_14_09_00_00_2026', // 죽음
    '300-Wed_Oct_14_09_00_00_2026', // 살아 있는 claude 지만 시작 시각이 다름
    '301-Wed_Oct_14_09_00_00_2026', // 시작 시각은 맞지만 claude 가 아님
    '300 2026-10-14T09:00:00Z', // 예전 「<pid> <ISO 시각>」 줄
  ]) {
    const { main, read } = lockMain(line);
    const r = lock('acquire', main);
    assert.equal(r.status, 0, line);
    assert.equal(r.stdout.trim(), 'ok', line);
    assert.equal(read(), MY_KEY, line);
  }
});

test('loop-lock release: 내 잠금만 지우고 남의 잠금은 둔다', () => {
  const mine = lockMain(MY_KEY);
  assert.equal(lock('release', mine.main).status, 0);
  assert.equal(existsSync(mine.f), false);
  const other = lockMain('300-Wed_Oct_14_09_00_00_2026');
  assert.equal(lock('release', other.main).status, 0);
  assert.equal(other.read(), '300-Wed_Oct_14_09_00_00_2026');
});

test('loop-lock: 인자가 모자라거나 모르는 명령이면 exit 2', () => {
  assert.equal(run('loop-lock', ['acquire']).status, 2);
  assert.equal(run('loop-lock', ['steal', '/x']).status, 2);
});

// WP-994 work-loop 백그라운드 작업(bg-job) — 진짜 ps 로 띄운 프로세스를 본다(가짜 ps 표를 쓰지 않는다).
function job(args) {
  return spawnSync(join(scripts, 'bg-job'), args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
}
// 끝날 때까지(running 이 아닐 때까지) 기다린 상태 — 짧은 명령만 띄우므로 몇 초면 끝난다.
function waitDone(main, key) {
  for (let i = 0; i < 100; i++) {
    const s = job(['status', main, key]).stdout.trim();
    if (s !== 'running') return s;
    spawnSync('sleep', ['0.1']);
  }
  return 'running';
}

test('bg-job start/status: 작업 폴더에서 명령을 돌려 로그를 남기고, 끝나면 passed·failed <코드>', () => {
  const main = mkdtempSync(join(tmpdir(), 'gw-main-'));
  const work = mkdtempSync(join(tmpdir(), 'gw-work-'));
  assert.equal(job(['status', main, 'WP-1']).stdout.trim(), 'none');
  const r = job(['start', main, 'WP-1', work, '--', 'sh', '-c', 'pwd; echo done']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^started \d+$/m);
  assert.equal(waitDone(main, 'WP-1'), 'passed');
  const log = readFileSync(join(main, '.work-loop', 'state', 'jobs', 'WP-1.log'), 'utf8');
  assert.match(log, /done/);
  assert.ok(log.includes(work.split('/').pop()), '작업 폴더에서 돌아야 한다');

  job(['start', main, 'WP-1', work, '--', 'sh', '-c', 'exit 3']);
  assert.equal(waitDone(main, 'WP-1'), 'failed 3');
});

test('bg-job start: 돌고 있으면 새로 띄우지 않고 running 으로 exit 1, clear 도 거절하고, stop 은 자식까지 그룹째 끝낸다', () => {
  const main = mkdtempSync(join(tmpdir(), 'gw-main-'));
  const work = mkdtempSync(join(tmpdir(), 'gw-work-'));
  job(['start', main, 'WP-2', work, '--', 'sleep', '5']);
  assert.equal(job(['status', main, 'WP-2']).stdout.trim(), 'running');
  const again = job(['start', main, 'WP-2', work, '--', 'true']);
  assert.equal(again.status, 1);
  assert.equal(again.stdout.trim(), 'running');
  assert.equal(job(['clear', main, 'WP-2']).status, 1);
  // 띄운 셸이 새 프로세스 그룹의 대표다 — stop 이 그룹째 끝내 자식(sleep)도 남지 않는다.
  const pid = readFileSync(join(main, '.work-loop', 'state', 'jobs', 'WP-2.pid'), 'utf8').split('-')[0];
  const group = () => spawnSync('ps', ['-axo', 'pgid=']).stdout.toString().split('\n').filter((g) => g.trim() === pid).length;
  assert.ok(group() >= 2, '띄운 셸과 자식이 같은 새 그룹에 있어야 한다');
  assert.equal(job(['stop', main, 'WP-2']).stdout.trim(), 'ok');
  for (let i = 0; i < 50 && group() > 0; i++) spawnSync('sleep', ['0.1']);
  assert.equal(group(), 0);
  assert.equal(job(['status', main, 'WP-2']).stdout.trim(), 'none');
});

// WP-1207 — dash(우분투 /bin/sh)의 kill 은 `kill -TERM -- <음수>`·`kill -TERM -<pgid>` 같은 꼴을 「Illegal number」로 거절해, stop 이 아무것도
// 끝내지 못하고 「ok」만 냈다. 위 테스트는 /bin/sh 가 dash 인 곳에서만 이 회귀를 잡는다(macOS 는 bash 라 통과) — 어디서나 잡히게 꼴도 고정한다.
test('bg-job stop: 어느 sh 에서나 받는 `kill -s <신호> -- <그룹>` 꼴로만 신호를 보낸다 (WP-1207)', () => {
  const text = readFileSync(join(scripts, 'bg-job'), 'utf8');
  const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.ok(code.includes('kill -s TERM -- "-$_bj_pid"'));
  // `kill -s …` 가 아닌 `kill -<신호>` 꼴로 음수(그룹)를 넘기면 dash 가 거절한다.
  assert.ok(!/kill -(?!s\b)[A-Za-z0-9]+\s+(--\s+)?"?-/.test(code), 'dash 가 거절하는 `kill -<신호> [--] -<그룹>` 꼴이 남아 있다');
});

test('bg-job stop: dash 로 불러도 그룹이 실제로 끝난 뒤에 ok 를 낸다 (WP-1207)', (t) => {
  const dash = spawnSync('sh', ['-c', 'command -v dash']).stdout.toString().trim();
  if (!dash) return t.skip('dash 가 없다');
  const main = mkdtempSync(join(tmpdir(), 'gw-main-'));
  const work = mkdtempSync(join(tmpdir(), 'gw-work-'));
  let pid = '';
  try {
    const started = spawnSync(dash, [join(scripts, 'bg-job'), 'start', main, 'WP-3', work, '--', 'sleep', '30']);
    assert.match(started.stdout.toString(), /^started \d+/);
    pid = readFileSync(join(main, '.work-loop', 'state', 'jobs', 'WP-3.pid'), 'utf8').split('-')[0];
    const alive = () => spawnSync('ps', ['-axo', 'pgid=']).stdout.toString().split('\n').some((g) => g.trim() === pid);
    assert.ok(alive(), '띄운 그룹이 돌고 있어야 한다');
    const r = spawnSync(dash, [join(scripts, 'bg-job'), 'stop', main, 'WP-3']);
    assert.equal(r.stdout.toString().trim(), 'ok', r.stderr.toString());
    // stop 이 끝날 때까지 기다리므로 ok 를 낸 때 이미 그룹이 없다.
    assert.equal(alive(), false, 'dash 로 부른 stop 이 그룹을 끝내지 않고 ok 를 냈다');
  } finally {
    if (pid) try { process.kill(-Number(pid), 'SIGKILL'); } catch {}
    rmSync(main, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('bg-job status: exit 파일 없이 프로세스가 사라졌거나 pid 가 재사용됐으면 lost, clear 뒤에는 none', () => {
  const main = mkdtempSync(join(tmpdir(), 'gw-main-'));
  const dir = join(main, '.work-loop', 'state', 'jobs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'WP-3.pid'), '999999-Thu_Oct_15_06_00_00_2026\n');
  assert.equal(job(['status', main, 'WP-3']).stdout.trim(), 'lost');
  // 살아 있는 pid(이 테스트 프로세스)라도 시작 시각이 다르면 재사용으로 본다.
  writeFileSync(join(dir, 'WP-3.pid'), `${process.pid}-Thu_Oct_15_06_00_00_2026\n`);
  assert.equal(job(['status', main, 'WP-3']).stdout.trim(), 'lost');
  // 띄울 때 시작 시각을 못 읽어 "<pid>-" 로 남았으면 살아 있는지만 본다.
  writeFileSync(join(dir, 'WP-3.pid'), `${process.pid}-\n`);
  assert.equal(job(['status', main, 'WP-3']).stdout.trim(), 'running');
  writeFileSync(join(dir, 'WP-3.pid'), '999999-\n');
  assert.equal(job(['status', main, 'WP-3']).stdout.trim(), 'lost');
  assert.equal(job(['clear', main, 'WP-3']).stdout.trim(), 'ok');
  assert.equal(job(['status', main, 'WP-3']).stdout.trim(), 'none');
});

test('bg-job: 이상한 이슈 키·없는 작업 폴더·-- 빠짐·모르는 명령이면 exit 2', () => {
  const main = mkdtempSync(join(tmpdir(), 'gw-main-'));
  assert.equal(job(['status', main, '../x']).status, 2);
  assert.equal(job(['start', main, 'WP-4', join(main, 'nope'), '--', 'true']).status, 2);
  assert.equal(job(['start', main, 'WP-4', main, 'true']).status, 2);
  assert.equal(job(['kill', main, 'WP-4']).status, 2);
});

// ---------------------------------------------------------------- gw-events (WP-720)

/**
 * 가짜 알림 서버 — /events 는 events 를 SSE 로 내고 연결을 열어 둔다(endFirst 면 첫 연결은 events 를 낸 뒤 끊고, 다음 연결은 빈 채로 연다).
 * /notifications/unread-count 는 status 를 낸다. 받은 인증 헤더를 모은다.
 */
async function fakeEventServer({ events = [], status = 200, endFirst = false } = {}) {
  let streams = 0;
  const auths = [];
  const server = createServer((req, res) => {
    auths.push(req.headers.authorization);
    if (status !== 200) {
      res.writeHead(status);
      res.end();
      return;
    }
    if (req.url.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(':connected\n\n');
      streams += 1;
      if (endFirst && streams > 1) return; // 다시 붙은 연결은 빈 채로 열어 둔다.
      for (const [name, data] of events) res.write(`event:${name}\ndata:${JSON.stringify(data)}\n\n`);
      if (endFirst) res.end();
      return; // 연결을 열어 둔다(서버 ping 없이 — 합친 줄은 이 테스트 동안 나오지 않는다).
    }
    res.writeHead(200);
    res.end('{"count":0}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // 열린 SSE 연결까지 끊어야 close 가 끝난다.
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, auths, close };
}

/**
 * gw-events 를 띄워 waitMs 동안의 표준 출력을 모은다(끝나면 종료 코드도). 시간이 지나면 SIGTERM 으로 끝내고 자식(curl)이 남지 않았는지도 본다.
 * inPs 면 가짜 ps 표에 자기 행(gw-events)을 먼저 쓰고 exec 로 띄운다 — 같은 pid 라 스크립트가 자기 키(pid-시작 시각)를 읽을 수 있다.
 */
async function runEvents(args, env, waitMs, { inPs = false } = {}) {
  const register = 'printf "%s|400|Thu Oct 15 06:41:00 2026|sh /x/scripts/gw-events\\n" $$ >> "$FAKE_PS_TABLE"; exec "$0" "$@"';
  const [cmd, argv] = inPs ? ['sh', ['-c', register, join(scripts, 'gw-events'), ...args]] : [join(scripts, 'gw-events'), args];
  const p = spawn(cmd, argv, {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_START_PID: '500', ...env },
  });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  const exited = new Promise((r) => p.on('exit', (code) => r(code)));
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), waitMs))]);
  if (code === null) {
    p.kill('SIGTERM');
    await exited;
  }
  const orphans = spawnSync('pgrep', ['-P', String(p.pid)], { encoding: 'utf8' }).stdout.trim();
  return { out, code, orphans };
}

test('gw-events: AI 키 신원이 아니면 한 줄 알리고 끝난다', async () => {
  const r = await runEvents(['WP'], {}, 3000);
  assert.equal(r.code, 1);
  assert.match(r.out, /^gw-events: AI 키 신원이 아니어서/);
});

test('gw-events: 맡은 프로젝트의 알림만 wake 줄로, 몰아친 알림은 합친다 — 키는 출력하지 않는다', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventServer({
    events: [
      ['notify.created', { type: 'ASSIGNED', issueId: 1, issueKey: 'HR-3', projectKey: 'HR' }],
      ['chat.message.created', { projectKey: 'WP', body: 'x' }],
      ['notify.created', { type: 'REMINDER' }],
      ['notify.created', { type: 'ISSUE_CHAT_MENTION', issueId: 2, issueKey: 'WP-12', projectKey: 'WP' }],
      ['notify.created', { type: 'COMMENTED', issueId: 2, issueKey: 'WP-12', projectKey: 'WP' }],
    ],
  });
  try {
    const r = await runEvents(['WP,QA'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url }, 2500);
    assert.equal(r.out, 'wake WP-12 ISSUE_CHAT_MENTION\n');
    assert.equal(r.orphans, '');
    assert.equal(srv.auths[0], 'Bearer ak_FAKE_DEV');
    assert.ok(!r.out.includes('ak_FAKE_DEV'));
  } finally {
    srv.close();
  }
});

test('gw-events: 인증이 거부되면 한 줄 알리고 끝난다', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventServer({ status: 401 });
  try {
    const r = await runEvents(['WP'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url }, 5000);
    assert.equal(r.code, 1);
    assert.match(r.out, /^gw-events: 인증 실패\(HTTP 401\)/);
  } finally {
    srv.close();
  }
});

test('gw-events: 연결이 끊기면 미뤄 둔 줄을 내고, 다시 붙으면 reconnect 줄을 낸다 — 소문자 프로젝트 키도 맞춘다', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventServer({
    endFirst: true,
    events: [
      ['notify.created', { type: 'ISSUE_CHAT_MENTION', issueId: 2, issueKey: 'WP-12', projectKey: 'WP' }],
      ['notify.created', { type: 'COMMENTED', issueId: 2, issueKey: 'WP-12', projectKey: 'WP' }],
    ],
  });
  try {
    // 끊긴 뒤 5초 쉬고 다시 붙는다.
    const r = await runEvents(['wp'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url }, 8000);
    assert.equal(r.out, 'wake WP-12 ISSUE_CHAT_MENTION\nwake WP-12 COMMENTED\nwake - reconnect\n');
    assert.equal(r.orphans, '');
  } finally {
    srv.close();
  }
});

test('gw-events: 한 세션에 하나만 — 이미 돌고 있으면 아무 줄 없이 끝난다', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventServer();
  const env = { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url };
  try {
    const first = runEvents(['WP'], env, 3000, { inPs: true });
    await new Promise((r) => setTimeout(r, 800));
    const second = await runEvents(['WP'], env, 2000);
    assert.equal(second.code, 0);
    assert.equal(second.out, '');
    assert.equal((await first).code, null); // 첫 것은 끝까지 돌다가 테스트가 끝냈다.
  } finally {
    srv.close();
  }
});

// ---------------------------------------------------------------- start-agent 도우미 (WP-1011·WP-1046)

/** 가짜 프로젝트 목록 서버 — status 와 body 를 내고, 받은 인증 헤더·주소를 모은다. */
async function fakeProjectServer({ status = 200, body = '{"content":[],"page":0,"size":100,"totalElements":0,"totalPages":0}', pages } = {}) {
  const reqs = [];
  const server = createServer((req, res) => {
    reqs.push({ url: req.url, auth: req.headers.authorization });
    // pages 가 있으면 page 쿼리에 맞는 항목(객체 → JSON)을, 없거나 범위 밖이면 body 를 낸다. 항목이 숫자면 그 상태 코드로 답한다.
    const pg = Number(new URL(req.url, 'http://x').searchParams.get('page'));
    const entry = pages?.[pg];
    const st = typeof entry === 'number' ? entry : status;
    res.writeHead(st, { 'Content-Type': 'application/json' });
    res.end(st === 200 ? (entry && typeof entry === 'object' ? JSON.stringify(entry) : body) : '{"status":' + st + '}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, reqs, close: () => server.close() };
}

/** 스크립트를 비동기로 띄운다 — 같은 프로세스의 가짜 서버가 답해야 하므로 spawnSync 로는 기다릴 수 없다. */
function runAsync(cmd, args, env = {}) {
  const p = spawn(join(scripts, cmd), args, {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, ...env },
  });
  let stdout = '';
  let stderr = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.stderr.on('data', (d) => (stderr += d));
  return new Promise((r) => p.on('close', (status) => r({ status, stdout, stderr })));
}

const agentProjects = (args, env) => runAsync('gw-agent-projects', args, env);

test('gw-agent-projects: 등록한 AI 키로 프로젝트 목록 한 페이지(100개씩)를 그대로 내고, 키는 어디에도 내지 않는다', async () => {
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const body = '{"content":[{"key":"WP","viewerRole":"MEMBER","repositoryUrl":"https://github.com/x/y.git"}],"page":1,"size":100,"totalElements":101,"totalPages":2}';
  const srv = await fakeProjectServer({ body });
  try {
    const r = await agentProjects(['kodi', '1'], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, body + '\n');
    assert.deepEqual(srv.reqs, [{ url: '/api/v1/projects?page=1&size=100', auth: 'Bearer ak_FAKE_KODI' }]);
    assert.doesNotMatch(r.stdout + r.stderr, /ak_FAKE_KODI/);
  } finally {
    srv.close();
  }
});

test('gw-agent-projects: 키 거절(401)은 4, 권한 없음(403)은 6, 서버 오류는 5 — 한 줄만 알린다', async () => {
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const cases = [
    [401, 4, /kodi 키가 거절됐습니다\(HTTP 401\)/],
    [403, 6, /kodi 에게 프로젝트를 볼 권한이 없습니다\(HTTP 403\)/],
    [500, 5, /읽지 못했습니다\(HTTP 500/],
  ];
  for (const [status, code, msg] of cases) {
    const srv = await fakeProjectServer({ status });
    try {
      const r = await agentProjects(['kodi'], { GENIA_WORKS_API_URL: srv.url });
      assert.equal(r.status, code);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, msg);
      assert.equal(srv.reqs[0].url, '/api/v1/projects?page=0&size=100');
    } finally {
      srv.close();
    }
  }
});

test('gw-agent-projects: 서버에 닿지 못하면 5 — 주소 끝의 / 는 떼고 부른다', async () => {
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const down = await agentProjects(['kodi'], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(down.status, 5);
  assert.match(down.stderr, /서버에 닿지 못했습니다\(http:\/\/127\.0\.0\.1:9\/api\/v1\)/);
  const srv = await fakeProjectServer();
  try {
    assert.equal((await agentProjects(['kodi'], { GENIA_WORKS_API_URL: srv.url + '//' })).status, 0);
    assert.equal(srv.reqs[0].url, '/api/v1/projects?page=0&size=100');
  } finally {
    srv.close();
  }
});

test('gw-agent-projects: 키 파일이 깨졌으면 「없음」과 나눠 알린다', async () => {
  const dir = join(home, '.genia-works', 'keys');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'kodi'), 'not a key\n');
  const r = await agentProjects(['kodi'], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kodi 키 파일이 키 형식이 아닙니다/);
});

test('gw-agent-projects: 키가 없거나 인자가 잘못되면 서버에 묻지 않고 끝난다', async () => {
  const noKey = await agentProjects(['kodi'], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /kodi 키가 이 컴퓨터에 없습니다/);
  assert.equal((await agentProjects([])).status, 2);
  assert.equal((await agentProjects(['kodi', '-1'])).status, 2);
  assert.equal((await agentProjects(['../x'])).status, 1);
});

// WP-1265·1275 — 「이 AI 가 맡을 프로젝트」는 서버(GET /agent-runtime/me/projects)가 고르고 --assigned 가 줄로 바꾼다.
// start-agent 스킬과 작업 공간 엔트리포인트·알림 감시가 이것을 부른다.
const hasJq = spawnSync('jq', ['--version']).status === 0;
const jqTest = (name, fn) => test(name, { skip: !hasJq && 'jq 없음' }, fn);
const ASSIGNED_URL = '/api/v1/agent-runtime/me/projects';

jqTest('gw-agent-projects --assigned: 서버가 고른 목록을 한 번에 받아 「키<탭>주소<탭>브랜치」로 낸다', async () => {
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const body = JSON.stringify([
    { projectKey: 'WD', name: 'WD', repositoryUrl: 'https://g/wd.git', repositoryBranch: 'develop' },
    { projectKey: 'WP', name: 'WP', repositoryUrl: 'https://g/wp.git', repositoryBranch: null },
    { projectKey: 'a/../b', name: 'x', repositoryUrl: 'https://g/c.git' }, // 서버가 걸러도 폴더·칸 이름이 될 수 없는 키는 한 번 더 버린다
    { projectKey: 'EM', name: 'x', repositoryUrl: '' },
    { projectKey: 'ZZ_9-x', name: 'x', repositoryUrl: 'https://g/zz.git' },
  ]);
  const srv = await fakeProjectServer({ body });
  try {
    const r = await agentProjects(['--assigned', 'kodi'], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'WD\thttps://g/wd.git\tdevelop\nWP\thttps://g/wp.git\t\nZZ_9-x\thttps://g/zz.git\t\n');
    // 프로젝트 목록을 쪽마다 받지 않고 한 번만 부른다
    assert.deepEqual(srv.reqs, [{ url: ASSIGNED_URL, auth: 'Bearer ak_FAKE_KODI' }]);
    assert.doesNotMatch(r.stdout + r.stderr, /ak_FAKE_KODI/);
  } finally {
    srv.close();
  }
});

jqTest('gw-agent-projects --assigned: 맡을 프로젝트가 없으면 빈 출력으로 0', async () => {
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const srv = await fakeProjectServer({ body: '[]' });
  try {
    const r = await agentProjects(['--assigned', 'kodi'], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally {
    srv.close();
  }
});

jqTest('gw-agent-projects --assigned: 401 은 4, AI 키가 아니면(403) 6, 옛 서버(404)·서버 오류·JSON 아님은 5', async () => {
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  for (const [status, code, msg] of [
    [401, 4, /거절됐습니다\(HTTP 401\)/],
    [403, 6, /AI 의 키인지 확인하세요/],
    [404, 5, /Works 를 새 버전으로 올리세요/],
    [500, 5, /읽지 못했습니다\(HTTP 500/],
  ]) {
    const srv = await fakeProjectServer({ status });
    try {
      const r = await agentProjects(['--assigned', 'kodi'], { GENIA_WORKS_API_URL: srv.url });
      assert.equal(r.status, code);
      assert.match(r.stderr, msg);
      assert.equal(r.stdout, '');
    } finally {
      srv.close();
    }
  }
  const down = await agentProjects(['--assigned', 'kodi'], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(down.status, 5);
  for (const body of ['not json', '{"content":[]}']) {
    const bad = await fakeProjectServer({ body });
    try {
      const r = await agentProjects(['--assigned', 'kodi'], { GENIA_WORKS_API_URL: bad.url });
      assert.equal(r.status, 5);
      assert.match(r.stderr, /JSON 으로 읽지 못했습니다/);
    } finally {
      bad.close();
    }
  }
});

test('gw-agent-projects --assigned: 키 없음·깨진 키는 1, 인자가 잘못되면 2', async () => {
  const noKey = await agentProjects(['--assigned', 'kodi'], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /kodi 키가 이 컴퓨터에 없습니다/);
  assert.equal((await agentProjects(['--assigned'])).status, 2);
  assert.equal((await agentProjects(['--assigned', 'kodi', '1'])).status, 2);
  assert.equal((await agentProjects(['--assigned', '../x'])).status, 1);
});

// ---------------------------------------------------------------- agent-window — 진짜 tmux 로 (WP-1053)
// 칸 나누기·죽은 칸·다시 띄우기는 tmux 의 실제 동작이라 가짜로는 지킬 수 없다(WP-1046 의 결함이 가짜 tmux 로만 보다 빠졌다).
// 테스트마다 이름이 다른 격리 서버(-L)를 설정 파일 없이(-f /dev/null) 띄워 사람의 tmux 와 섞이지 않게 하고, 끝나면 서버째 끈다.
const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const tmuxTest = (name, fn) => test(name, { skip: !hasTmux && 'tmux 없음' }, fn);
let tmuxSeq = 0;

/** 격리 tmux 서버 — wrapper 는 GW_TMUX 로 넘길 실행 파일, tmux(...) 는 같은 서버에 명령을 보낸다. */
function tmuxServer(t) {
  const wrapper = join(home, 'tmux');
  writeFileSync(wrapper, `#!/bin/sh\nexec tmux -L gwtest-${process.pid}-${++tmuxSeq} -f /dev/null "$@"\n`);
  chmodSync(wrapper, 0o755);
  const tmux = (...args) => spawnSync(wrapper, args, { encoding: 'utf8' }).stdout.trim();
  t.after(() => tmux('kill-server'));
  return { wrapper, tmux };
}

/** 세션의 칸을 「창 이름 · 칸 id · 죽음 여부 · 키 · pid」 객체로 읽는다. */
function panes(tmux, session) {
  return tmux('list-panes', '-s', '-t', `=${session}`, '-F', '#W|#{pane_id}|#{pane_dead}|#{@gw_key}|#{pane_pid}')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [win, id, dead, key, pid] = l.split('|');
      return { win, id, dead: dead === '1', key, pid };
    });
}

const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 30));
  assert.ok(cond());
};

function agentWindow(wrapper, args) {
  return run('agent-window', args, { env: { GW_TMUX: wrapper } });
}

tmuxTest('agent-window: 세션이 없으면 work 창 하나로 만들고, 다음 프로젝트는 같은 창에 칸으로 나눈다 — 명령 인자는 공백·한글도 그대로', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const out = join(home, 'args');
  const record = ['sh', '-c', 'pwd > "$0"; printf "%s\\n" "$@" >> "$0"; exec sleep 60', out, '/loop /genia-works:work-loop WP --queue "AI 개발팀"'];
  const r = agentWindow(wrapper, ['kodi', 'WP', home, ...record]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'started kodi\n');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('AI'));
  assert.equal(readFileSync(out, 'utf8'), `${home}\n/loop /genia-works:work-loop WP --queue "AI 개발팀"\n`);

  assert.equal(agentWindow(wrapper, ['kodi', 'HR', home, 'sleep', '60']).stdout, 'started kodi\n');
  assert.deepEqual(panes(tmux, 'kodi').map((p) => [p.win, p.key]), [['work', 'WP'], ['work', 'HR']]);
  // 붙은 사람이 클릭으로 칸을 고르고, 칸 위에 키가 보이고, 끝난 칸이 남게.
  assert.equal(tmux('show-options', '-v', '-t', '=kodi:', 'mouse'), 'on');
  assert.equal(tmux('show-options', '-wv', '-t', '=kodi:=work', 'remain-on-exit'), 'on');
  assert.equal(tmux('show-options', '-wv', '-t', '=kodi:=work', 'pane-border-status'), 'top');
  assert.match(tmux('show-options', '-wv', '-t', '=kodi:=work', 'pane-border-format'), /@gw_key/);
});

tmuxTest('agent-window: 돌던 칸은 exists 로 두고, 끝난 칸(죽은 칸)은 그 자리에서 다시 띄워 revived', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']);
  agentWindow(wrapper, ['kodi', 'HR', home, 'true']);
  await until(() => panes(tmux, 'kodi').find((p) => p.key === 'HR')?.dead);
  const before = panes(tmux, 'kodi');

  assert.equal(agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']).stdout, 'exists kodi\n');
  assert.equal(agentWindow(wrapper, ['kodi', 'HR', home, 'sleep', '60']).stdout, 'revived kodi\n');
  const after = panes(tmux, 'kodi');
  assert.deepEqual(after.map((p) => [p.id, p.key, p.dead]), before.map((p) => [p.id, p.key, false]));
  assert.equal(after[0].pid, before[0].pid); // 돌던 칸은 건드리지 않았다.
});

tmuxTest('agent-window --restart: 돌던 칸도 그 자리에서 다시 띄우고 키 표시는 남는다, 없던 칸은 started', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']);
  const [before] = panes(tmux, 'kodi');
  assert.equal(agentWindow(wrapper, ['--restart', 'kodi', 'WP', home, 'sleep', '61']).stdout, 'restarted kodi\n');
  const [after] = panes(tmux, 'kodi');
  assert.equal(after.id, before.id);
  assert.equal(after.key, 'WP');
  assert.notEqual(after.pid, before.pid);
  assert.equal(agentWindow(wrapper, ['--restart', 'kodi', 'OPS', home, 'sleep', '60']).stdout, 'started kodi\n');
});

tmuxTest('agent-window: 예전 구성(프로젝트마다 창 + home)은 legacy 로 두고, --restart 때 칸으로 옮기며 그 옛 창만 닫는다 — home 은 둔다', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  tmux('new-session', '-d', '-s', 'kodi', '-n', 'home', 'sleep', '60');
  tmux('new-window', '-d', '-t', '=kodi:', '-n', 'WP', 'sleep', '60');
  tmux('new-window', '-d', '-t', '=kodi:', '-n', 'HR', 'sleep', '60');

  assert.equal(agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']).stdout, 'legacy kodi\n');
  assert.equal(tmux('list-windows', '-t', '=kodi', '-F', '#W'), 'home\nWP\nHR');

  assert.equal(agentWindow(wrapper, ['--restart', 'kodi', 'WP', home, 'sleep', '60']).stdout, 'started kodi\n');
  // 옮기다 멈췄으면(HR 이 아직 옛 창) 그냥 부르기는 HR 칸을 더 띄우지 않는다 — 같은 clone 에 work-loop 가 둘이 되지 않게.
  assert.equal(agentWindow(wrapper, ['kodi', 'HR', home, 'sleep', '60']).stdout, 'legacy kodi\n');
  assert.equal(agentWindow(wrapper, ['--restart', 'kodi', 'HR', home, 'sleep', '60']).stdout, 'started kodi\n');
  // home 창은 사람이 그 안에서 start-agent 를 돌리고 있을 수 있어 닫지 않는다.
  assert.equal(tmux('list-windows', '-t', '=kodi', '-F', '#W #{window_active}'), 'home 0\nwork 1');
  assert.deepEqual(panes(tmux, 'kodi').filter((p) => p.win === 'work').map((p) => p.key), ['WP', 'HR']);
  assert.equal(tmux('show-options', '-v', '-t', '=kodi:', 'mouse'), 'on');
  // 옮긴 뒤 남은 옛 창(연결이 지워진 프로젝트)은 home 이 없으니 새 프로젝트 더하기를 막지 않는다.
  tmux('new-window', '-d', '-t', '=kodi:', '-n', 'OLD', 'sleep', '60');
  assert.equal(agentWindow(wrapper, ['kodi', 'OPS', home, 'sleep', '60']).stdout, 'started kodi\n');
});

tmuxTest('agent-window: 곧바로 끝나는 명령(claude 실행 실패 등)도 칸이 남아 다음 부르기가 revived 로 다시 띄운다', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  assert.equal(agentWindow(wrapper, ['kodi', 'WP', home, 'false']).stdout, 'started kodi\n');
  await until(() => panes(tmux, 'kodi')[0]?.dead);
  assert.equal(panes(tmux, 'kodi')[0].key, 'WP');
  assert.equal(agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']).stdout, 'revived kodi\n');
  assert.equal(panes(tmux, 'kodi')[0].dead, false);
});

tmuxTest('agent-window: 붙은 화면이 작아 더 나눌 자리가 없으면 그 프로젝트만 따로 창을 띄우고, 다시 부르면 그 칸을 찾는다', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']);
  tmux('resize-window', '-t', '=kodi:=work', '-x', '12', '-y', '4');
  for (const k of ['HR', 'OPS']) assert.equal(agentWindow(wrapper, ['kodi', k, home, 'sleep', '60']).stdout, 'started kodi\n');
  assert.deepEqual(panes(tmux, 'kodi').map((p) => [p.win, p.key]), [['work', 'WP'], ['work', 'HR'], ['OPS', 'OPS']]);
  assert.equal(agentWindow(wrapper, ['kodi', 'OPS', home, 'sleep', '60']).stdout, 'exists kodi\n');
});

tmuxTest('agent-window --keys: 칸마다 프로젝트 키, 키 없는 칸(예전 구성의 창·home)은 창 이름 — 세션이 없으면 3', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const keys = (name) => run('agent-window', ['--keys', name], { env: { GW_TMUX: wrapper } });
  assert.equal(keys('dev.kodi').status, 3);
  tmux('new-session', '-d', '-s', 'dev_kodi', '-n', 'home', 'sleep', '60');
  tmux('new-window', '-d', '-t', '=dev_kodi:', '-n', 'OLD', 'sleep', '60');
  agentWindow(wrapper, ['--restart', 'dev.kodi', 'WP', home, 'sleep', '60']);
  assert.equal(keys('dev.kodi').stdout, 'home\nOLD\nWP\n');
});

tmuxTest('agent-window: 같은 세션을 여럿이 동시에 불러도 차례로 해 같은 프로젝트 칸은 하나만 생긴다', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']);
  const outs = await Promise.all(Array.from({ length: 4 }, () => runAsync('agent-window', ['kodi', 'HR', home, 'sleep', '60'], { GW_TMUX: wrapper })));
  assert.deepEqual(outs.map((o) => o.stdout).sort(), ['exists kodi\n', 'exists kodi\n', 'exists kodi\n', 'started kodi\n']);
  assert.deepEqual(panes(tmux, 'kodi').map((p) => p.key), ['WP', 'HR']);
});

tmuxTest('agent-window: 신원 이름의 . 은 tmux 처럼 _ 로 바꿔 — 다시 불러도 같은 세션의 칸을 찾아 exists', (t) => {
  const { wrapper } = tmuxServer(t);
  assert.equal(agentWindow(wrapper, ['dev.kodi', 'WP', home, 'sleep', '60']).stdout, 'started dev_kodi\n');
  assert.equal(agentWindow(wrapper, ['dev.kodi', 'WP', home, 'sleep', '60']).stdout, 'exists dev_kodi\n');
});

test('agent-window: tmux 가 없으면 no-tmux 로 3', () => {
  const r = run('agent-window', ['kodi', 'WP', '/x', 'claude'], { env: { GW_TMUX: '/nonexistent/tmux' } });
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'no-tmux\n');
});

// ---------------------------------------------------------------- agent-home — AI 폴더 설정·새 프로젝트 확인 (WP-1053)

function aiDir() {
  const d = join(home, 'agents', 'kodi');
  mkdirSync(d, { recursive: true });
  return d;
}

test('agent-home get/set queue: 저장한 적 없으면 1, 빈 값(가져오지 않기)도 값이고, 다시 set 하면 바뀐다', () => {
  const d = aiDir();
  assert.equal(run('agent-home', [d, 'get', 'queue']).status, 1);
  assert.equal(run('agent-home', [d, 'set', 'queue', '']).status, 0);
  const empty = run('agent-home', [d, 'get', 'queue']);
  assert.deepEqual([empty.status, empty.stdout], [0, '\n']);
  run('agent-home', [d, 'set', 'queue', 'AI 개발팀']);
  assert.equal(run('agent-home', [d, 'get', 'queue']).stdout, 'AI 개발팀\n');
  assert.equal(readFileSync(join(d, 'agent.conf'), 'utf8'), 'queue=AI 개발팀\n');
  assert.deepEqual(readdirSync(d).filter((f) => f.includes('.tmp.')), []);
});

test('agent-home get/set cli: 저장한 적 없으면 claude, 띄울 수 있는 실행기(claude·genia·codex)만 저장한다(WP-1292)', () => {
  const d = aiDir();
  assert.equal(run('agent-home', [d, 'get', 'cli']).stdout, 'claude\n');
  assert.equal(run('agent-home', [d, 'set', 'cli', 'genia']).status, 0);
  assert.equal(run('agent-home', [d, 'get', 'cli']).stdout, 'genia\n');
  assert.equal(run('agent-home', [d, 'set', 'cli', 'gemini']).status, 2);
  assert.equal(run('agent-home', [d, 'get', 'cli']).stdout, 'genia\n');
  // 대기열 라벨과 함께 저장해도 서로 지우지 않는다.
  run('agent-home', [d, 'set', 'queue', 'AI 개발팀']);
  assert.equal(run('agent-home', [d, 'get', 'cli']).stdout, 'genia\n');
  assert.equal(run('agent-home', [d, 'get', 'queue']).stdout, 'AI 개발팀\n');
});

test('agent-home: 모르는 이름·줄바꿈·큰따옴표 든 값·없는 폴더·모르는 명령은 2', () => {
  const d = aiDir();
  assert.equal(run('agent-home', [d, 'get', 'operator']).status, 2);
  assert.equal(run('agent-home', [d, 'set', 'queue', 'a\nb']).status, 2);
  assert.equal(run('agent-home', [d, 'set', 'queue', 'AI "개발"']).status, 2); // work-loop 인자(--queue "…")로 넘길 수 없다
  assert.equal(run('agent-home', [d, 'set', 'queue', 'AI팀\\']).status, 2);
  assert.equal(run('agent-home', [join(home, 'nope'), 'get', 'queue']).status, 2);
  mkdirSync(join(home, 'a b'));
  assert.equal(run('agent-home', [join(home, 'a b'), 'get', 'queue']).status, 2); // AI 이름이 될 수 없는 폴더 이름
  assert.equal(run('agent-home', [d, 'wipe']).status, 2);
});

test('agent-home due: 5분 구간마다 처음 하나만 0 — 칸 여럿이 함께 깨어나도 하나만 확인하고, 지난 구간 표시는 지운다', async () => {
  const d = aiDir();
  // AI 폴더가 비었으면(start-agent 로 띄운 칸이 아님) 조용히 1.
  const outside = run('agent-home', ['', 'due']);
  assert.deepEqual([outside.status, outside.stderr], [1, '']);
  mkdirSync(join(d, 'state', 'checked-1'), { recursive: true }); // 지난 구간
  const results = await Promise.all(Array.from({ length: 6 }, () => runAsync('agent-home', [d, 'due'])));
  assert.deepEqual(results.map((r) => r.status).sort(), [0, 1, 1, 1, 1, 1]);
  assert.equal(run('agent-home', [d, 'due']).status, 1);
  assert.deepEqual(readdirSync(join(d, 'state')).filter((f) => f.startsWith('checked-')), [`checked-${Math.floor(Date.now() / 1000 / 300)}`]);
});

tmuxTest('agent-home missing: 받은 키 중 칸이 없는 키만 낸다 — 예전 구성의 프로젝트 창도 칸으로 본다', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  const missing = (...keys) => run('agent-home', [d, 'missing', ...keys], { env: { GW_TMUX: wrapper } });
  assert.equal(missing('WP').status, 3); // AI 의 tmux 세션이 없다.
  tmux('new-session', '-d', '-s', 'kodi', '-n', 'home', 'sleep', '60');
  tmux('new-window', '-d', '-t', '=kodi:', '-n', 'OPS', 'sleep', '60');
  agentWindow(wrapper, ['--restart', 'kodi', 'WP', home, 'sleep', '60']);
  assert.equal(missing('WP', 'HR', 'OPS').stdout, 'HR\n');
  assert.equal(missing('WP', 'HR', 'OPS').stdout, 'HR\n'); // 띄울 때까지 매번 낸다.
  agentWindow(wrapper, ['kodi', 'HR', home, 'sleep', '60']);
  assert.equal(missing('WP', 'HR', 'OPS').stdout, '');
  // 키로 쓸 수 없는 값은 매번 내지 않고 건너뛴다.
  assert.equal(missing('WP', 'a b').stdout, '');
});

// ---------------------------------------------------------------- agent-project — 저장소 준비·칸 띄우기 (WP-1053)

const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** 원격 저장소(bare) — main 에 .work-loop/project.md, dev 브랜치가 있다. 주소(경로)를 돌려준다. */
function remoteRepo(name = 'remote.git') {
  const src = join(home, `${name}-src`);
  git('init', '-q', src);
  mkdirSync(join(src, '.work-loop'));
  writeFileSync(join(src, '.work-loop', 'project.md'), '# 안내\n');
  git('-C', src, 'add', '.');
  git('-C', src, 'commit', '-qm', 'init');
  git('-C', src, 'branch', 'dev');
  const bare = join(home, name);
  git('clone', '-q', '--bare', src, bare);
  return bare;
}

test('agent-project repo: 없으면 clone(기본 브랜치로), 있으면 fetch — 바뀐 것 없는 clone 만 새 기본 브랜치로 옮긴다', () => {
  const d = aiDir();
  const url = remoteRepo();
  const repo = (...a) => run('agent-project', ['repo', d, 'WP', url, ...a]);
  const first = repo('dev');
  assert.deepEqual([first.status, first.stdout], [0, 'cloned\n']);
  assert.equal(git('-C', join(d, 'repos', 'WP'), 'branch', '--show-current'), 'dev');
  assert.equal(repo('dev').stdout, 'fetched\n');
  assert.equal(repo('main').stdout, 'fetched\nbranch-switched main\n');
  writeFileSync(join(d, 'repos', 'WP', 'wip.txt'), 'x');
  assert.equal(repo('dev').stdout, 'fetched\nbranch-kept dev\n');
});

test('agent-project repo: 폴더 주소가 설정과 다르면 건드리지 않고 url-changed(5), clone 실패는 clone-failed(4), 안내 파일이 없으면 알린다', () => {
  const d = aiDir();
  const url = remoteRepo();
  run('agent-project', ['repo', d, 'WP', url]);
  const other = remoteRepo('other.git');
  const changed = run('agent-project', ['repo', d, 'WP', other]);
  assert.deepEqual([changed.status, changed.stdout], [5, 'url-changed\n']);
  const failed = run('agent-project', ['repo', d, 'HR', join(home, 'nope.git')]);
  assert.deepEqual([failed.status, failed.stdout], [4, 'clone-failed\n']);
  assert.equal(existsSync(join(d, 'repos', 'HR')), false);
  const src = join(home, 'remote.git-src');
  git('-C', src, 'rm', '-rq', '.work-loop');
  git('-C', src, 'commit', '-qm', 'no guide');
  const bare = join(home, 'plain.git');
  git('clone', '-q', '--bare', src, bare);
  assert.equal(run('agent-project', ['repo', d, 'OPS', bare]).stdout, 'cloned\nno-project-md\n');
  assert.equal(run('agent-project', ['repo', d, 'WP', '']).status, 2);
  assert.equal(run('agent-project', ['repo', d, '../x', url]).status, 2);
  // AI 이름이 될 수 없는 폴더(me 는 「내 토큰」 예약어)는 받지 않는다.
  mkdirSync(join(home, 'agents', 'me'));
  assert.equal(run('agent-project', ['repo', join(home, 'agents', 'me'), 'WP', url]).status, 2);
  // 같은 키를 살아 있는 다른 쪽이 잡고 있으면 busy(6) — 잡은 쪽이 끝났으면(또는 주인을 적기 전에 죽은 지 1분이 넘었으면) 넘겨받는다.
  const lock = join(d, 'state', 'launch-WP.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), `${process.pid}\n`);
  const busy = run('agent-project', ['repo', d, 'WP', url]);
  assert.deepEqual([busy.status, busy.stdout], [6, 'busy\n']);
  writeFileSync(join(lock, 'owner'), '999999\n');
  assert.equal(run('agent-project', ['repo', d, 'WP', url]).stdout, 'fetched\n');
  mkdirSync(lock);
  assert.equal(run('agent-project', ['repo', d, 'WP', url]).status, 6); // 주인을 아직 적지 않은 잠금
  const old = Date.now() / 1000 - 2 * 60;
  utimesSync(lock, old, old);
  assert.equal(run('agent-project', ['repo', d, 'WP', url]).stdout, 'fetched\n');
  assert.equal(existsSync(lock), false);
  // 반쯤 받다 끊긴 clone 은 임시 폴더에만 남는다 — 제자리 폴더가 생기지 않는다.
  assert.deepEqual(readdirSync(join(d, 'repos')).filter((f) => f.includes('.clone.')), []);
});

tmuxTest('agent-project add: 새 프로젝트를 clone 해 칸으로 띄우고, 실패는 이유를 기록해 1시간 동안 다시 하지 않으며, 띄우면 기록을 지운다', (t) => {
  const { wrapper } = tmuxServer(t);
  const d = aiDir();
  const url = remoteRepo();
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec sleep 60\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const add = (...a) => run('agent-project', ['add', d, ...a], { env: { GW_TMUX: wrapper } });

  const bad = add('HR', join(home, 'nope.git'));
  assert.deepEqual([bad.status, bad.stdout], [1, 'clone-failed\n']);
  assert.equal(run('agent-project', ['failures', d]).stdout, 'HR clone-failed\n');
  const backoff = add('HR', url);
  assert.deepEqual([backoff.status, backoff.stdout], [7, 'backoff\n']);

  const ok = add('WP', url);
  assert.deepEqual([ok.status, ok.stdout], [0, 'cloned\nstarted kodi\n']);
  assert.equal(add('WP', url).stdout, 'fetched\nexists kodi\n');
  // 1시간이 지나면 다시 해 보고, 띄우면 그 키의 실패 기록을 지운다.
  const old = Date.now() / 1000 - 61 * 60;
  utimesSync(join(d, 'state', 'launch-failed-HR'), old, old);
  assert.equal(add('HR', url).stdout, 'cloned\nstarted kodi\n');
  assert.equal(run('agent-project', ['failures', d]).stdout, '');
  assert.equal(readdirSync(join(d, 'state')).filter((f) => f.endsWith('.lock')).length, 0);
});

test('agent-project locate: 처음 홈은 new 로 확인받아 --set 으로 기억하고, 다른 폴더에서 불러도 그 홈을 쓴다 — 그 AI 폴더가 사라지면 다시 new', () => {
  mkdirSync(join(home, 'agents'), { recursive: true });
  mkdirSync(join(home, 'elsewhere'));
  // 경로는 실제 경로로 낸다(macOS 의 /var → /private/var).
  const first = realpathSync(join(home, 'agents'));
  const other = realpathSync(join(home, 'elsewhere'));
  const locate = (cur, ...a) => run('agent-project', ['locate', 'kodi', cur, ...a], { env: { GW_TMUX: '/nonexistent/tmux' } });
  // 기억도 칸도 없으면 확인을 받는다 — 재부팅 뒤 엉뚱한 폴더에서 부른 경우를 걸러 내려는 것.
  assert.equal(locate(first).stdout, `new ${first}\n`);
  assert.equal(locate(first, '--set').stdout, `here ${first}\n`);
  mkdirSync(join(first, 'kodi'));
  assert.equal(locate(first).stdout, `here ${first}\n`);
  assert.equal(locate(other).stdout, `elsewhere ${first}\n`);
  // 그 AI 폴더가 지금 폴더 아래 있으면(기억이 없어도) 그 폴더다.
  rmSync(join(first, 'kodi'), { recursive: true });
  assert.equal(locate(other).stdout, `new ${other}\n`);
  mkdirSync(join(other, 'kodi'));
  assert.equal(locate(other).stdout, `here ${other}\n`);
  assert.equal(locate(first).stdout, `elsewhere ${other}\n`);
  assert.equal(run('agent-project', ['locate', 'me', other]).status, 2);
  assert.equal(run('agent-project', ['locate', 'kodi', join(home, 'nope')]).status, 2);
});

tmuxTest('agent-project locate: 기억이 없으면(0.1.22 이하로 띄움) 돌고 있는 칸의 폴더에서 홈을 찾고, 여러 홈이면 ambiguous 로 고르게 한다', (t) => {
  const { wrapper } = tmuxServer(t);
  const first = join(home, 'agents');
  const worktree = join(first, 'kodi', 'repos', 'WP', '.claude', 'worktrees', 'WP-1');
  mkdirSync(worktree, { recursive: true });
  agentWindow(wrapper, ['kodi', 'WP', worktree, 'sleep', '60']);
  const locate = () => run('agent-project', ['locate', 'kodi', home], { env: { GW_TMUX: wrapper } });
  assert.equal(locate().stdout, `elsewhere ${realpathSync(first)}\n`);

  // 홈이 바뀌던 결함으로 두 홈에서 칸이 돌면 짐작하지 않는다.
  rmSync(join(home, '.genia-works', 'agents'), { recursive: true });
  const second = join(home, 'x.y');
  mkdirSync(join(second, 'kodi', 'repos', 'HR'), { recursive: true });
  agentWindow(wrapper, ['kodi', 'HR', join(second, 'kodi', 'repos', 'HR'), 'sleep', '60']);
  const r = locate();
  assert.equal(r.status, 3);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['ambiguous', ...[realpathSync(first), realpathSync(second)].sort()]);
});

tmuxTest('agent-project start: 그 AI 신원·AI 폴더·자동 압축 40%·저장한 대기열 라벨·이 셸의 setup-token 으로 work-loop 를 칸에 띄운다', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  mkdirSync(join(d, 'repos', 'WP'), { recursive: true });
  run('agent-home', [d, 'set', 'queue', 'AI 개발팀']);
  // claude 대신 받은 환경·인자를 적는 가짜 — PATH 앞에 둔다.
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n{ pwd; env | grep -E "^(GENIA_WORKS_|CLAUDE_)" | sort; printf "%s\\n" "$@"; } > "$HOME/claude-args"\nexec sleep 60\n');
  chmodSync(join(bin, 'claude'), 0o755);
  // 셸에 CLAUDE_CODE_OAUTH_TOKEN 이 있으면(Pod — Secret 에서 받는다) 칸에도 그 토큰이 간다(WP-1334). tmux 서버는 이 호출이 처음 띄운다 — 서버 환경으로 새면
  // 사람의 다른 tmux 창과 토큰 없이 다시 띄운 칸에도 토큰이 남으므로, 아래에서 서버 환경·칸 명령에 원문이 없는지도 본다.
  const r = run('agent-project', ['start', d, 'WP'], {
    env: { GW_TMUX: wrapper, GENIA_WORKS_API_URL: 'http://127.0.0.1:6160/api/v1', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' },
  });
  assert.deepEqual([r.status, r.stdout], [0, 'started kodi\n']);
  const out = join(home, 'claude-args');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('/loop'));
  assert.equal(readFileSync(out, 'utf8'), [
    join(realpathSync(d), 'repos', 'WP'),
    'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=40',
    'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test',
    `GENIA_WORKS_AGENT_DIR=${realpathSync(d)}`,
    'GENIA_WORKS_API_URL=http://127.0.0.1:6160/api/v1',
    'GENIA_WORKS_AS=kodi',
    'GENIA_WORKS_PANE_WAKES=1',
    'GENIA_WORKS_UNATTENDED=1',
    '--permission-mode',
    'bypassPermissions',
    '/loop /genia-works:work-loop WP --queue "AI 개발팀"',
    '',
  ].join('\n'));
  // 토큰은 홈 아래 권한 600 파일로만 건넨다 — tmux 서버 환경·칸 시작 명령에는 원문이 없다.
  const tokfile = join(home, '.genia-works', 'agents', 'kodi', 'claude-token');
  assert.equal(readFileSync(tokfile, 'utf8'), 'sk-ant-oat01-test\n');
  assert.equal(statSync(tokfile).mode & 0o777, 0o600);
  assert.ok(!tmux('show-environment', '-g').includes('sk-ant-oat01-test'));
  assert.ok(!tmux('list-panes', '-a', '-F', '#{pane_start_command}').includes('sk-ant-oat01-test'));
  // 알림 감시 창(events)은 따로 있다 — 프로젝트 칸만 센다.
  assert.deepEqual(panes(tmux, 'kodi').filter((p) => p.win !== 'events').map((p) => p.key), ['WP']);
  assert.equal(run('agent-project', ['login', d]).stdout, 'setup-token\n');
  // 토큰 없는 셸의 --restart 가 아닌 start(알림 감시 창의 add·상태만 보는 start)는 기억한 토큰을 지우지 않는다 —
  // 그 AI 의 새 칸도 기억한 토큰으로 뜬다.
  assert.equal(run('agent-project', ['start', d, 'WP'], { env: { GW_TMUX: wrapper } }).stdout, 'exists kodi\n');
  mkdirSync(join(d, 'repos', 'HR'), { recursive: true });
  rmSync(out);
  assert.equal(run('agent-project', ['start', d, 'HR'], { env: { GW_TMUX: wrapper } }).stdout, 'started kodi\n');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('/loop'));
  assert.ok(readFileSync(out, 'utf8').includes('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test\n'));
  assert.equal(readFileSync(tokfile, 'utf8'), 'sk-ant-oat01-test\n');
  // 토큰 없는 셸의 --restart 도 기억한 토큰을 지우지 않는다 — 사람의 홈 claude 안에서는 늘 토큰 없이 불리므로(claude 가 넘기지 않는다)
  // 지우면 패널로 넣은 토큰이 사라진다. 지우는 것은 gw-claude-token clear(패널의 「이 컴퓨터 로그인」)뿐이다.
  rmSync(out);
  assert.equal(run('agent-project', ['start', '--restart', d, 'WP'], { env: { GW_TMUX: wrapper } }).stdout, 'restarted kodi\n');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('/loop'));
  assert.ok(readFileSync(out, 'utf8').includes('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test\n'));
  assert.equal(run('gw-claude-token', ['clear', 'kodi']).status, 0);
  assert.equal(run('agent-project', ['login', d]).stdout, 'local\n');
  rmSync(out);
  assert.equal(run('agent-project', ['start', '--restart', d, 'WP'], { env: { GW_TMUX: wrapper } }).stdout, 'restarted kodi\n');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('/loop'));
  assert.ok(!readFileSync(out, 'utf8').includes('CLAUDE_CODE_OAUTH_TOKEN'));
  // 패널(gw-claude-token set)로 넣은 토큰을 토큰 없는 셸의 --restart 가 칸에 넣는다.
  assert.equal(run('gw-claude-token', ['set', 'kodi'], { input: 'sk-ant-oat01-panelPPPPPPPPPPPPPPPPPP\n' }).status, 0);
  rmSync(out);
  assert.equal(run('agent-project', ['start', '--restart', d, 'WP'], { env: { GW_TMUX: wrapper } }).stdout, 'restarted kodi\n');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('/loop'));
  assert.ok(readFileSync(out, 'utf8').includes('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-panelPPPPPPPPPPPPPPPPPP\n'));
  assert.equal(run('agent-project', ['start', d, 'QA'], { env: { GW_TMUX: wrapper } }).status, 2); // 저장소 폴더가 없다
});

test('gw-claude-token: set 은 setup-token 모양만 권한 600 으로 적고, status·clear 는 원문을 내지 않는다 (WP-1337)', () => {
  const tokfile = join(home, '.genia-works', 'agents', 'kodi', 'claude-token');
  assert.equal(run('gw-claude-token', ['status', 'kodi']).stdout, 'local\n');
  for (const bad of ['ak_' + 'x'.repeat(40), 'sk-ant-api03-abc', 'sk-ant-oat01-a b', 'sk-ant-oat01-short', '']) {
    const r = run('gw-claude-token', ['set', 'kodi'], { input: bad + '\n' });
    assert.equal(r.status, 3, bad);
    if (bad) assert.ok(!r.stderr.includes(bad), bad);
  }
  assert.ok(!existsSync(tokfile));
  const ok = run('gw-claude-token', ['set', 'kodi'], { input: 'sk-ant-oat01-Ab_9-zAAAAAAAAAAAAAAAA\n' });
  assert.deepEqual([ok.status, ok.stdout, ok.stderr], [0, '', '']);
  assert.equal(readFileSync(tokfile, 'utf8'), 'sk-ant-oat01-Ab_9-zAAAAAAAAAAAAAAAA\n');
  assert.equal(statSync(tokfile).mode & 0o777, 0o600);
  assert.equal(run('gw-claude-token', ['status', 'kodi']).stdout, 'setup-token\n');
  assert.equal(run('gw-claude-token', ['clear', 'kodi']).status, 0);
  assert.ok(!existsSync(tokfile));
  assert.equal(run('gw-claude-token', ['set', '../x'], { input: 'sk-ant-oat01-a\n' }).status, 2);
});

test('agent-project cli: 저장한 실행기를 읽기만 하고 홈을 기억하지 않으며, 모르거나 목록 밖이면 claude (WP-1337)', () => {
  const d = aiDir();
  const homeDir = join(d, '..');
  assert.equal(run('agent-project', ['cli', 'kodi', homeDir]).stdout, 'claude\n');
  run('agent-home', [d, 'set', 'cli', 'genia']);
  assert.equal(run('agent-project', ['cli', 'kodi', homeDir]).stdout, 'genia\n');
  assert.equal(run('agent-project', ['cli', 'kodi', '/nonexistent']).stdout, 'claude\n');
  writeFileSync(join(d, 'agent.conf'), 'cli=claud\n');
  assert.equal(run('agent-project', ['cli', 'kodi', homeDir]).stdout, 'claude\n');
  assert.ok(!existsSync(join(home, '.genia-works', 'agents', 'kodi', 'home'))); // locate 와 달리 홈을 기억하지 않는다
  assert.equal(run('agent-project', ['cli', 'nobody', homeDir]).stdout, 'claude\n');
});

test('gw-claude-run: 토큰 파일이 있으면 그 setup-token 으로(API 키는 비움), 없으면 물려받은 토큰도 지워 로컬 로그인으로 띄운다 (WP-1334)', () => {
  const tokfile = join(home, 'claude-token-test');
  const show = ['sh', '-c', 'echo "oauth=${CLAUDE_CODE_OAUTH_TOKEN-unset} api=${ANTHROPIC_API_KEY-unset} auth=${ANTHROPIC_AUTH_TOKEN-unset}"'];
  writeFileSync(tokfile, 'sk-ant-oat01-file');
  const withFile = run('gw-claude-run', [tokfile, ...show], { env: { ANTHROPIC_API_KEY: 'sk-ant-api', ANTHROPIC_AUTH_TOKEN: 'x' } });
  assert.equal(withFile.stdout, 'oauth=sk-ant-oat01-file api=unset auth=unset\n');
  rmSync(tokfile);
  // tmux 서버가 토큰 있는 셸에서 떠 물려준 값이어도 파일이 없으면 쓰지 않는다. API 키는 사람이 둔 대로 둔다.
  const noFile = run('gw-claude-run', [tokfile, ...show], {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'stale', ANTHROPIC_API_KEY: 'sk-ant-api' },
  });
  assert.equal(noFile.stdout, 'oauth=unset api=sk-ant-api auth=unset\n');
});

tmuxTest('agent-project start: 실행기가 genia 면 genia 인증서·「깨우기는 실행기가」 표시와 함께 /gw-loop 를 띄운다(WP-1292)', async (t) => {
  const { wrapper } = tmuxServer(t);
  const d = aiDir();
  mkdirSync(join(d, 'repos', 'WP'), { recursive: true });
  run('agent-home', [d, 'set', 'cli', 'genia']);
  run('agent-home', [d, 'set', 'queue', 'AI 개발팀']);
  const crt = join(home, 'genia-root.crt');
  writeFileSync(crt, 'x');
  // genia 대신 받은 환경·인자를 적는 가짜 — PATH 앞에 둔다. 이 셸의 NODE_EXTRA_CA_CERTS 가 다른 값이어도 genia 인증서로 바뀌어야 한다.
  writeFileSync(join(bin, 'genia'), '#!/bin/sh\n{ env | grep -E "^(GENIA_WORKS_RUNNER|NODE_EXTRA|CLAUDE_AUTOCOMPACT)" | sort; printf "%s\\n" "$@"; } > "$HOME/genia-args"\nexec sleep 60\n');
  chmodSync(join(bin, 'genia'), 0o755);
  const r = run('agent-project', ['start', d, 'WP'], { env: { GW_TMUX: wrapper, GENIA_CA_CERT: crt, NODE_EXTRA_CA_CERTS: '/elsewhere.pem' } });
  assert.deepEqual([r.status, r.stdout], [0, 'started kodi\n']);
  const out = join(home, 'genia-args');
  await until(() => existsSync(out) && readFileSync(out, 'utf8').includes('/gw-loop'));
  assert.equal(readFileSync(out, 'utf8'), [
    'GENIA_WORKS_RUNNER_WAKES=1',
    `NODE_EXTRA_CA_CERTS=${crt}`,
    '--approve',
    '-e',
    join(scripts, '..'),
    '/gw-loop WP --queue "AI 개발팀"',
    '',
  ].join('\n'));
});

// ---------------------------------------------------------------- gw-plugin-version (WP-1053)

const installedVersion = () => JSON.parse(readFileSync(join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
const marketplace = (v) => `{"plugins":[{"name":"genia-works","source":{"ref":"genia-works--v${v}"}}]}`;

test('gw-plugin-version: Claude 가 받은 마켓플레이스 주소에서 최신을 읽어, 더 높을 때만 update', async () => {
  const installed = installedVersion();
  const srv = await fakeProjectServer({ body: marketplace('9.8.7') });
  try {
    // 마켓플레이스는 웹이 내는 정적 파일 — API 주소(GENIA_WORKS_API_URL)가 아니라 Claude 가 받은 주소를 쓴다.
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    const origin = srv.url.replace('/api/v1', '');
    writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({
      other: { source: { source: 'url', url: 'http://127.0.0.1:9/other.json' }, installLocation: '/x' },
      'genia-works': { source: { source: 'url', url: `${origin}/web/claude/marketplace.json` }, installLocation: '/y' },
    }, null, 2));
    const r = await runAsync('gw-plugin-version', [], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
    assert.equal(r.stdout, `${installed} 9.8.7 update\n`);
    assert.deepEqual(srv.reqs.map((q) => q.url), ['/web/claude/marketplace.json']);
  } finally {
    srv.close();
  }
});

test('gw-plugin-version: 마켓플레이스 기록이 없으면 API 주소의 호스트에서 읽고, 설치된 것이 같거나 더 높으면 ok, 닿지 못하면 ? unknown', async () => {
  const installed = installedVersion();
  for (const [latest, verdict] of [[installed, 'ok'], ['0.0.9', 'ok'], ['0.1.100', 'update']]) {
    const srv = await fakeProjectServer({ body: marketplace(latest) });
    try {
      const r = await runAsync('gw-plugin-version', [], { GENIA_WORKS_API_URL: srv.url });
      assert.equal(r.stdout, `${installed} ${latest} ${verdict}\n`);
      assert.deepEqual(srv.reqs.map((q) => q.url), ['/claude/marketplace.json']);
    } finally {
      srv.close();
    }
  }
  const down = await runAsync('gw-plugin-version', [], { GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(down.stdout, `${installed} ? unknown\n`);
});

// ---------------------------------------------------------------- gw-status·워크스페이스 헤더 (WP-1250)

test('gw-headers: GENIA_WORKS_TENANT 가 있으면 X-On-Behalf-Of-Tenant 를 함께 낸다 — 숫자가 아니면 빼고, 내 토큰({})에는 붙이지 않는다', () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_ABC123\n' });
  const r = run('gw-headers', [], { env: { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_TENANT: '7' } });
  assert.deepEqual(JSON.parse(r.stdout), { Authorization: 'Bearer ak_FAKE_ABC123', 'X-On-Behalf-Of-Tenant': '7' });
  const bad = run('gw-headers', [], { env: { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_TENANT: '7"x' } });
  assert.deepEqual(JSON.parse(bad.stdout), { Authorization: 'Bearer ak_FAKE_ABC123' });
  assert.equal(run('gw-headers', [], { env: { GENIA_WORKS_TENANT: '7' } }).stdout.trim(), '{}');
});

/** 가짜 상태 보고 서버 — status 와 body 를 내고, 받은 요청(메서드·주소·헤더·본문)을 모은다. */
async function fakeStatusServer({ status = 200, body = '{"desired":"RUN"}' } = {}) {
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

test('gw-status: GENIA_AGENT_GENERATION 이 없으면(Works 가 띄운 AI 아님) 서버에 묻지 않고 RUN', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeStatusServer({ body: '{"desired":"DRAIN"}' });
  try {
    const r = await runAsync('gw-status', ['IDLE'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'RUN\n');
    assert.equal(srv.reqs.length, 0);
  } finally {
    srv.close();
  }
});

test('gw-status: generation 이 있으면 AI 키·워크스페이스 헤더로 PUT 하고 받은 동작을 낸다 — 키는 내지 않는다', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeStatusServer({ body: '{"desired":"DRAIN"}' });
  const env = { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url, GENIA_AGENT_GENERATION: '7', GENIA_WORKS_TENANT: '3' };
  try {
    const r = await runAsync('gw-status', ['WORKING', 'WD-12'], env);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'DRAIN\n');
    assert.doesNotMatch(r.stdout + r.stderr, /ak_FAKE_DEV/);
    const [q] = srv.reqs;
    assert.equal(q.method, 'PUT');
    assert.equal(q.url, '/api/v1/agent-runtime/me/status');
    assert.equal(q.headers.authorization, 'Bearer ak_FAKE_DEV');
    assert.equal(q.headers['x-on-behalf-of-tenant'], '3');
    assert.deepEqual(JSON.parse(q.body), { state: 'WORKING', generation: 7, issueKey: 'WD-12' });

    // 쉬는 중 — 빈 이슈 키는 빼고 다음 확인 시각을 싣는다. 워크스페이스가 없으면 헤더도 없다.
    const idle = await runAsync('gw-status', ['IDLE', '', '2026-11-01T12:00:00+09:00'], { ...env, GENIA_WORKS_TENANT: '' });
    assert.equal(idle.stdout, 'DRAIN\n');
    assert.deepEqual(JSON.parse(srv.reqs[1].body), { state: 'IDLE', generation: 7, nextCheckAt: '2026-11-01T12:00:00+09:00' });
    assert.equal(srv.reqs[1].headers['x-on-behalf-of-tenant'], undefined);
  } finally {
    srv.close();
  }
});

test('gw-status: 보고가 실패해도(서버 오류·닿지 못함·이상한 응답·잘못된 인자·키 없음) RUN 을 내고 종료 0', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const env = { GENIA_WORKS_AS: 'ai-dev', GENIA_AGENT_GENERATION: '7' };
  for (const [status, body] of [[500, '{}'], [200, '{"desired":"EXPLODE"}'], [401, '{}']]) {
    const srv = await fakeStatusServer({ status, body });
    try {
      const r = await runAsync('gw-status', ['IDLE'], { ...env, GENIA_WORKS_API_URL: srv.url });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, 'RUN\n');
      assert.match(r.stderr, /^gw-status: /);
    } finally {
      srv.close();
    }
  }
  const down = await runAsync('gw-status', ['IDLE'], { ...env, GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.deepEqual([down.status, down.stdout], [0, 'RUN\n']);
  for (const args of [['SLEEPING'], ['WORKING', 'WD 1'], ['IDLE', '', 'tomorrow"']]) {
    const r = await runAsync('gw-status', args, { ...env, GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
    assert.deepEqual([r.status, r.stdout], [0, 'RUN\n']);
  }
  const noKey = await runAsync('gw-status', ['IDLE'], { GENIA_AGENT_GENERATION: '7', GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.deepEqual([noKey.status, noKey.stdout], [0, 'RUN\n']);
});

// ---------------------------------------------------------------- 상시 알림 감시 — agent-events·gw-events --all/--lock (WP-1252)
// 「연결됨」은 AI 의 알림 SSE 가 지금 열려 있는지로 정해진다 — AI 마다 tmux 창(events) 하나가 SSE 를 들고 wake 줄을
// <AI 폴더>/state/events.log 에 쓰고, work-loop 칸의 Monitor 는 agent-events tail 로 그 파일만 따라간다.

/**
 * 연결마다 다른 알림을 내는 가짜 알림 서버 — rounds[i] 는 i 번째 연결에서 낼 알림 목록이고 그 뒤 연결을 끊는다.
 * rounds 를 다 쓴 뒤의 연결은 빈 채로 열어 둔다. /notifications/unread-count 는 200.
 */
async function fakeEventRounds(rounds) {
  let streams = 0;
  const server = createServer((req, res) => {
    if (req.url.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(':connected\n\n');
      const round = rounds[streams++];
      if (!round) return;
      for (const [name, data] of round) res.write(`event:${name}\ndata:${JSON.stringify(data)}\n\n`);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end('{"count":0}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, close };
}

const mention = (issueKey, type = 'ISSUE_CHAT_MENTION') => ['notify.created', { type, issueId: 1, issueKey, projectKey: issueKey.split('-')[0] }];

test('gwEvents_all_emitsEveryProject', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventRounds([[mention('HR-3', 'ASSIGNED'), ['notify.created', { type: 'REMINDER' }], mention('WP-12')]]);
  try {
    const r = await runEvents(['--all'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url }, 2500);
    assert.equal(r.out, 'wake HR-3 ASSIGNED\nwake WP-12 ISSUE_CHAT_MENTION\n');
    assert.equal(r.orphans, '');
  } finally {
    srv.close();
  }
});

test('gwEvents_all_keepsOnePendingLinePerProject', async () => {
  // 20초 안에 몰린 알림을 한 줄로 합치면 가운데 프로젝트(WP)의 알림이 빠져 그 칸이 깨지지 않는다 — 프로젝트마다 마지막 한 줄은 남긴다.
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventRounds([[mention('HR-3', 'ASSIGNED'), mention('WP-12'), mention('QA-1'), mention('WP-13', 'COMMENTED')]]);
  try {
    const r = await runEvents(['--all'], { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url }, 2500);
    assert.equal(r.out, 'wake HR-3 ASSIGNED\nwake QA-1 ISSUE_CHAT_MENTION\nwake WP-13 COMMENTED\n');
  } finally {
    srv.close();
  }
});

test('gwEvents_lockFile_secondInstanceExitsSilently', async () => {
  run('gw-keys', ['add', 'ai-dev'], { input: 'ak_FAKE_DEV\n' });
  const srv = await fakeEventRounds([]);
  const lock = join(home, 'agents', 'ai-dev', 'state', 'events.pid');
  // claude 조상이 없는(세션 키 없음) 실행 — 「하나만」은 잠금 파일로만 지킨다.
  const env = { GENIA_WORKS_AS: 'ai-dev', GENIA_WORKS_API_URL: srv.url, GW_START_PID: '1' };
  try {
    const first = runEvents(['--all', '--lock', lock], env, 3000, { inPs: true });
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(existsSync(lock));
    const second = await runEvents(['--all', '--lock', lock], env, 2000);
    assert.equal(second.code, 0);
    assert.equal(second.out, '');
    assert.equal((await first).code, null); // 첫 것은 끝까지 돌다가 테스트가 끝냈다.
    assert.equal(existsSync(lock), false); // 끝나면 자기 잠금을 지운다.
  } finally {
    srv.close();
  }
});

/**
 * agent-events 를 띄우고 during(지금까지의 출력을 읽는 함수)을 마친 뒤, done(출력)이 참이 될 때까지(늦어도 deadlineMs) 기다렸다가
 * SIGTERM 으로 끝낸다 — 고정 시간 대신 조건을 기다려 부하가 걸려도 결과가 같게 한다. 남은 자식이 없는지도 본다.
 */
async function runAgentEvents(args, env, { during, done, deadlineMs = 30000 }) {
  const p = spawn(join(scripts, 'agent-events'), args, {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table, GW_START_PID: '500', ...env },
  });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  const exited = new Promise((r) => p.on('exit', (code) => r(code)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (during) await during(() => out);
  for (const end = Date.now() + deadlineMs; Date.now() < end && !done(out); ) await sleep(100);
  p.kill('SIGTERM');
  await exited;
  await sleep(200);
  const orphans = spawnSync('pgrep', ['-P', String(p.pid)], { encoding: 'utf8' }).stdout.trim();
  return { out, orphans };
}

const eventWindows = (tmux) => panes(tmux, 'kodi').filter((p) => p.win === 'events');

tmuxTest('agentEvents_ensure_startsOnceUnderConcurrentCalls', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  const outs = await Promise.all(Array.from({ length: 3 }, () => runAsync('agent-events', ['ensure', d], { GW_TMUX: wrapper })));
  assert.deepEqual(outs.map((o) => o.stdout).sort(), ['exists\n', 'exists\n', 'started\n']);
  assert.equal(eventWindows(tmux).length, 1);
  assert.equal(eventWindows(tmux)[0].dead, false);
});

tmuxTest('agentEvents_ensure_revivesDeadWindow', async (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  assert.equal(run('agent-events', ['ensure', d], { env: { GW_TMUX: wrapper } }).stdout, 'started\n');
  const [before] = eventWindows(tmux);
  process.kill(Number(before.pid), 'SIGTERM');
  await until(() => eventWindows(tmux)[0]?.dead);
  assert.equal(run('agent-events', ['ensure', d], { env: { GW_TMUX: wrapper } }).stdout, 'revived\n');
  const [after] = eventWindows(tmux);
  assert.equal(after.id, before.id);
  assert.equal(after.dead, false);
  assert.equal(eventWindows(tmux).length, 1);
  // 쉬는 중(키가 없어 5분 대기)이어도 창이 닫히면(SIGHUP) 바로 끝난다 — 남아 있다가 감시를 하나 더 띄우지 않게.
  tmux('kill-server');
  const alive = () => spawnSync('pgrep', ['-f', `agent-events run ${d}`]).status === 0;
  await until(() => !alive());
});

test('agentEvents_ensure_noTmux', () => {
  const r = run('agent-events', ['ensure', aiDir()], { env: { GW_TMUX: '/nonexistent/tmux' } });
  assert.deepEqual([r.status, r.stdout], [3, 'no-tmux\n']);
  assert.equal(run('agent-events', ['ensure', join(home, 'nope')]).status, 2);
});

test('agentEvents_run_appendsWakeLinesAndReconnects', async () => {
  const d = aiDir();
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const srv = await fakeEventRounds([[mention('WP-1'), mention('WD-2')], [mention('WP-3')]]);
  try {
    // 끊긴 뒤 5초 쉬고 다시 붙는다 — 두 번 끊기므로 10초 남짓. 기대한 줄이 다 쌓일 때까지 기다린다.
    const logFile = join(d, 'state', 'events.log');
    const expected = 'wake WP-1 ISSUE_CHAT_MENTION\nwake WD-2 ISSUE_CHAT_MENTION\nwake - reconnect\nwake WP-3 ISSUE_CHAT_MENTION\n';
    const read = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
    // 칸이 없는 프로젝트를 여는 open(WP-1272)은 tmux 를 못 읽으면 아무것도 하지 않는다 — 사람의 tmux 를 건드리지 않게 없는 tmux 를 준다.
    const r = await runAgentEvents(['run', d], { GENIA_WORKS_API_URL: srv.url, GW_TMUX: '/nonexistent/tmux' }, { done: () => read().startsWith(expected) });
    assert.equal(r.out, '');
    assert.equal(r.orphans, '');
    const log = read();
    assert.ok(log.startsWith(expected), log);
    assert.ok(!log.includes('ak_FAKE_KODI'));
  } finally {
    srv.close();
  }
});

test('agentEvents_run_marksReconnectWhenWatcherRestarts', async () => {
  const d = aiDir();
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const srv = await fakeEventRounds([]); // 연결을 열어 둔 채 아무 알림도 보내지 않는다
  const logFile = join(d, 'state', 'events.log');
  const read = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  // 감시는 실제 경로(/private/var/… — 맥의 임시 폴더는 링크다)로 잠금 파일을 받으므로 폴더 이름 끝부분으로 찾는다.
  const watcher = () => spawnSync('pgrep', ['-f', `gw-events --all --lock .*${basename(dirname(d))}/kodi/state/events.pid`], { encoding: 'utf8' }).stdout.trim();
  try {
    // 다시 붙음은 쉬는 칸을 깨우려(poke, WP-1403) tmux 를 읽는다 — 사람의 tmux 를 건드리지 않게 없는 tmux 를 준다.
    const r = await runAgentEvents(['run', d], { GENIA_WORKS_API_URL: srv.url, GW_TMUX: '/nonexistent/tmux' }, {
      // 붙어 있던 gw-events 가 5초 넘게 돈 뒤 죽으면, 다시 띄우면서 칸들이 놓친 알림을 확인하도록 「다시 붙음」을 남긴다.
      during: async () => {
        await until(() => watcher() !== '');
        await new Promise((res) => setTimeout(res, 5500));
        for (const pid of watcher().split('\n')) process.kill(Number(pid), 'SIGTERM');
      },
      done: () => read().includes('wake - reconnect'),
    });
    assert.equal(read(), 'wake - reconnect\n');
    assert.equal(r.orphans, '');
  } finally {
    srv.close();
  }
});

// WP-1272 — 칸이 없는 프로젝트의 알림이 오면 정기 확인을 기다리지 않고 맡는 프로젝트를 다시 읽어 칸을 연다.
tmuxTest('agentEvents_open_startsPaneForAssignedProjectOnceAndSkipsUnassigned', async (t) => {
  if (!hasJq) return t.skip('jq 없음');
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  const url = remoteRepo();
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec sleep 60\n');
  chmodSync(join(bin, 'claude'), 0o755);
  // open 은 감시 창(events — 그 AI 의 tmux 세션)에서 불린다 — 세션이 있어야 칸이 없는지 안다.
  tmux('new-session', '-d', '-s', 'kodi', '-n', 'events', 'sleep', '60');
  const srv = await fakeProjectServer({ body: JSON.stringify([{ projectKey: 'WP', repositoryUrl: url }]) });
  const env = { GW_TMUX: wrapper, GENIA_WORKS_API_URL: srv.url };
  const open = (key) => runAsync('agent-events', ['open', d, key], env);
  const logFile = join(d, 'state', 'events.log');
  const read = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  try {
    // 같은 프로젝트 알림이 한꺼번에 와도 칸은 하나만 생긴다.
    const outs = await Promise.all([open('WP'), open('WP'), open('WP')]);
    assert.ok(outs.every((o) => o.status === 0));
    assert.equal(read().split('\n').filter((l) => l === 'open WP started').length, 1, read());
    assert.equal(panes(tmux, 'kodi').filter((p) => p.key === 'WP').length, 1);
    // 칸이 생긴 뒤의 알림은 서버에 묻지도 않는다.
    const asked = srv.reqs.length;
    await open('WP');
    assert.equal(srv.reqs.length, asked);
    assert.ok(srv.reqs.every((q) => q.url === '/api/v1/agent-runtime/me/projects' && q.auth === 'Bearer ak_FAKE_KODI'));

    // 맡는 프로젝트가 아니면 기록만 남기고, 10분 동안은 다시 묻지 않는다.
    await open('HR');
    assert.match(read(), /^open HR not-assigned$/m);
    const afterSkip = srv.reqs.length;
    await open('HR');
    assert.equal(srv.reqs.length, afterSkip);
    assert.equal(panes(tmux, 'kodi').filter((p) => p.key === 'HR').length, 0);
    assert.ok(!read().includes('ak_FAKE_KODI'));
    assert.equal(readdirSync(join(d, 'state')).filter((f) => f.startsWith('open-') && f.endsWith('.lock')).length, 0);
  } finally {
    srv.close();
  }
});

test('agentEvents_open_withoutTmuxDoesNothing', async () => {
  const d = aiDir();
  const r = await runAsync('agent-events', ['open', d, 'WP'], { GW_TMUX: '/nonexistent/tmux', GENIA_WORKS_API_URL: 'http://127.0.0.1:9/api/v1' });
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(d, 'state', 'events.log')), false);
  assert.equal(run('agent-events', ['open', d, 'bad key']).status, 2);
});

test('agentEvents_tail_filtersByProject', async () => {
  const d = aiDir();
  const log = join(d, 'state', 'events.log');
  mkdirSync(join(d, 'state'), { recursive: true });
  writeFileSync(log, 'wake WD-9 OLD\n'); // tail 을 걸기 전 줄은 내지 않는다.
  const r = await runAgentEvents(['tail', d, 'wd'], { GW_TMUX: '/nonexistent/tmux' }, {
    // tail 이 파일을 열었는지 알 수 없으니 표시 줄이 나올 때까지 덧붙인 뒤 진짜 줄을 쓴다.
    during: async (out) => {
      for (let i = 0; i < 100 && !out().includes('READY'); i++) {
        appendFileSync(log, 'wake WD-0 READY\n');
        await new Promise((res) => setTimeout(res, 100));
      }
      appendFileSync(log, 'wake WD-1 ASSIGNED\nwake WP-2 COMMENTED\nwake WDX-3 COMMENTED\ngw-events: 인증 실패(HTTP 401)\nwake - reconnect\n');
    },
    done: (out) => out.includes('reconnect'),
  });
  assert.equal(r.out.replaceAll('wake WD-0 READY\n', ''), 'wake WD-1 ASSIGNED\nwake - reconnect\n');
  assert.ok(!r.out.includes('OLD'));
  assert.equal(r.orphans, '');
});

// ---------------------------------------------------------------- agent-events poke — 쉬는 Claude Code 칸 깨우기 (WP-1403)
// 칸의 모델이 Monitor 걸기를 건너뛰면 wake 줄이 칸에 닿지 않는다 — 감시 창이 쉬는 칸에 /loop 를 직접 넣는다.
// 가짜 칸은 Claude Code v2.1 의 실제 화면 모양(입력 상자 = 위아래 ─ 줄 사이의 「❯ + U+00A0」 줄, 안내문·제안은 흐린 글자, 일하는 중은 상자 위
// 「✻ 동사… (8s · ↓ 81 tokens)」·「✳ 동사…」 줄)을 그대로 찍고, 받은 입력 줄을 파일에 적는다.
const RULE = '─'.repeat(40);
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const INV = (s) => `\x1b[7m${s}\x1b[27m`; // ink 의 가짜 커서 — 반전된 한 칸
const P = '\x1b[39m❯\u00a0'; // 입력 상자의 프롬프트 — 실제 화면처럼 줄바꿈 없는 공백(U+00A0)이 붙는다
/** 칸 화면 — above 는 입력 상자 위 줄들, box 는 상자 안 줄들, footer 는 상자 아래 상태 줄. 앞에 지난 지시(❯ 로 시작하는 기록 줄)를 둔다. */
const screen = (above, box, footer = '  ⏵⏵ bypass permissions on (shift+tab to cycle)') =>
  [`\x1b[38;5;246m\x1b[48;5;237m❯\u00a0\x1b[38;5;231m이전 지시\x1b[39m`, '⏺ ok', ...above, RULE, ...box, RULE, footer].join('\n');
const IDLE = screen(['✻ Baked for 26s · done 2:19 PM'], [`${P}${DIM('Try "fix lint errors"')}`]);
const LOOP = '/loop /genia-works:work-loop WP --queue "AI 개발팀"';

/** 그 키의 가짜 칸을 띄운다 — 화면을 찍고 받은 입력을 <home>/typed-<키> 에 적는다. 화면이 보일 때까지 기다린다. */
// later 를 주면 처음 화면(text)을 찍고 기다리다가 finish() 를 부르면 화면을 지우고 later 를 찍는다(일하던 칸이 쉬게 되는 것).
// 그 전에 들어온 입력도 tty 에 쌓였다가 cat 이 읽으므로, 일하는 동안 잘못 넣었으면 typed 에 남는다.
async function fakeClaudePane(wrapper, tmux, key, text, later) {
  const typed = join(home, `typed-${key}`);
  const go = join(home, `go-${key}`);
  const script = later === undefined
    ? 'printf "%s" "$1"; exec cat > "$2"'
    : 'printf "%s" "$1"; while [ ! -f "$3" ]; do sleep 0.1; done; printf "\\033[2J\\033[H%s" "$4"; exec cat > "$2"';
  const r = agentWindow(wrapper, ['kodi', key, home, 'sh', '-c', script, 'sh', text, typed, go, later ?? '']);
  assert.equal(r.status, 0, r.stderr);
  const id = panes(tmux, 'kodi').find((p) => p.key === key).id;
  await until(() => tmux('capture-pane', '-p', '-t', id).includes('bypass permissions'));
  return { typed: () => (existsSync(typed) ? readFileSync(typed, 'utf8') : ''), finish: () => writeFileSync(go, '') };
}

// 다시 보기(WP-1403)는 테스트마다 정한다 — 기본은 기다리지 않고(MAX 0) 바로 판정한다.
// 막 뜬 칸 보호(WP-1403)도 테스트마다 정한다 — 기본은 끈다(FRESH 0).
function pokeSetup(t, { cli = 'claude', retrySec = '1', retryMax = '0', freshSec = '0' } = {}) {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  run('agent-home', [d, 'set', 'queue', 'AI 개발팀']);
  run('agent-home', [d, 'set', 'cli', cli]);
  const logFile = join(d, 'state', 'events.log');
  const log = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  const poke = (key) => runAsync('agent-events', ['poke', d, key], {
    GW_TMUX: wrapper, GW_POKE_RETRY_SEC: retrySec, GW_POKE_RETRY_MAX: retryMax, GW_POKE_FRESH_SEC: freshSec,
  });
  return { wrapper, tmux, d, log, poke };
}

const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

tmuxTest('agentEvents_poke_sendsLoopToIdleClaudePane', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t);
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  const r = await poke('WP');
  assert.equal(r.status, 0, r.stderr);
  await until(() => wp.typed().includes('\n'));
  assert.equal(wp.typed(), `${LOOP}\n`);
  assert.match(log(), /^poke WP sent$/m);
});

tmuxTest('agentEvents_poke_skipsBusyPane', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t);
  // v2.1 의 일하는 중 표시(도구 실행·훅)와 예전 판의 「esc to interrupt」 — 입력 줄이 비어 있어도 넣지 않는다.
  const busy = {
    WP: screen(['✻ Effecting… (8s · ↓ 81 tokens)'], [P]),
    HR: screen(['⏺ Bash(sleep 8)', '  ⎿  Running…', '✽ Effecting… (running PreToolUse hooks… 1/2 · 6s · ↓ 14 tokens)'], [P]),
    QA: screen(['✳ Wrangling…'], [P]),
    // 할 일 목록이 길면 스피너 줄이 상자에서 멀다 — 마지막 출력(⏺) 아래 전체를 본다
    // 턴은 끝났지만 뒤에서 돌리는 셸이 남아 있다 — 끝나면 그 알림으로 이어 가므로 새 /loop 를 넣지 않는다
    BG: screen(['⏺ started', '✻ Brewed for 9s · done 2:49 PM · 1 shell still running'], [P], '  ⏵⏵ bypass permissions on · 1 shell'),
    BG2: screen(['⏺ started', '✻ Brewed for 9s · done 2:49 PM'], [P], '  ⏵⏵ bypass permissions on · 2 shells'),
    DOC: screen(['✻ Effecting… (1m 2s · ↓ 3.1k tokens)', ...Array.from({ length: 12 }, (_, i) => `  ⎿  ☐ 할 일 ${i + 1}`)], [P]),
    OPS: screen(['✶ Thinking… (esc to interrupt)'], ['> ']),
  };
  const fakes = {};
  for (const [k, s] of Object.entries(busy)) fakes[k] = await fakeClaudePane(wrapper, tmux, k, s);
  for (const k of Object.keys(busy)) assert.equal((await poke(k)).status, 0);
  await settle();
  for (const k of Object.keys(busy)) {
    assert.equal(fakes[k].typed(), '', k);
    assert.match(log(), new RegExp(`^poke ${k} busy$`, 'm'));
  }
  // 넣지 않았으면 표시를 남기지 않는다 — 일이 끝난 뒤 온 알림은 바로 깨운다.
  assert.ok(!readdirSync(join(aiDir(), 'state')).some((f) => f.startsWith('poke-')));
});

tmuxTest('agentEvents_poke_skipsPaneWithTypedTextOrUnknownScreen', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t);
  const cases = {
    // 사람이 치는 중 — 흐리지 않은 글자
    WP: screen(['✻ Baked for 26s · done 2:19 PM'], [`${P}사람이 치는 중`]),
    // 여러 줄 입력의 둘째 줄에만 글자가 있다
    HR: screen(['✻ Baked for 26s · done 2:19 PM'], [P, '  둘째 줄']),
    // 흐린 안내문 뒤에 친 글자
    QA: screen([], [`${P}${DIM('Try')} x`]),
    // 친 글자 + 끝의 반전 커서 칸 / 반전 커서가 친 한 글자 위에 있다(뒤에 흐린 안내문이 없다)
    CUR: screen([], [`${P}abc${INV(' ')}`]),
    CUR2: screen([], [`${P}${INV('a')}`]),
    // 입력 상자가 아니라 확인 창(❯ 는 메뉴 고르기) — 모르는 화면은 넣지 않는다
    OPS: ['Quick safety check: Is this a project you trust?', '', ' ❯ No, exit', '   Yes, I trust this folder', '', ' Enter to confirm · Esc to cancel'].join('\n') + '\nbypass permissions',
  };
  const fakes = {};
  for (const [k, s] of Object.entries(cases)) fakes[k] = await fakeClaudePane(wrapper, tmux, k, s);
  for (const k of Object.keys(cases)) assert.equal((await poke(k)).status, 0);
  await settle();
  for (const k of Object.keys(cases)) assert.equal(fakes[k].typed(), '', k);
  assert.match(log(), /^poke WP typing$/m);
  assert.match(log(), /^poke HR typing$/m);
  assert.match(log(), /^poke QA typing$/m);
  assert.match(log(), /^poke CUR typing$/m);
  assert.match(log(), /^poke CUR2 typing$/m);
  assert.match(log(), /^poke OPS unknown$/m);
});

// 일하는 중에 온 알림을 버리지 않는다 — 키 잠금을 쥔 채 RETRY_SEC 마다 다시 보고 RETRY_MAX 초 안에 쉬게 되면 한 번 넣는다.
tmuxTest('agentEvents_poke_waitsForBusyPaneThenSendsOnce', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t, { retryMax: '20' });
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', screen(['✻ Effecting… (8s · ↓ 81 tokens)'], [P]), IDLE);
  const first = poke('WP');
  await settle(1500);
  // 기다리는 동안 같은 키 알림이 또 오면 그냥 끝난다 — 기다리는 쪽이 맡는다.
  const second = await poke('WP');
  assert.equal(second.status, 0);
  assert.equal(log(), '', '기다리는 동안에는 기록하지 않는다');
  assert.equal(wp.typed(), '');
  wp.finish();
  assert.equal((await first).status, 0);
  await until(() => wp.typed().includes('\n'));
  await settle();
  assert.equal(wp.typed(), `${LOOP}\n`);
  assert.equal(log(), 'poke WP sent-after-wait\n');
  assert.ok(existsSync(join(aiDir(), 'state', 'poke-WP')));
});

tmuxTest('agentEvents_poke_givesUpOnPaneBusyPastLimit', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t, { retryMax: '2' });
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', screen(['✻ Effecting… (8s · ↓ 81 tokens)'], [P]));
  const started = Date.now();
  assert.equal((await poke('WP')).status, 0);
  assert.ok(Date.now() - started >= 2000, '제한 시간까지 다시 본다');
  await settle();
  assert.equal(wp.typed(), '');
  // 마지막 이유 한 줄만 남긴다.
  assert.equal(log(), 'poke WP busy\n');
  assert.ok(!existsSync(join(aiDir(), 'state', 'poke-WP')));
});

// 쉬는 칸으로 봐야 하는 화면 — 빈 입력 줄의 반전 커서가 흐린 안내문 첫 글자 위에 있다, 모델의 마지막 글이 「…」로 끝나거나 도구 표시 글자를 담는다.
tmuxTest('agentEvents_poke_idleDespiteCursorAndEllipsisText', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t);
  const cases = {
    WP: screen(['✻ Baked for 26s · done 2:19 PM'], [`${P}${INV('T')}${DIM('ry "fix lint errors"')}`]),
    HR: screen(['  다음 정기 확인까지 쉽니다…', 'Waiting for review…', '  Running… 이라는 글자는 기록일 뿐', '  1 shell still running 이라는 글', '✻ Baked for 26s · done 2:19 PM'], [P]),
  };
  const fakes = {};
  for (const [k, s] of Object.entries(cases)) fakes[k] = await fakeClaudePane(wrapper, tmux, k, s);
  for (const k of Object.keys(cases)) assert.equal((await poke(k)).status, 0);
  await until(() => Object.values(fakes).every((f) => f.typed().includes('\n')));
  assert.equal(fakes.WP.typed(), `${LOOP}\n`);
  assert.match(log(), /^poke HR sent$/m);
});

// 막 뜬 칸(open·start 가 띄우거나 다시 띄움)은 첫 /loop 가 아직 제출되지 않았을 수 있다 — 넣지 않고 기다린다.
tmuxTest('agentEvents_poke_skipsFreshPaneAndOpeningKey', async (t) => {
  const { wrapper, tmux, d, log, poke } = pokeSetup(t, { freshSec: '60' });
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  assert.equal((await poke('WP')).status, 0);
  await settle();
  assert.equal(wp.typed(), '');
  assert.equal(log(), 'poke WP starting\n');
  // 그 키를 open 이 여는 중(잠금)이어도 기다린다.
  const hr = await fakeClaudePane(wrapper, tmux, 'HR', IDLE);
  const lock = join(d, 'state', 'open-HR.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), String(process.pid));
  const env = { GW_TMUX: wrapper, GW_POKE_RETRY_SEC: '1', GW_POKE_RETRY_MAX: '20', GW_POKE_FRESH_SEC: '0' };
  const waiting = runAsync('agent-events', ['poke', d, 'HR'], env);
  await settle(1500);
  assert.equal(hr.typed(), '');
  rmSync(lock, { recursive: true });
  assert.equal((await waiting).status, 0);
  await until(() => hr.typed().includes('\n'));
  assert.match(log(), /^poke HR sent-after-wait$/m);
});

tmuxTest('agentEvents_poke_debouncesRepeatedWakes', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t);
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  // 한꺼번에 여럿, 그 뒤 또 하나 — 칸에는 한 번만 들어간다.
  await Promise.all([poke('WP'), poke('WP'), poke('WP')]);
  await poke('WP');
  await settle();
  assert.equal(wp.typed(), `${LOOP}\n`);
  assert.equal(log().split('\n').filter((l) => l === 'poke WP sent').length, 1, log());
  assert.match(log(), /^poke WP debounced$/m);
  assert.equal(readdirSync(join(aiDir(), 'state')).filter((f) => f.endsWith('.lock')).length, 0);
});

tmuxTest('agentEvents_poke_allKeysForReconnect', async (t) => {
  const { wrapper, tmux, d, log, poke } = pokeSetup(t);
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  const hr = await fakeClaudePane(wrapper, tmux, 'HR', IDLE);
  // 감시 창(events)·키 없는 창(예전 구성의 프로젝트 창 — 창 이름이 키처럼 보여도)은 칸이 아니다 — 건드리지도 기록하지도 않는다.
  tmux('new-window', '-d', '-t', '=kodi:', '-n', 'events', 'sleep', '60');
  const oldTyped = join(home, 'typed-OLD');
  tmux('new-window', '-d', '-t', '=kodi:', '-n', 'OLD', 'sh', '-c', 'printf "%s" "$1"; exec cat > "$2"', 'sh', IDLE, oldTyped);
  assert.equal((await poke('-')).status, 0);
  await until(() => wp.typed().includes('\n') && hr.typed().includes('\n'));
  await settle();
  assert.equal(existsSync(oldTyped) ? readFileSync(oldTyped, 'utf8') : '', '');
  assert.ok(!log().includes('poke OLD'), log());
  assert.equal(wp.typed(), `${LOOP}\n`);
  assert.equal(hr.typed(), '/loop /genia-works:work-loop HR --queue "AI 개발팀"\n');
  assert.match(log(), /^poke WP sent$/m);
  assert.match(log(), /^poke HR sent$/m);
  // 칸이 없는 키는 아무것도 넣지 않는다(칸 열기는 open 이 맡는다).
  assert.equal((await poke('QA')).status, 0);
  assert.match(log(), /^poke QA no-pane$/m);
  assert.equal(run('agent-events', ['poke', d, 'bad key']).status, 2);
});

// 서버가 불안정하면 「wake - reconnect」가 1~2분마다 온다 — 그때마다 모든 칸에 /loop 를 넣지 않고 다시 붙음 깨우기는 간격(기본 600초)에 한 번만.
// 키 알림(poke WP)은 이 간격에 막히지 않는다(키마다 60초 디바운스만).
tmuxTest('agentEvents_poke_reconnectWakesOncePerInterval', async (t) => {
  const { wrapper, tmux, d, log, poke } = pokeSetup(t);
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  const hr = await fakeClaudePane(wrapper, tmux, 'HR', IDLE);
  assert.equal((await poke('-')).status, 0);
  await until(() => wp.typed().includes('\n') && hr.typed().includes('\n'));
  // 키마다 60초 표시를 지워 「1분 넘게 지난 뒤 또 다시 붙음」을 흉내 낸다 — 다시 붙음 간격에만 걸려야 한다.
  rmSync(join(d, 'state', 'poke-WP'), { force: true });
  rmSync(join(d, 'state', 'poke-HR'), { force: true });
  assert.equal((await poke('-')).status, 0);
  assert.equal((await poke('-')).status, 0);
  await settle();
  assert.equal(wp.typed(), `${LOOP}\n`);
  assert.equal(hr.typed(), '/loop /genia-works:work-loop HR --queue "AI 개발팀"\n');
  assert.match(log(), /^poke - debounced$/m);
  // 키 알림은 그대로 깨운다.
  assert.equal((await poke('WP')).status, 0);
  await until(() => wp.typed() === `${LOOP}\n${LOOP}\n`);
  assert.equal(hr.typed(), '/loop /genia-works:work-loop HR --queue "AI 개발팀"\n');
});

tmuxTest('agentEvents_poke_ignoresNonClaudeRunner', async (t) => {
  const { wrapper, tmux, log, poke } = pokeSetup(t, { cli: 'genia' });
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  assert.equal((await poke('WP')).status, 0);
  assert.equal((await poke('-')).status, 0);
  await settle();
  assert.equal(wp.typed(), '');
  assert.ok(!log().includes('sent'), log());
});

tmuxTest('agentEvents_run_pokesIdlePaneOnWake', async (t) => {
  const { wrapper, tmux, d, log } = pokeSetup(t);
  run('gw-keys', ['add', 'kodi'], { input: 'ak_FAKE_KODI\n' });
  const wp = await fakeClaudePane(wrapper, tmux, 'WP', IDLE);
  const hr = await fakeClaudePane(wrapper, tmux, 'HR', IDLE);
  const srv = await fakeEventRounds([[mention('WP-1')]]);
  try {
    // WP 알림은 WP 칸만 깨운다 — HR 칸은 그대로.
    await runAgentEvents(['run', d], { GENIA_WORKS_API_URL: srv.url, GW_TMUX: wrapper, GW_POKE_FRESH_SEC: '0' }, { done: () => wp.typed().includes('\n') });
    assert.equal(wp.typed(), `${LOOP}\n`);
    assert.equal(hr.typed(), '');
    assert.match(log(), /^wake WP-1 ISSUE_CHAT_MENTION$/m);
  } finally {
    srv.close();
  }
});

tmuxTest('agentProject_start_ensuresEventsWindow', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  mkdirSync(join(d, 'repos', 'WP'), { recursive: true });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec sleep 60\n');
  chmodSync(join(bin, 'claude'), 0o755);
  // 결과 줄은 그대로 agent-window 의 것이다(감시 창 결과는 내지 않는다).
  assert.equal(run('agent-project', ['start', d, 'WP'], { env: { GW_TMUX: wrapper } }).stdout, 'started kodi\n');
  assert.equal(eventWindows(tmux).length, 1);
  assert.equal(run('agent-project', ['start', d, 'WP'], { env: { GW_TMUX: wrapper } }).stdout, 'exists kodi\n');
  assert.equal(eventWindows(tmux).length, 1);
});

tmuxTest('agentWindow_keys_excludesEventsWindow', (t) => {
  const { wrapper, tmux } = tmuxServer(t);
  const d = aiDir();
  agentWindow(wrapper, ['kodi', 'WP', home, 'sleep', '60']);
  assert.equal(run('agent-events', ['ensure', d], { env: { GW_TMUX: wrapper } }).stdout, 'started\n');
  const keys = run('agent-window', ['--keys', 'kodi'], { env: { GW_TMUX: wrapper } });
  assert.deepEqual([keys.status, keys.stdout], [0, 'WP\n']);
  // 엔트리포인트 감독이 한 번에 읽는 칸 상태 — 키와 죽음 여부, 감시 창은 뺀다.
  assert.equal(run('agent-window', ['--states', 'kodi'], { env: { GW_TMUX: wrapper } }).stdout, 'WP 0\n');
  assert.equal(run('agent-window', ['--paths', 'kodi'], { env: { GW_TMUX: wrapper } }).stdout.split('\n').filter(Boolean).length, 1);
  assert.deepEqual(run('agent-home', [d, 'missing', 'WP'], { env: { GW_TMUX: wrapper } }).stdout, '');
  // --restart 는 프로젝트 칸만 다시 띄우고 감시 창은 건드리지 않는다.
  const [before] = eventWindows(tmux);
  assert.equal(agentWindow(wrapper, ['--restart', 'kodi', 'WP', home, 'sleep', '61']).stdout, 'restarted kodi\n');
  const [after] = eventWindows(tmux);
  assert.deepEqual([after.id, after.pid, after.dead], [before.id, before.pid, false]);
});
