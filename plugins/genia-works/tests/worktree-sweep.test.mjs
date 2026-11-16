// WP-1637 work-loop 끝난 이슈 정리(worktree-sweep) 테스트 — 임시 저장소(origin 은 bare)로 워크트리·브랜치·실행 상태 파일을 만들어
// list 가 정리 후보와 상태를 바르게 내는지, remove 가 지울 것만 지우고 남길 때는 이유와 종료 코드를 내는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'scripts');

// 커밋 신원·전역 설정에 기대지 않게 git 환경을 고정한다.
function env(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.WS_HOME,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...extra,
  };
}

function git(cwd, ...args) {
  return gitEnv(cwd, {}, ...args);
}

// 환경을 더해 부르는 git — 작성 시각(GIT_AUTHOR_DATE)을 정해 커밋할 때 쓴다.
function gitEnv(cwd, extra, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env(extra) });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function sweep(args, extra = {}) {
  return spawnSync(join(scripts, 'worktree-sweep'), args, { encoding: 'utf8', env: env(extra) });
}

/** bg-job <명령> <MAIN> <인자…> — 정리가 보는 백그라운드 작업을 실제로 띄우고 끝낸다. */
function bg(main, cmd, ...args) {
  return spawnSync(join(scripts, 'bg-job'), [cmd, main, ...args], { encoding: 'utf8', env: env() });
}

/** MAIN 과 origin(bare) — origin/main 이 있고, .claude/worktrees/ 와 node_modules/ 는 git 무시다. */
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'gw-sweep-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  process.env.WS_HOME = join(root, 'home');
  mkdirSync(process.env.WS_HOME);
  const origin = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const main = join(root, 'main');
  git(root, 'init', '-q', '-b', 'main', main);
  writeFileSync(join(main, '.gitignore'), '.claude/worktrees/\nnode_modules/\n.work-loop/state/\n');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '-q', 'origin', 'main');
  return main;
}

/**
 * MAIN/.claude/worktrees/<name> 워크트리를 origin/main 에서 새 브랜치로 만든다.
 * 이름이 이슈 키 모양이면 work-loop 가 그 이슈를 하며 남기는 notes 파일도 만든다 — list 는 notes 가 있는 이슈 워크트리만 낸다.
 * notes: false 면 사람 세션이 만든 것처럼 notes 없이 둔다.
 */
function addWorktree(main, name, branch, { notes = /^[A-Z][A-Z0-9_]*-\d+$/.test(name) } = {}) {
  git(main, 'worktree', 'add', '-q', `.claude/worktrees/${name}`, '-b', branch, 'origin/main');
  if (notes) put(state(main, 'notes', `${name}.md`));
  return join(main, '.claude', 'worktrees', name);
}

function commit(dir, file, subject) {
  writeFileSync(join(dir, file), subject);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', subject);
}

function state(main, ...parts) {
  return join(main, '.work-loop', 'state', ...parts);
}

function put(path, text = 'x') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** list 출력(프로젝트 키 WP·AI 이름 dev) → 줄마다 [키, 경로 끝 이름, 브랜치, 상태] (경로는 끝 이름만 — 임시 폴더 이름에 기대지 않게). */
function rows(main) {
  const r = sweep(['list', main, 'WP', 'dev']);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [keys, path, branch, st] = l.split('\t');
    return [keys, path === '-' ? '-' : path.split('/').pop(), branch, st];
  }).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
}

test('worktree-sweep list: 이슈 워크트리는 키·브랜치·ok, 커밋 안 한 변경은 dirty, 잠긴 것은 locked, 무시 파일만 있으면 ok', (t) => {
  const main = repo(t);
  addWorktree(main, 'WP-1', 'fix/wp-1');
  const w2 = addWorktree(main, 'WP-2', 'feat/wp-2');
  writeFileSync(join(w2, 'new.txt'), 'x');
  addWorktree(main, 'WP-3', 'fix/wp-3');
  git(main, 'worktree', 'lock', '.claude/worktrees/WP-3');
  const w4 = addWorktree(main, 'WP-4', 'fix/wp-4');
  put(join(w4, 'node_modules', 'a.js'));
  assert.deepEqual(rows(main), [
    ['WP-1', 'WP-1', 'fix/wp-1', 'ok'],
    ['WP-2', 'WP-2', 'feat/wp-2', 'dirty'],
    ['WP-3', 'WP-3', 'fix/wp-3', 'locked'],
    ['WP-4', 'WP-4', 'fix/wp-4', 'ok'],
  ]);
});

test('worktree-sweep list: 백그라운드 작업이 돌면 running — 이슈 키 모양이 아닌 폴더·-plan 워크트리·다른 프로젝트 키·.claude/worktrees 밖은 내지 않는다', (t) => {
  const main = repo(t);
  addWorktree(main, 'WP-5', 'fix/wp-5');
  // bg-job 의 pid 파일 — 시작 시각 없이 "<pid>-" 면 살아 있는지만 본다(이 테스트 프로세스는 살아 있다).
  put(state(main, 'jobs', 'WP-5.pid'), `${process.pid}-\n`);
  // exit 파일이 있으면 끝난 작업이다(pid 가 살아 있어도).
  addWorktree(main, 'WP-6', 'fix/wp-6');
  put(state(main, 'jobs', 'WP-6.pid'), `${process.pid}-\n`);
  put(state(main, 'jobs', 'WP-6.exit'), '0\n');
  addWorktree(main, 'agent-abc', 'agent/abc');
  // 기획 워크트리는 기획 넘기기(plan-issue.md)가 지운다 — 정리 대상이 아니다.
  git(main, 'worktree', 'add', '-q', '--detach', '.claude/worktrees/WP-7-plan', 'origin/main');
  addWorktree(main, 'ZZ-1', 'fix/zz-1');
  addWorktree(main, 'WPX-2', 'fix/wpx-2');
  git(main, 'worktree', 'add', '-q', join(main, '..', 'elsewhere-WP-8'), '-b', 'fix/wp-8', 'origin/main');
  assert.deepEqual(rows(main), [
    ['WP-5', 'WP-5', 'fix/wp-5', 'running'],
    ['WP-6', 'WP-6', 'fix/wp-6', 'ok'],
  ]);
});

test('worktree-sweep list: 기차는 merge 커밋으로 main 에 들어간 내 기차만 폴더 이름을 키로 낸다 — 안 들어간 기차·첫 부모 줄에 있는 기차·다른 AI 의 기차는 내지 않는다', (t) => {
  const main = repo(t);
  // merge 커밋으로 들어간 기차
  const w2 = addWorktree(main, 'integ-dev-2', 'integ/dev-2');
  commit(w2, 'a.txt', 'feat: a (WP-21)');
  git(w2, 'push', '-q', 'origin', 'integ/dev-2');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-21', 'integ/dev-2');
  git(main, 'push', '-q', 'origin', 'main');
  // 빨리 감기로 들어간 기차 — 기차는 merge 커밋으로 들어가므로, 끝이 main 의 첫 부모 줄에 있으면 빈 기차와 가를 수 없어 내지 않는다.
  const w3 = addWorktree(main, 'integ-dev-3', 'integ/dev-3');
  commit(w3, 'c.txt', 'feat: c (WP-23)');
  git(main, 'merge', '-q', '--ff-only', 'integ/dev-3');
  git(main, 'push', '-q', 'origin', 'main');
  // 아직 안 들어간 기차
  const w4 = addWorktree(main, 'integ-dev-4', 'integ/dev-4');
  commit(w4, 'd.txt', 'feat: d (WP-24)');
  git(w4, 'push', '-q', 'origin', 'integ/dev-4');
  // 다른 AI(other, dev-x)의 들어간 기차
  addWorktree(main, 'integ-other-1', 'integ/other-1');
  addWorktree(main, 'integ-dev-x-1', 'integ/dev-x-1');
  assert.deepEqual(rows(main), [
    ['integ-dev-2', 'integ-dev-2', 'integ/dev-2', 'ok'],
  ]);
});

test('worktree-sweep list: 아무것도 쌓지 않은 빈 기차(origin/main 에서 만든 브랜치)는 main 의 조상이어도 들어간 것이 아니다 (WP-1637)', (t) => {
  const main = repo(t);
  // 워크트리가 있는 빈 기차 — main 이 앞서 가도 기차 끝은 main 의 첫 부모 줄에 있다.
  addWorktree(main, 'integ-dev-1', 'integ/dev-1');
  // 워크트리 없이 브랜치와 notes 만 남은 빈 기차
  git(main, 'branch', 'integ/dev-2', 'origin/main');
  put(state(main, 'notes', 'integ-dev-2.md'));
  commit(main, 'm.txt', 'chore: main 이 앞서 간다');
  git(main, 'push', '-q', 'origin', 'main');
  // merge --no-ff 로 들어간 기차는 낸다(끝이 merge 커밋의 둘째 부모).
  const w3 = addWorktree(main, 'integ-dev-3', 'integ/dev-3');
  commit(w3, 'a.txt', 'feat: a (WP-3)');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-3', 'integ/dev-3');
  git(main, 'push', '-q', 'origin', 'main');
  assert.deepEqual(rows(main), [['integ-dev-3', 'integ-dev-3', 'integ/dev-3', 'ok']]);
});

test('worktree-sweep list: notes 파일이 없는 이슈 워크트리는 사람 세션이 만든 것일 수 있어 내지 않는다 (WP-1637)', (t) => {
  const main = repo(t);
  addWorktree(main, 'WP-1', 'fix/wp-1', { notes: false });
  addWorktree(main, 'WP-2', 'fix/wp-2');
  assert.deepEqual(rows(main), [['WP-2', 'WP-2', 'fix/wp-2', 'ok']]);
});

test('worktree-sweep list: 어느 원격에도 없고 origin/main 에 같은 patch 로도 없는 커밋이 있으면 unpushed — dirty 보다 앞이고 running 보다 뒤다', (t) => {
  const main = repo(t);
  const w1 = addWorktree(main, 'WP-1', 'fix/wp-1');
  commit(w1, 'a.txt', 'fix: a (WP-1)');
  // push 한 브랜치는 ok
  const w2 = addWorktree(main, 'WP-2', 'fix/wp-2');
  commit(w2, 'b.txt', 'fix: b (WP-2)');
  git(w2, 'push', '-q', 'origin', 'fix/wp-2');
  // push 하지 않았지만 같은 patch 가 origin/main 에 들어갔으면(기차 흐름의 feature 브랜치) ok
  const w3 = addWorktree(main, 'WP-3', 'fix/wp-3');
  commit(w3, 'c.txt', 'fix: c (WP-3)');
  git(main, 'cherry-pick', 'fix/wp-3');
  git(main, 'push', '-q', 'origin', 'main');
  // 올리지 않은 커밋 + 커밋 안 한 변경 → unpushed
  const w4 = addWorktree(main, 'WP-4', 'fix/wp-4');
  commit(w4, 'd.txt', 'fix: d (WP-4)');
  writeFileSync(join(w4, 'new.txt'), 'x');
  // 올리지 않은 커밋 + 돌고 있는 작업 → running
  const w5 = addWorktree(main, 'WP-5', 'fix/wp-5');
  commit(w5, 'e.txt', 'fix: e (WP-5)');
  put(state(main, 'jobs', 'WP-5.pid'), `${process.pid}-\n`);
  assert.deepEqual(rows(main), [
    ['WP-1', 'WP-1', 'fix/wp-1', 'unpushed'],
    ['WP-2', 'WP-2', 'fix/wp-2', 'ok'],
    ['WP-3', 'WP-3', 'fix/wp-3', 'ok'],
    ['WP-4', 'WP-4', 'fix/wp-4', 'unpushed'],
    ['WP-5', 'WP-5', 'fix/wp-5', 'running'],
  ]);
});

test('worktree-sweep list: 워크트리 없이 남은 notes 는 notes-only — WP-37 notes 는 WP-377 워크트리와 헷갈리지 않고, 내 기차 notes 는 머지된 기차 것만 낸다', (t) => {
  const main = repo(t);
  addWorktree(main, 'WP-377', 'fix/wp-377');
  put(state(main, 'notes', 'WP-37.md'));
  // 아직 안 들어간 기차 — 줄로 내지 않고, 그 notes 도 워크트리가 있으니 notes-only 가 아니다.
  const w = addWorktree(main, 'integ-dev-4', 'integ/dev-4');
  commit(w, 'a.txt', 'feat: a (WP-40)');
  git(w, 'push', '-q', 'origin', 'integ/dev-4');
  // 머지된 기차인데 워크트리만 지워졌다 — 로컬 기차 브랜치만 남은 것(5)·원격 기차 브랜치만 남은 것(6).
  const w5 = addWorktree(main, 'integ-dev-5', 'integ/dev-5');
  commit(w5, 'b.txt', 'feat: b (WP-50)');
  const w6 = addWorktree(main, 'integ-dev-6', 'integ/dev-6');
  commit(w6, 'c.txt', 'feat: c (WP-60)');
  git(w6, 'push', '-q', 'origin', 'integ/dev-6');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-50', 'integ/dev-5');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-60', 'integ/dev-6');
  git(main, 'push', '-q', 'origin', 'main');
  git(main, 'worktree', 'remove', w5);
  git(main, 'worktree', 'remove', w6);
  git(main, 'branch', '-D', 'integ/dev-6');
  // 머지 안 된 기차 — 워크트리 없이 로컬 브랜치만 있는 것(7)·브랜치가 아예 없는 것(9)은 확인할 수 없어 남긴다.
  git(main, 'branch', 'integ/dev-7', 'integ/dev-4');
  for (const n of ['integ-dev-4', 'integ-dev-5', 'integ-dev-6', 'integ-dev-7', 'integ-dev-9', 'integ-other-9', 'ZZ-5', 'scratch']) {
    put(state(main, 'notes', `${n}.md`));
  }
  assert.deepEqual(rows(main), [
    ['integ-dev-5', '-', '-', 'notes-only'],
    ['integ-dev-6', '-', '-', 'notes-only'],
    ['WP-37', '-', '-', 'notes-only'],
    ['WP-377', 'WP-377', 'fix/wp-377', 'ok'],
  ]);
});

test('worktree-sweep list·remove: 검토자가 통합 PR 을 받은 이슈 워크트리(브랜치 integ/…)도 폴더 이름(이슈 키)으로 이슈 줄로 낸다 (WP-1637)', (t) => {
  const main = repo(t);
  // 다른 AI(other)의 기차를 검토자가 첫 이슈 키 폴더로 받았다.
  const w = addWorktree(main, 'WP-9', 'integ/other-3');
  commit(w, 'a.txt', 'feat: a (WP-9)');
  git(w, 'push', '-q', 'origin', 'integ/other-3');
  put(state(main, 'sweep', 'WP-9'), '커밋 안 한 변경\n');
  assert.deepEqual(rows(main), [['WP-9', 'WP-9', 'integ/other-3', 'ok']]);
  const r = sweep(['remove', main, w, 'WP-9']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(existsSync(w), false);
  assert.equal(spawnSync('git', ['-C', main, 'rev-parse', '-q', '--verify', 'refs/heads/integ/other-3']).status, 1);
  assert.match(git(main, 'ls-remote', 'origin', 'integ/other-3'), /refs\/heads\/integ\/other-3/);
  assert.equal(existsSync(state(main, 'notes', 'WP-9.md')), false);
  assert.equal(existsSync(state(main, 'sweep', 'WP-9')), false);
});

test('worktree-sweep list: 먼저 origin 을 fetch 해 그 뒤의 origin/main 으로 판정하고, fetch 가 실패하면 판정하지 않고 exit 2 (WP-1637)', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-1', 'fix/wp-1');
  commit(w, 'a.txt', 'fix: a (WP-1)');
  // 다른 곳(호스트의 머지)에서 그 커밋이 origin/main 에 들어갔다 — MAIN 의 origin/main 은 아직 모른다.
  const other = join(main, '..', 'other-clone');
  git(join(main, '..'), 'clone', '-q', join(main, '..', 'origin.git'), other);
  git(other, 'fetch', '-q', main, 'fix/wp-1');
  git(other, 'merge', '-q', '--no-ff', '-m', 'merge: WP-1', 'FETCH_HEAD');
  git(other, 'push', '-q', 'origin', 'main');
  assert.deepEqual(rows(main), [['WP-1', 'WP-1', 'fix/wp-1', 'ok']]);

  git(main, 'remote', 'set-url', 'origin', join(main, '..', 'nope.git'));
  const r = sweep(['list', main, 'WP', 'dev']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /fetch/);
});

test('worktree-sweep list: 후보(내 워크트리·notes)가 없으면 fetch 하지 않고 아무것도 내지 않는다 (WP-1637)', (t) => {
  const main = repo(t);
  // 후보가 아닌 것만 있다 — notes 없는 이슈 워크트리·다른 프로젝트·다른 AI 의 기차.
  addWorktree(main, 'WP-1', 'fix/wp-1', { notes: false });
  addWorktree(main, 'ZZ-1', 'fix/zz-1');
  addWorktree(main, 'integ-other-1', 'integ/other-1');
  git(main, 'remote', 'set-url', 'origin', join(main, '..', 'nope.git'));
  const r = sweep(['list', main, 'WP', 'dev']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('worktree-sweep list: 기차 rebase·충돌 풀기로 patch 가 바뀌어도 작성자 시각·메일·제목이 같은 커밋이 origin/main 에 있으면 올라간 것이다 (WP-1637)', (t) => {
  const main = repo(t);
  const f = addWorktree(main, 'WP-1', 'fix/wp-1');
  commit(f, 'a.txt', 'fix: a (WP-1)');
  // 기차에 cherry-pick 한 뒤 내용을 바꿔(충돌을 푼 것처럼) amend — 작성자 정보는 그대로다.
  const tw = addWorktree(main, 'integ-dev-1', 'integ/dev-1');
  git(tw, 'cherry-pick', 'fix/wp-1');
  writeFileSync(join(tw, 'a.txt'), 'resolved');
  git(tw, 'commit', '-q', '-a', '--amend', '--no-edit');
  // 제목만 같고 작성 시각이 다른 커밋 — 다른 커밋이니 여전히 올리지 않은 것이다.
  const g = addWorktree(main, 'WP-2', 'fix/wp-2');
  writeFileSync(join(g, 'b.txt'), 'b');
  git(g, 'add', 'b.txt');
  gitEnv(g, { GIT_AUTHOR_DATE: '2021-01-01T00:00:00Z' }, 'commit', '-qm', 'fix: b (WP-2)');
  writeFileSync(join(tw, 'b.txt'), 'other');
  git(tw, 'add', 'b.txt');
  gitEnv(tw, { GIT_AUTHOR_DATE: '2022-01-01T00:00:00Z' }, 'commit', '-qm', 'fix: b (WP-2)');
  const h = addWorktree(main, 'WP-3', 'fix/wp-3');
  commit(h, 'c.txt', 'fix: c (WP-3)');
  git(tw, 'cherry-pick', 'fix/wp-3');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-1·WP-2·WP-3', 'integ/dev-1');
  git(main, 'push', '-q', 'origin', 'main');
  // 기차가 들어간 뒤 feature 커밋을 고쳐 amend 했다 — 작성자 정보는 같지만 들어간 사본보다 나중 커밋이라 고친 내용은 올라가지 않았다.
  writeFileSync(join(h, 'c.txt'), 'changed after landing');
  const later = new Date(Date.now() + 3600e3).toISOString();
  gitEnv(h, { GIT_COMMITTER_DATE: later }, 'commit', '-q', '-a', '--amend', '--no-edit');
  assert.deepEqual(rows(main), [
    ['integ-dev-1', 'integ-dev-1', 'integ/dev-1', 'ok'],
    ['WP-1', 'WP-1', 'fix/wp-1', 'ok'],
    ['WP-2', 'WP-2', 'fix/wp-2', 'unpushed'],
    ['WP-3', 'WP-3', 'fix/wp-3', 'unpushed'],
  ]);
});

test('worktree-sweep list·remove: 같은 키라도 <키>.dir 가 다른 폴더를 가리키는 작업은 이 워크트리 것이 아니다 — running 으로 보지 않고 결과도 지우지 않는다 (WP-1637)', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-10', 'fix/wp-10');
  // 아직 안 들어간 기차 — WP-10 이 첫 이슈라 기차 게이트를 키 WP-10 으로 띄웠다.
  const tw = addWorktree(main, 'integ-dev-1', 'integ/dev-1');
  assert.match(bg(main, 'start', 'WP-10', tw, '--', 'sleep', '30').stdout, /^started \d+/);
  t.after(() => bg(main, 'stop', 'WP-10'));
  assert.deepEqual(rows(main), [['WP-10', 'WP-10', 'fix/wp-10', 'ok']]);
  assert.equal(bg(main, 'stop', 'WP-10').stdout, 'ok\n');

  // 기차 게이트가 끝나 결과를 남겼다 — 기차 쪽이 아직 읽지 않았다.
  put(state(main, 'jobs', 'WP-10.exit'), '0\n');
  put(state(main, 'jobs', 'WP-10.log'), 'gate log');
  put(state(main, 'jobs', 'WP-10.dir'), `${realpathSync(tw)}\n`);
  const r = sweep(['remove', main, w, 'WP-10']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(existsSync(w), false);
  for (const e of ['exit', 'log', 'dir']) assert.equal(existsSync(state(main, 'jobs', `WP-10.${e}`)), true, e);

  // notes-only — <키>.dir 가 있는 폴더를 가리키면 그 작업 결과는 남기고, .dir 가 없는(옛) 작업 파일은 지금처럼 지운다.
  put(state(main, 'notes', 'WP-11.md'));
  put(state(main, 'jobs', 'WP-11.exit'), '0\n');
  put(state(main, 'jobs', 'WP-11.dir'), `${realpathSync(tw)}\n`);
  put(state(main, 'notes', 'WP-12.md'));
  put(state(main, 'jobs', 'WP-12.exit'), '0\n');
  const n = sweep(['remove', main, '-', 'WP-11,WP-12']);
  assert.equal(n.status, 0, n.stderr + n.stdout);
  for (const k of ['WP-11', 'WP-12']) assert.equal(existsSync(state(main, 'notes', `${k}.md`)), false, k);
  assert.equal(existsSync(state(main, 'jobs', 'WP-11.exit')), true);
  assert.equal(existsSync(state(main, 'jobs', 'WP-12.exit')), false);
});

test('worktree-sweep list·remove: 다른 키로 띄운 백그라운드 작업이라도 그 워크트리에서 돌면 running 이고 지우지 않는다 (WP-1637)', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'integ-dev-1', 'integ/dev-1');
  commit(w, 'a.txt', 'feat: a (WP-5)');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-5', 'integ/dev-1');
  git(main, 'push', '-q', 'origin', 'main');
  // 기차 게이트는 첫 이슈 키로 띄운다.
  assert.match(bg(main, 'start', 'WP-5', w, '--', 'sleep', '30').stdout, /^started \d+/);
  t.after(() => bg(main, 'stop', 'WP-5'));
  assert.deepEqual(rows(main), [['integ-dev-1', 'integ-dev-1', 'integ/dev-1', 'running']]);
  const r = sweep(['remove', main, w, 'integ-dev-1']);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.equal(r.stdout, `kept ${w}: 백그라운드 작업 도는 중\n`);
  assert.equal(existsSync(w), true);
  assert.equal(bg(main, 'status', 'WP-5').stdout, 'running\n');
});

test('worktree-sweep remove -: 그 키의 워크트리가 생겼으면 notes 를 지우지 않고 exit 3 (WP-1637)', (t) => {
  const main = repo(t);
  put(state(main, 'notes', 'WP-5.md'));
  assert.deepEqual(rows(main), [['WP-5', '-', '-', 'notes-only']]);
  // list 와 remove 사이에 같은 이슈를 다시 시작했다.
  const w = addWorktree(main, 'WP-5', 'fix/wp-5');
  const r = sweep(['remove', main, '-', 'WP-5']);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  // 경로는 git 이 적은 모양(실제 경로일 수 있다)이라 끝 이름만 맞춘다.
  assert.match(r.stdout, /^kept - WP-5: 워크트리가 있다\(\/.+\/\.claude\/worktrees\/WP-5\)\n$/);
  assert.equal(existsSync(state(main, 'notes', 'WP-5.md')), true);
  assert.equal(existsSync(w), true);
});

test('worktree-sweep remove: 워크트리·로컬 브랜치·notes·evidence·jobs·seen·sweep(정리 보류 기록) 을 지우고 원격 브랜치와 다른 이슈 것은 남긴다', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-1', 'fix/wp-1');
  commit(w, 'a.txt', 'fix: a (WP-1)');
  git(w, 'push', '-q', 'origin', 'fix/wp-1');
  put(join(w, 'node_modules', 'a.js'));
  for (const k of ['WP-1', 'WP-11']) {
    put(state(main, 'notes', `${k}.md`));
    put(state(main, 'evidence', k, 'shot.png'));
    put(state(main, 'jobs', `${k}.exit`), '0\n');
    put(state(main, 'seen', k));
    put(state(main, 'sweep', k), '올리지 않은 커밋\n');
  }
  // 이 세션이 그 워크트리 안에 있어도(부른 곳이 워크트리) 지운다.
  const r = spawnSync(join(scripts, 'worktree-sweep'), ['remove', main, w, 'WP-1'], { cwd: w, encoding: 'utf8', env: env() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `removed ${w}\n`);
  assert.equal(existsSync(w), false);
  assert.equal(spawnSync('git', ['-C', main, 'rev-parse', '-q', '--verify', 'refs/heads/fix/wp-1']).status, 1);
  assert.match(git(main, 'ls-remote', 'origin', 'fix/wp-1'), /refs\/heads\/fix\/wp-1/);
  for (const p of [['notes', 'WP-1.md'], ['evidence', 'WP-1'], ['jobs', 'WP-1.exit'], ['seen', 'WP-1'], ['sweep', 'WP-1']]) {
    assert.equal(existsSync(state(main, ...p)), false, p.join('/'));
  }
  for (const p of [['notes', 'WP-11.md'], ['evidence', 'WP-11'], ['jobs', 'WP-11.exit'], ['seen', 'WP-11'], ['sweep', 'WP-11']]) {
    assert.equal(existsSync(state(main, ...p)), true, p.join('/'));
  }
});

test('worktree-sweep remove: 커밋 안 한 변경·잠김이면 지우지 않고 kept <경로>: <이유> 로 exit 3', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-2', 'fix/wp-2');
  writeFileSync(join(w, 'new.txt'), 'x');
  // 끝난 작업 파일 — 남길 때는 백그라운드 작업 파일도 건드리지 않는다(검사가 bg-job 보다 먼저).
  put(state(main, 'jobs', 'WP-2.exit'), '0\n');
  const r = sweep(['remove', main, w, 'WP-2']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, `kept ${w}: 커밋 안 한 변경 1개\n`);
  assert.equal(existsSync(join(w, 'new.txt')), true);
  assert.equal(existsSync(state(main, 'notes', 'WP-2.md')), true);
  assert.equal(existsSync(state(main, 'jobs', 'WP-2.exit')), true);

  const w3 = addWorktree(main, 'WP-3', 'fix/wp-3');
  git(main, 'worktree', 'lock', '.claude/worktrees/WP-3');
  put(state(main, 'jobs', 'WP-3.exit'), '0\n');
  const l = sweep(['remove', main, w3, 'WP-3']);
  assert.equal(l.status, 3);
  assert.match(l.stdout, /^kept .+: .+/);
  assert.equal(existsSync(w3), true);
  assert.equal(existsSync(state(main, 'jobs', 'WP-3.exit')), true);
});

test('worktree-sweep remove: 올리지 않은 커밋이 있으면 워크트리·브랜치를 지우지 않고 exit 3, 같은 patch 가 origin/main 에 들어간 feature 브랜치는 지운다', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-1', 'fix/wp-1');
  commit(w, 'a.txt', 'fix: a (WP-1)');
  commit(w, 'b.txt', 'fix: b (WP-1)');
  put(state(main, 'jobs', 'WP-1.exit'), '0\n');
  const r = sweep(['remove', main, w, 'WP-1']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, `kept ${w}: 올리지 않은 커밋 2개\n`);
  assert.equal(existsSync(w), true);
  assert.equal(git(main, 'rev-parse', '--verify', 'refs/heads/fix/wp-1').length > 0, true);
  assert.equal(existsSync(state(main, 'notes', 'WP-1.md')), true);
  assert.equal(existsSync(state(main, 'jobs', 'WP-1.exit')), true);

  // 기차 흐름 — feature 커밋을 기차에 cherry-pick 하고 기차를 merge 로 들여보냈다(feature·기차 브랜치 모두 원격에 없다).
  const f = addWorktree(main, 'WP-2', 'fix/wp-2');
  commit(f, 'c.txt', 'fix: c (WP-2)');
  const tw = addWorktree(main, 'integ-dev-1', 'integ/dev-1');
  git(tw, 'cherry-pick', 'fix/wp-2');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-2', 'integ/dev-1');
  git(main, 'push', '-q', 'origin', 'main');
  const g = sweep(['remove', main, f, 'WP-2']);
  assert.equal(g.status, 0, g.stderr + g.stdout);
  assert.equal(existsSync(f), false);
  const i = sweep(['remove', main, tw, 'integ-dev-1']);
  assert.equal(i.status, 0, i.stderr + i.stdout);
  assert.equal(existsSync(tw), false);
});

test('worktree-sweep remove: 백그라운드 작업이 돌고 있으면 끝내지 않고 지우지도 않고 exit 3 — 끝난 작업은 파일을 지우고 워크트리를 지운다', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-5', 'fix/wp-5');
  // 기차는 첫 키로 작업을 띄우므로 키 중 하나라도 돌면 남긴다.
  const started = bg(main, 'start', 'WP-5', w, '--', 'sleep', '30');
  assert.match(started.stdout, /^started \d+/);
  t.after(() => bg(main, 'stop', 'WP-5'));
  const r = sweep(['remove', main, w, 'WP-4,WP-5']);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.equal(r.stdout, `kept ${w}: 백그라운드 작업 도는 중\n`);
  assert.equal(existsSync(w), true);
  assert.equal(bg(main, 'status', 'WP-5').stdout, 'running\n');

  assert.equal(bg(main, 'stop', 'WP-5').status, 0);
  put(state(main, 'jobs', 'WP-5.exit'), '1\n');
  put(state(main, 'jobs', 'WP-5.log'), 'log');
  const d = sweep(['remove', main, w, 'WP-5']);
  assert.equal(d.status, 0, d.stderr + d.stdout);
  assert.equal(existsSync(w), false);
  for (const e of ['exit', 'log', 'pid']) assert.equal(existsSync(state(main, 'jobs', `WP-5.${e}`)), false, e);
});

test('worktree-sweep remove: 들어간 기차 워크트리는 기차 이름 하나로 워크트리·로컬 기차 브랜치·기차 notes 를 지우고 실린 이슈 notes 는 남긴다', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'integ-dev-1', 'integ/dev-1');
  commit(w, 'a.txt', 'feat: a (WP-12)');
  git(w, 'push', '-q', 'origin', 'integ/dev-1');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-12', 'integ/dev-1');
  git(main, 'push', '-q', 'origin', 'main');
  for (const n of ['WP-12', 'integ-dev-1', 'integ-dev-2']) put(state(main, 'notes', `${n}.md`));
  const r = sweep(['remove', main, w, 'integ-dev-1']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(w), false);
  assert.equal(spawnSync('git', ['-C', main, 'rev-parse', '-q', '--verify', 'refs/heads/integ/dev-1']).status, 1);
  assert.match(git(main, 'ls-remote', 'origin', 'integ/dev-1'), /refs\/heads\/integ\/dev-1/);
  assert.equal(existsSync(state(main, 'notes', 'integ-dev-1.md')), false);
  for (const n of ['WP-12', 'integ-dev-2']) assert.equal(existsSync(state(main, 'notes', `${n}.md`)), true, n);
});

test('worktree-sweep remove: 손으로 지운 워크트리 폴더도 등록을 지우고 브랜치를 지운다 — notes-only(-)는 notes 만 지운다', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-7', 'fix/wp-7');
  rmSync(w, { recursive: true, force: true });
  // 같이 손으로 지운 다른 워크트리의 등록은 남긴다(전역 git worktree prune 을 하지 않는다).
  const w70 = addWorktree(main, 'WP-70', 'fix/wp-70');
  rmSync(w70, { recursive: true, force: true });
  assert.deepEqual(rows(main), [['WP-7', 'WP-7', 'fix/wp-7', 'ok'], ['WP-70', 'WP-70', 'fix/wp-70', 'ok']]);
  const r = sweep(['remove', main, w, 'WP-7']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(git(main, 'worktree', 'list', '--porcelain'), /WP-7\n/);
  assert.match(git(main, 'worktree', 'list', '--porcelain'), /WP-70/);
  assert.equal(spawnSync('git', ['-C', main, 'rev-parse', '-q', '--verify', 'refs/heads/fix/wp-7']).status, 1);

  put(state(main, 'notes', 'WP-8.md'));
  put(state(main, 'notes', 'WP-80.md'));
  const n = sweep(['remove', main, '-', 'WP-8']);
  assert.equal(n.status, 0, n.stderr);
  assert.equal(n.stdout, 'removed - WP-8\n');
  assert.equal(existsSync(state(main, 'notes', 'WP-8.md')), false);
  assert.equal(existsSync(state(main, 'notes', 'WP-80.md')), true);
});

test('worktree-sweep remove: 다른 워크트리에서 체크아웃된 브랜치는 지우지 못해도 경고만 하고 워크트리는 지운다', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-9', 'fix/wp-9');
  // 같은 브랜치를 다른 워크트리에서도 쓰는 경우(--force 로 두 번 체크아웃)
  git(main, 'worktree', 'add', '-q', '-f', join(main, '..', 'other'), 'fix/wp-9');
  const r = sweep(['remove', main, w, 'WP-9']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(w), false);
  assert.match(r.stderr, /fix\/wp-9/);
  assert.equal(readFileSync(join(main, '..', 'other', '.gitignore'), 'utf8').length > 0, true);
});

test('worktree-sweep: 사용법 오류·등록 안 된 경로·이상한 키·.claude/worktrees 밖 경로면 exit 2', (t) => {
  const main = repo(t);
  assert.equal(sweep([]).status, 2);
  assert.equal(sweep(['list']).status, 2);
  assert.equal(sweep(['list', main]).status, 2);
  assert.equal(sweep(['list', join(main, 'nope'), 'WP', 'dev']).status, 2);
  assert.equal(sweep(['list', main, 'W/P', 'dev']).status, 2);
  assert.equal(sweep(['list', main, 'WP', 'a/b']).status, 2);
  assert.equal(sweep(['list', main, 'WP', 'me']).status, 2);
  assert.equal(sweep(['prune', main]).status, 2);
  assert.equal(sweep(['remove', main, join(main, '.claude', 'worktrees', 'WP-1'), 'WP-1']).status, 2);
  const w = addWorktree(main, 'WP-2', 'fix/wp-2');
  // 끝 이름만 같은 다른 곳의 경로는 받지 않는다.
  const other = join(main, '..', 'other', '.claude', 'worktrees', 'WP-2');
  mkdirSync(other, { recursive: true });
  assert.equal(sweep(['remove', main, other, 'WP-2']).status, 2);
  assert.equal(sweep(['remove', main, join(main, '..', 'gone', '.claude', 'worktrees', 'WP-2'), 'WP-2']).status, 2);
  assert.equal(sweep(['remove', main, '.claude/worktrees/WP-2', 'WP-2']).status, 2, '부른 곳 기준 상대 경로 — 여기는 MAIN 이 아니다');
  assert.equal(sweep(['remove', main, w, '../x']).status, 2);
  assert.equal(sweep(['remove', main, w, '']).status, 2);
  assert.equal(sweep(['remove', main, w]).status, 2);
  assert.equal(existsSync(w), true);
});

test('worktree-sweep remove: 부른 곳 기준 상대 경로·끝 /·..·심볼릭 링크로 적어도 정규화해 등록된 경로와 같으면 지운다', (t) => {
  const main = repo(t);
  const w1 = addWorktree(main, 'WP-1', 'fix/wp-1');
  const a = spawnSync(join(scripts, 'worktree-sweep'), ['remove', main, '.claude/worktrees/WP-1/', 'WP-1'], { cwd: main, encoding: 'utf8', env: env() });
  assert.equal(a.status, 0, a.stderr + a.stdout);
  assert.equal(existsSync(w1), false);
  const w2 = addWorktree(main, 'WP-2', 'fix/wp-2');
  const b = sweep(['remove', main, join(main, '.claude', 'worktrees', '..', 'worktrees', 'WP-2'), 'WP-2']);
  assert.equal(b.status, 0, b.stderr + b.stdout);
  assert.equal(existsSync(w2), false);
  // MAIN 을 가리키는 심볼릭 링크로 적은 경로, 폴더를 손으로 지운 경우도 같다.
  const w3 = addWorktree(main, 'WP-3', 'fix/wp-3');
  const link = join(main, '..', 'link');
  symlinkSync(main, link);
  rmSync(w3, { recursive: true, force: true });
  const c = sweep(['remove', main, join(link, '.claude', 'worktrees', 'WP-3'), 'WP-3']);
  assert.equal(c.status, 0, c.stderr + c.stdout);
  assert.doesNotMatch(git(main, 'worktree', 'list', '--porcelain'), /WP-3/);
});
