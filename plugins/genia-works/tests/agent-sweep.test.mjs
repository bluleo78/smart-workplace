// WP-1683 부팅 때 워크트리 정리 테스트 — gw-issue-status(이슈 상태 한 줄 조회)와 agent-sweep(AI 폴더의 모든 저장소에 worktree-sweep 을 돌리고
// 이슈 상태를 서버에 물어 DONE·CANCELED 만 지움)을 가짜 서버(같은 프로세스의 HTTP)와 임시 git 저장소(origin 은 bare)로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'scripts');
const KEY = 'ak_FAKE_KODI';

/**
 * 테스트 하나의 격리 환경 — 홈(키 저장소)과 AI 폴더 <root>/agents/kodi. git 은 전역 설정·커밋 신원에 기대지 않게 고정한다.
 * repo(키) 로 <AI 폴더>/repos/<키>(MAIN — origin 은 bare)를 만든다.
 */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gw-agent-sweep-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  mkdirSync(home);
  const aiDir = join(root, 'agents', 'kodi');
  mkdirSync(join(aiDir, 'repos'), { recursive: true });
  const env = (extra = {}) => ({
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...extra,
  });
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env() });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const r = spawnSync(join(scripts, 'gw-keys'), ['add', 'kodi'], { input: `${KEY}\n`, encoding: 'utf8', env: env() });
  assert.equal(r.status, 0, r.stderr);

  /** <AI 폴더>/repos/<key> — origin/main 이 있고 .claude/worktrees/·.work-loop/state/ 는 git 무시다. */
  function repo(key) {
    const origin = join(root, `${key}.git`);
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    const main = join(aiDir, 'repos', key);
    git(root, 'init', '-q', '-b', 'main', main);
    writeFileSync(join(main, '.gitignore'), '.claude/worktrees/\n.work-loop/state/\n');
    git(main, 'add', '.');
    git(main, 'commit', '-qm', 'init');
    git(main, 'remote', 'add', 'origin', origin);
    git(main, 'push', '-q', 'origin', 'main');
    return main;
  }

  /** work-loop 가 이슈마다 남기는 notes 파일(정리 후보가 되는 조건). */
  function notes(main, name) {
    mkdirSync(join(main, '.work-loop', 'state', 'notes'), { recursive: true });
    writeFileSync(join(main, '.work-loop', 'state', 'notes', `${name}.md`), 'x');
  }

  /** MAIN/.claude/worktrees/<name> 워크트리를 origin/main 에서 새 브랜치로. 이슈 키 모양이면 notes 도 둔다. */
  function worktree(main, name, branch) {
    git(main, 'worktree', 'add', '-q', `.claude/worktrees/${name}`, '-b', branch, 'origin/main');
    if (/^[A-Z][A-Z0-9_]*-\d+$/.test(name)) notes(main, name);
    return join(main, '.claude', 'worktrees', name);
  }

  return { root, home, aiDir, env, git, repo, notes, worktree };
}

/**
 * 가짜 서버 — GET /api/v1/projects/<키>/issues/<번호> 에 issues['<키>-<번호>'] 가 문자열이면 { summary: { status } } 와 200,
 * 숫자면 그 HTTP 코드로 답한다(없으면 404). 받은 요청(주소·인증 헤더)을 reqs 에 모은다.
 */
async function fakeServer(issues) {
  const reqs = [];
  const server = createServer((req, res) => {
    reqs.push({ url: req.url, auth: req.headers.authorization });
    const m = req.url.match(/^\/api\/v1\/projects\/([^/]+)\/issues\/(\d+)$/);
    const v = m ? issues[`${m[1]}-${m[2]}`] : undefined;
    const code = typeof v === 'string' ? 200 : (v ?? 404);
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(code === 200 ? JSON.stringify({ summary: { key: `${m[1]}-${m[2]}`, status: v }, body: '' }) : `{"status":${code}}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, reqs, close: () => server.close() };
}

/** 닫힌 포트 — 서버에 닿지 못하는 경우. */
const DOWN = 'http://127.0.0.1:9/api/v1';

/** 스크립트를 비동기로 띄운다 — 같은 프로세스의 가짜 서버가 답해야 하므로 spawnSync 로는 기다릴 수 없다. */
function runAsync(f, cmd, args, extra = {}) {
  const p = spawn(join(scripts, cmd), args, { env: f.env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.stderr.on('data', (d) => (stderr += d));
  return new Promise((r) => {
    // 띄우지 못하면(스크립트가 없음·실행 권한 없음) close 가 오지 않을 수 있어 error 로도 끝낸다.
    p.on('error', (e) => r({ status: -1, stdout, stderr: String(e) }));
    p.on('close', (status) => r({ status, stdout, stderr }));
  });
}

/** agent-sweep 출력 → 줄마다 [프로젝트 키, 나머지] (경로는 임시 폴더 이름에 기대지 않게 끝 이름만). */
function lines(out) {
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [k, rest] = l.split('\t');
      return [k, rest.replace(/\/\S*\/([^/\s:]+)(?=:|$)/, '$1')];
    })
    .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
}

const branchExists = (main, name) => spawnSync('git', ['-C', main, 'rev-parse', '-q', '--verify', `refs/heads/${name}`]).status === 0;

// ---------------------------------------------------------------- gw-issue-status

test('gw-issue-status: 이슈 상태 범주를 한 줄로 내고, 키는 어디에도 내지 않는다 (WP-1683)', async (t) => {
  const f = fixture(t);
  const srv = await fakeServer({ 'WP-1': 'DONE' });
  try {
    const r = await runAsync(f, 'gw-issue-status', ['kodi', 'WP-1'], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'DONE\n');
    assert.deepEqual(srv.reqs, [{ url: '/api/v1/projects/WP/issues/1', auth: `Bearer ${KEY}` }]);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(KEY));
  } finally {
    srv.close();
  }
});

test('gw-issue-status: 401 은 4, 403 은 6, 404 는 8, 500·닿지 못함은 5, 이슈 키 형식이 아니면 2, 키가 없으면 1 (WP-1683)', async (t) => {
  const f = fixture(t);
  const srv = await fakeServer({ 'WP-1': 401, 'WP-2': 403, 'WP-3': 404, 'WP-4': 500 });
  try {
    for (const [key, code] of [['WP-1', 4], ['WP-2', 6], ['WP-3', 8], ['WP-4', 5]]) {
      const r = await runAsync(f, 'gw-issue-status', ['kodi', key], { GENIA_WORKS_API_URL: srv.url });
      assert.equal(r.status, code, `${key}: ${r.stderr}`);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
      assert.match(r.stderr, /^gw-issue-status: /);
      assert.doesNotMatch(r.stderr, new RegExp(KEY));
    }
  } finally {
    srv.close();
  }
  const down = await runAsync(f, 'gw-issue-status', ['kodi', 'WP-1'], { GENIA_WORKS_API_URL: DOWN });
  assert.equal(down.status, 5);
  assert.match(down.stderr, /서버에 닿지 못했습니다/);
  assert.equal((await runAsync(f, 'gw-issue-status', ['kodi', 'WP1'], { GENIA_WORKS_API_URL: DOWN })).status, 2);
  assert.equal((await runAsync(f, 'gw-issue-status', ['kodi'], { GENIA_WORKS_API_URL: DOWN })).status, 2);
  assert.equal((await runAsync(f, 'gw-issue-status', ['nobody', 'WP-1'], { GENIA_WORKS_API_URL: DOWN })).status, 1);
});

// ---------------------------------------------------------------- agent-sweep

/** repos/WP 에 WP-1(DONE)·WP-2(IN_PROGRESS)·WP-3(CANCELED, 워크트리 없이 notes 만)·WP-4(DONE 이지만 커밋 안 한 변경). */
function standardWp(f) {
  const main = f.repo('WP');
  f.worktree(main, 'WP-1', 'fix/wp-1');
  f.worktree(main, 'WP-2', 'fix/wp-2');
  f.notes(main, 'WP-3');
  const w4 = f.worktree(main, 'WP-4', 'fix/wp-4');
  writeFileSync(join(w4, 'new.txt'), 'x');
  return main;
}
const WP_STATES = { 'WP-1': 'DONE', 'WP-2': 'IN_PROGRESS', 'WP-3': 'CANCELED', 'WP-4': 'DONE' };

test('agent-sweep: DONE·CANCELED 인 이슈의 워크트리·notes 만 지우고 진행 중인 것은 남긴다 (WP-1683)', async (t) => {
  const f = fixture(t);
  const main = standardWp(f);
  const srv = await fakeServer(WP_STATES);
  try {
    const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), [
      ['WP', 'kept WP-2: IN_PROGRESS'],
      ['WP', 'kept WP-4: dirty'],
      ['WP', 'removed - WP-3'],
      ['WP', 'removed WP-1'],
    ]);
    assert.equal(existsSync(join(main, '.claude', 'worktrees', 'WP-1')), false);
    assert.equal(branchExists(main, 'fix/wp-1'), false);
    assert.equal(existsSync(join(main, '.work-loop', 'state', 'notes', 'WP-3.md')), false);
    assert.equal(existsSync(join(main, '.claude', 'worktrees', 'WP-2')), true);
    assert.equal(existsSync(join(main, '.claude', 'worktrees', 'WP-4')), true);
  } finally {
    srv.close();
  }
});

test('agent-sweep: DONE 이어도 커밋 안 한 변경이 있는 워크트리는 서버에 묻지도 지우지도 않는다 (WP-1683)', async (t) => {
  const f = fixture(t);
  standardWp(f);
  const srv = await fakeServer(WP_STATES);
  try {
    const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^WP\tkept WP-4: dirty$/m);
    const asked = srv.reqs.map((q) => q.url).sort();
    assert.deepEqual(asked, ['/api/v1/projects/WP/issues/1', '/api/v1/projects/WP/issues/2', '/api/v1/projects/WP/issues/3']);
  } finally {
    srv.close();
  }
});

test('agent-sweep: 칸이 없는 프로젝트(repos 의 다른 저장소)의 끝난 이슈도 지운다 (WP-1683)', async (t) => {
  const f = fixture(t);
  f.repo('WP');
  const ops = f.repo('OPS');
  f.worktree(ops, 'OPS-7', 'fix/ops-7');
  const srv = await fakeServer({ 'OPS-7': 'DONE' });
  try {
    const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), [['OPS', 'removed OPS-7']]);
    assert.equal(existsSync(join(ops, '.claude', 'worktrees', 'OPS-7')), false);
  } finally {
    srv.close();
  }
});

test('agent-sweep: 더는 소속이 아닌 프로젝트(이슈 조회 403·404)의 워크트리는 남긴다 (WP-1683)', async (t) => {
  const f = fixture(t);
  const old = f.repo('OLD');
  f.worktree(old, 'OLD-1', 'fix/old-1');
  f.worktree(old, 'OLD-2', 'fix/old-2');
  const srv = await fakeServer({ 'OLD-1': 403, 'OLD-2': 404 });
  try {
    const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), [
      ['OLD', 'kept OLD-1: 상태 확인 실패(6)'],
      ['OLD', 'kept OLD-2: 상태 확인 실패(8)'],
    ]);
    assert.equal(existsSync(join(old, '.claude', 'worktrees', 'OLD-1')), true);
    assert.equal(existsSync(join(old, '.claude', 'worktrees', 'OLD-2')), true);
  } finally {
    srv.close();
  }
});

test('agent-sweep: 서버에 닿지 못하면 아무것도 지우지 않고, 첫 실패 뒤로는 묻지 않는다 (WP-1683)', async (t) => {
  const f = fixture(t);
  const main = standardWp(f);
  const ops = f.repo('OPS');
  f.worktree(ops, 'OPS-7', 'fix/ops-7');
  const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: DOWN });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(r.stdout), [
    ['OPS', 'kept OPS-7: 서버에 닿지 못함'],
    ['WP', 'kept WP-1: 서버에 닿지 못함'],
    ['WP', 'kept WP-2: 서버에 닿지 못함'],
    ['WP', 'kept WP-3: 서버에 닿지 못함'],
    ['WP', 'kept WP-4: dirty'],
  ]);
  // 실패는 처음 한 번만 표준 오류로 알린다(그 뒤로는 묻지 않는다).
  assert.equal((r.stderr.match(/서버에 닿지 못했습니다/g) ?? []).length, 1, r.stderr);
  assert.equal(existsSync(join(main, '.claude', 'worktrees', 'WP-1')), true);
  assert.equal(existsSync(join(main, '.work-loop', 'state', 'notes', 'WP-3.md')), true);
  assert.equal(existsSync(join(ops, '.claude', 'worktrees', 'OPS-7')), true);
});

test('agent-sweep: main 에 들어간 기차 워크트리는 서버에 묻지 않고 지운다 (WP-1683)', async (t) => {
  const f = fixture(t);
  const main = f.repo('WP');
  const w = f.worktree(main, 'integ-kodi-1', 'integ/kodi-1');
  writeFileSync(join(w, 'a.txt'), 'a');
  f.git(w, 'add', 'a.txt');
  f.git(w, 'commit', '-qm', 'feat: a (WP-9)');
  f.git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-9', 'integ/kodi-1');
  f.git(main, 'push', '-q', 'origin', 'main');
  const srv = await fakeServer({});
  try {
    const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: srv.url });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), [['WP', 'removed integ-kodi-1']]);
    assert.equal(existsSync(w), false);
    assert.deepEqual(srv.reqs, []);
  } finally {
    srv.close();
  }
});

test('agent-sweep: 키 형식이 아닌 폴더·git 이 아닌 폴더는 건너뛰고, AI 폴더가 아니면 사용법 오류 (WP-1683)', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.aiDir, 'repos', 'bad name'));
  mkdirSync(join(f.aiDir, 'repos', 'NOGIT'));
  writeFileSync(join(f.aiDir, 'repos', 'FILE'), 'x');
  const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: DOWN });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal((await runAsync(f, 'agent-sweep', [], {})).status, 2);
  assert.equal((await runAsync(f, 'agent-sweep', [join(f.root, 'none')], {})).status, 2);
  // repos 가 없는 AI 폴더는 할 일이 없을 뿐이다.
  mkdirSync(join(f.root, 'agents', 'empty'));
  const e = await runAsync(f, 'agent-sweep', [join(f.root, 'agents', 'empty')], { GENIA_WORKS_API_URL: DOWN });
  assert.equal(e.status, 0, e.stderr);
  assert.equal(e.stdout, '');
});

test('agent-sweep: 저장소를 받지 못하면(fetch 실패) 그 저장소는 건너뛰었다고 한 줄 남긴다 (WP-1683)', async (t) => {
  const f = fixture(t);
  const main = standardWp(f);
  f.git(main, 'remote', 'set-url', 'origin', join(f.root, 'gone.git'));
  const r = await runAsync(f, 'agent-sweep', [f.aiDir], { GENIA_WORKS_API_URL: DOWN });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'WP\tskip fetch-failed\n');
});
