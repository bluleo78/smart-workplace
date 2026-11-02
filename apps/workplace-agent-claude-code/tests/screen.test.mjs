// agent-screen 테스트(WP-1277) — 진짜 tmux 를 테스트마다 격리한 서버(-L)로 띄워 보기 세션·읽기 전용·창 고르기·정리를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const screen = join(here, '..', 'bin', 'agent-screen');
let seq = 0;

/** 격리 tmux 와 AI 세션(창 WP·events, 240x60) 하나를 준비한다. AI 이름에 . 이 있어도 tmux 이름 규칙(. → _)대로 찾는지 함께 본다. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gw-screen-'));
  const sock = `gwscreen-${process.pid}-${++seq}`;
  const wrapper = join(root, 'tmux');
  writeFileSync(wrapper, `#!/bin/sh\nexec tmux -L ${sock} -f /dev/null "$@"\n`);
  chmodSync(wrapper, 0o755);
  const tmux = (...a) => spawnSync(wrapper, a, { encoding: 'utf8' });
  tmux('new-session', '-d', '-s', 'kodi_dev', '-n', 'WP', '-x', '240', '-y', '60', 'sleep 600');
  tmux('new-window', '-d', '-t', '=kodi_dev:', '-n', 'events', 'sleep 600');
  t.after(() => tmux('kill-server'));
  const env = { PATH: process.env.PATH, HOME: root, GW_TMUX: wrapper, GENIA_AGENT_NAME: 'kodi.dev' };
  const run = (...a) => spawnSync(screen, a, { env, encoding: 'utf8' });
  return { tmux, run, env };
}

/** 가짜 터미널(script)로 attach 를 띄운다 — exec 의 tty 자리. */
function attach(f, args) {
  const cmd = [screen, 'attach', ...args].map((a) => `'${a}'`).join(' ');
  const argv = process.platform === 'darwin' ? ['-q', '/dev/null', 'sh', '-c', `stty cols 90 rows 30; ${cmd}`] : ['-qc', `stty cols 90 rows 30; ${cmd}`, '/dev/null'];
  return spawn('script', argv, { env: f.env, stdio: 'ignore' });
}

async function waitFor(fn, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  return fn();
}

test('windows: 창 번호·이름·크기·보는 창을 탭으로, 세션이 없으면 3', (t) => {
  const f = fixture(t);
  const r = f.run('windows');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['0\tWP\t240\t60\t1', '1\tevents\t240\t60\t0']);
  f.tmux('kill-session', '-t', '=kodi_dev');
  assert.equal(f.run('windows').status, 3);
});

test('attach: 읽기 전용 보기 세션 — 보는 동안 창이 관리자 크기를 따르고 AI 현재 창은 그대로, 끝나면 보기 세션을 지우고 크기를 되돌린다', async (t) => {
  const f = fixture(t);
  const p = attach(f, ['s-1']);
  t.after(() => p.kill());
  const flags = await waitFor(() => f.tmux('list-clients', '-F', '#{client_session} #{client_flags}').stdout.trim());
  assert.match(flags, /^gw-view-s-1 .*read-only/);
  // 보는 동안은 관리자 터미널(90x30, 상태 줄 1)에 맞춘다
  await waitFor(() => f.tmux('display-message', '-p', '-t', '=kodi_dev:0', '#{window_width}x#{window_height}').stdout.trim() === '90x29');

  assert.equal(f.run('select', 's-1', '1').status, 0);
  const lines = f.run('windows', 's-1').stdout.trim().split('\n');
  assert.deepEqual(lines, ['0\tWP\t90\t29\t0', '1\tevents\t90\t29\t1']);
  // AI 세션의 현재 창은 그대로
  assert.equal(f.tmux('display-message', '-p', '-t', '=kodi_dev:', '#{window_index}').stdout.trim(), '0');

  p.kill('SIGHUP');
  const gone = await waitFor(() => f.tmux('has-session', '-t', '=gw-view-s-1').status !== 0);
  assert.ok(gone, '보기 세션이 남았다');
  const restored = await waitFor(() => f.tmux('display-message', '-p', '-t', '=kodi_dev:0', '#{window_width}x#{window_height}').stdout.trim() === '240x60');
  assert.ok(restored, 'AI 창 크기가 되돌아오지 않았다');
});

test('attach --input: read-only 없이 붙고, 남은 보기 세션(붙은 클라이언트 없음)은 치운다', async (t) => {
  const f = fixture(t);
  f.tmux('new-session', '-d', '-t', '=kodi_dev', '-s', 'gw-view-old');
  const p = attach(f, ['s-2', '--input', '--window', '1']);
  t.after(() => p.kill());
  const flags = await waitFor(() => f.tmux('list-clients', '-F', '#{client_session} #{client_flags}').stdout.trim());
  assert.match(flags, /^gw-view-s-2 /);
  assert.doesNotMatch(flags, /read-only/);
  assert.equal(f.tmux('display-message', '-p', '-t', '=gw-view-s-2:', '#{window_index}').stdout.trim(), '1');
  assert.notEqual(f.tmux('has-session', '-t', '=gw-view-old').status, 0);
});

test('사용법: 세션 id·창 번호 형식이 아니면 2', (t) => {
  const f = fixture(t);
  assert.equal(f.run('attach', 'a;b').status, 2);
  assert.equal(f.run('select', 's-1', 'x').status, 2);
  assert.equal(f.run('nope').status, 2);
});
