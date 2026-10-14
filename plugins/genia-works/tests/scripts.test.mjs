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
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_PS_TABLE: table },
  });
  assert.equal(r.status, 0);
  assert.equal(existsSync(good), true);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(dead), false);
  assert.equal(existsSync(reused), false);
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
