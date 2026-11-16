// WP-1637 work-loop 끝난 이슈 정리(worktree-sweep) 테스트 — 임시 저장소(origin 은 bare)로 워크트리·브랜치·실행 상태 파일을 만들어
// list 가 정리 후보와 상태를 바르게 내는지, remove 가 지울 것만 지우고 남길 때는 이유와 종료 코드를 내는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
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
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env() });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function sweep(args, extra = {}) {
  return spawnSync(join(scripts, 'worktree-sweep'), args, { encoding: 'utf8', env: env(extra) });
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

function addWorktree(main, name, branch) {
  git(main, 'worktree', 'add', '-q', `.claude/worktrees/${name}`, '-b', branch, 'origin/main');
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

test('worktree-sweep list: 기차는 main 에 들어간 내 기차만 폴더 이름을 키로 낸다 — 안 들어간 기차·다른 AI 의 기차는 내지 않는다', (t) => {
  const main = repo(t);
  // merge 커밋으로 들어간 기차
  const w2 = addWorktree(main, 'integ-dev-2', 'integ/dev-2');
  commit(w2, 'a.txt', 'feat: a (WP-21)');
  git(w2, 'push', '-q', 'origin', 'integ/dev-2');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge: 통합 WP-21', 'integ/dev-2');
  git(main, 'push', '-q', 'origin', 'main');
  // 빨리 감기로 들어간 기차(원격에 기차 브랜치 없음 — main 에 있으니 올라간 것이다)
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
    ['integ-dev-3', 'integ-dev-3', 'integ/dev-3', 'ok'],
  ]);
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

test('worktree-sweep list: 워크트리 없이 남은 notes 는 notes-only — WP-37 notes 는 WP-377 워크트리와 헷갈리지 않고, 내 기차 notes 만 낸다', (t) => {
  const main = repo(t);
  addWorktree(main, 'WP-377', 'fix/wp-377');
  put(state(main, 'notes', 'WP-377.md'));
  put(state(main, 'notes', 'WP-37.md'));
  // 아직 안 들어간 기차 — 줄로 내지 않고, 그 notes 도 워크트리가 있으니 notes-only 가 아니다.
  const w = addWorktree(main, 'integ-dev-4', 'integ/dev-4');
  commit(w, 'a.txt', 'feat: a (WP-40)');
  git(w, 'push', '-q', 'origin', 'integ/dev-4');
  for (const n of ['integ-dev-4', 'integ-dev-9', 'integ-other-9', 'ZZ-5', 'scratch']) put(state(main, 'notes', `${n}.md`));
  assert.deepEqual(rows(main), [
    ['integ-dev-9', '-', '-', 'notes-only'],
    ['WP-37', '-', '-', 'notes-only'],
    ['WP-377', 'WP-377', 'fix/wp-377', 'ok'],
  ]);
});

test('worktree-sweep remove: 워크트리·로컬 브랜치·notes·evidence·jobs·seen 을 지우고 원격 브랜치와 다른 이슈 것은 남긴다', (t) => {
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
  }
  // 이 세션이 그 워크트리 안에 있어도(부른 곳이 워크트리) 지운다.
  const r = spawnSync(join(scripts, 'worktree-sweep'), ['remove', main, w, 'WP-1'], { cwd: w, encoding: 'utf8', env: env() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `removed ${w}\n`);
  assert.equal(existsSync(w), false);
  assert.equal(spawnSync('git', ['-C', main, 'rev-parse', '-q', '--verify', 'refs/heads/fix/wp-1']).status, 1);
  assert.match(git(main, 'ls-remote', 'origin', 'fix/wp-1'), /refs\/heads\/fix\/wp-1/);
  for (const p of [['notes', 'WP-1.md'], ['evidence', 'WP-1'], ['jobs', 'WP-1.exit'], ['seen', 'WP-1']]) {
    assert.equal(existsSync(state(main, ...p)), false, p.join('/'));
  }
  for (const p of [['notes', 'WP-11.md'], ['evidence', 'WP-11'], ['jobs', 'WP-11.exit'], ['seen', 'WP-11']]) {
    assert.equal(existsSync(state(main, ...p)), true, p.join('/'));
  }
});

test('worktree-sweep remove: 커밋 안 한 변경·잠김이면 지우지 않고 kept <경로>: <이유> 로 exit 3', (t) => {
  const main = repo(t);
  const w = addWorktree(main, 'WP-2', 'fix/wp-2');
  writeFileSync(join(w, 'new.txt'), 'x');
  put(state(main, 'notes', 'WP-2.md'));
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
  put(state(main, 'notes', 'WP-1.md'));
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
  const bg = (...a) => spawnSync(join(scripts, 'bg-job'), [a[0], main, ...a.slice(1)], { encoding: 'utf8', env: env() });
  // 기차는 첫 키로 작업을 띄우므로 키 중 하나라도 돌면 남긴다.
  const started = bg('start', 'WP-5', w, '--', 'sleep', '30');
  assert.match(started.stdout, /^started \d+/);
  t.after(() => bg('stop', 'WP-5'));
  const r = sweep(['remove', main, w, 'WP-4,WP-5']);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.equal(r.stdout, `kept ${w}: 백그라운드 작업 도는 중\n`);
  assert.equal(existsSync(w), true);
  assert.equal(bg('status', 'WP-5').stdout, 'running\n');

  assert.equal(bg('stop', 'WP-5').status, 0);
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
