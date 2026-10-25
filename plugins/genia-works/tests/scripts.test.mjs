// genia-works 플러그인 sh 스크립트 테스트 — 가짜 HOME·가짜 ps 로 키 저장소·세션 선택·세션 키를 검증한다.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, readdirSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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
