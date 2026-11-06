// 작업 공간 이미지 엔트리포인트 테스트의 공용 도구 — Claude Code·Gen:iA Code·Codex 이미지의 tests/entrypoint.test.mjs 가 함께 쓴다.
// 이미지마다 다른 것(가짜 명령·플러그인 폴더·config)은 각 테스트의 fixture 에 두고, 여기에는 모양이 같은 것만 둔다:
// tmux 가 있을 때만 도는 테스트, 실행 파일 쓰기, bare 저장소, 격리 tmux 서버, lib.sh 함수 부르기, 엔트리포인트 띄우기·기다리기, 감독 회차 수.
// 이름이 *.test.mjs 가 아니어서 node --test tests/*.test.mjs 가 테스트로 돌리지 않는다. 이미지에는 들어가지 않는다(tests/ 는 COPY 하지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const hasTmux = spawnSync('tmux', ['-V']).status === 0;
/** tmux 가 없으면 건너뛰는 테스트(칸·감독을 진짜 tmux 로 돌리는 것). */
export const tmuxTest = (name, fn) => test(name, { skip: !hasTmux && 'tmux 없음' }, fn);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 실행 파일 하나를 쓴다(가짜 명령·tmux 감싸개). */
export const exe = (path, body) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

/** 원격 저장소(bare) 하나 — files(경로 → 내용)를 첫 커밋으로 둔 저장소를 root/remote.git 에 만든다. 칸을 띄울 프로젝트 저장소. */
export function bareRepo(root, files = { 'README.md': 'repo\n' }) {
  const src = join(root, 'src');
  const bare = join(root, 'remote.git');
  mkdirSync(src, { recursive: true });
  for (const [p, body] of Object.entries(files)) writeFileSync(join(src, p), body);
  const git = (cwd, ...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git(src, 'init', '-q');
  git(src, 'add', '.');
  git(src, 'commit', '-q', '-m', 'init');
  git(root, 'clone', '-q', '--bare', src, bare);
  return bare;
}

let seq = 0;
/**
 * 테스트마다 격리한 tmux 서버(-L) — binDir 에 감싸개(tmux-test)를 만들어 GW_TMUX 로 넘긴다(사람의 tmux 서버를 건드리지 않게).
 * 돌려주는 tmux(...인자) 는 같은 서버에 명령을 보낸다.
 */
export function isolatedTmux(binDir, prefix) {
  const wrapper = join(binDir, 'tmux-test');
  exe(wrapper, `#!/bin/sh\nexec tmux -L ${prefix}-${process.pid}-${++seq} -f /dev/null "$@"\n`);
  return { wrapper, tmux: (...a) => spawnSync(wrapper, a, { encoding: 'utf8' }) };
}

/** 셸 파일들(libs — 앞에서부터 읽는다)을 읽고 함수(셸 한 줄)를 부른다. */
export function callLib(libs, env, script) {
  return spawnSync('bash', ['-c', `${libs.map((l) => `. "${l}" && `).join('')}${script}`], { env, encoding: 'utf8' });
}

/** 같은 것을 비동기로 — 같은 프로세스의 가짜 HTTP 서버(마켓플레이스 등)가 응답할 수 있게(spawnSync 는 이벤트 루프를 막는다). */
export function callLibAsync(libs, env, script) {
  return new Promise((resolve) => {
    const c = spawn('bash', ['-c', `${libs.map((l) => `. "${l}" && `).join('')}${script}`], { env });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b) => (stdout += b));
    c.stderr.on('data', (b) => (stderr += b));
    c.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

/** 엔트리포인트를 뒤에서 띄운다 — 끝나기를 기다리는 exited 와 지금까지의 로그. 테스트가 끝나면 남아 있으면 끈다. */
export function startEntrypoint(t, entrypoint, env) {
  const child = spawn(entrypoint, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return { child, exited, log: () => log };
}

/** cond 가 참이 될 때까지 기다린다 — 시간이 지나면 what 과 로그를 담아 실패. */
export async function until(cond, what, ms = 30000, log = () => '') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(100);
  }
  assert.fail(`기다리다 시간이 지났습니다: ${what}\n${log()}`);
}

/** 지금까지 돈 감독 회차 수(lib.sh tick 이 <AI 폴더>/state/supervise-ticks 에 적는다) — 시간 대신 회차를 기다린다. */
export function ticks(aiDir) {
  try {
    return Number(readFileSync(join(aiDir, 'state', 'supervise-ticks'), 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}
