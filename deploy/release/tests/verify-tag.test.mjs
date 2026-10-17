// 릴리스 태그 검증(verify-tag.mjs) 테스트 (WP-442) — git 은 가짜 exec(실제 저장소·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isReleaseBranch, main, verifyTag } from '../verify-tag.mjs';
import { REPO, SHA, makeTmp } from './helpers.mjs';

/** 태그 검증에 필요한 git 질의만 답하는 가짜 exec. */
function gitFake({ branches = ['origin/main'], hasNote = true, merged = ['v0.8.0', 'v0.9.0'], allTags = merged, shallow = false } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args.join(' '));
    const line = args.join(' ');
    if (line === 'rev-parse v0.9.0^{commit}') return { stdout: `${SHA}\n` };
    if (line.startsWith('branch -r --contains')) return { stdout: branches.join('\n') };
    if (line.startsWith('cat-file -e')) {
      if (!hasNote) throw new Error('fatal: path does not exist');
      return { stdout: '' };
    }
    if (line === 'rev-parse --is-shallow-repository') return { stdout: `${shallow}\n` };
    if (line === `tag --merged ${SHA} --list v*`) return { stdout: merged.join('\n') };
    if (line === 'tag --list v*') return { stdout: allTags.join('\n') };
    throw new Error(`예상 못한 git 호출: ${line}`);
  };
  exec.calls = calls;
  return exec;
}

test('main 에 포함된 태그 + 노트 있음 → 기준(v0.8.0)과 버전을 돌려준다', () => {
  const r = verifyTag({ tag: 'v0.9.0', exec: gitFake(), repoRoot: REPO });
  assert.deepEqual(r, { version: '0.9.0', commit: SHA, baseTag: 'v0.8.0', baseVersion: '0.8.0' });
});

test('hotfix/* 에만 포함된 태그도 허용, 기능 브랜치에만 있으면 거부', () => {
  assert.equal(verifyTag({ tag: 'v0.9.0', exec: gitFake({ branches: ['origin/hotfix/0.8.0'] }), repoRoot: REPO }).baseTag, 'v0.8.0');
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ branches: ['origin/feat/x'] }), repoRoot: REPO }), /origin\/main 이나 origin\/hotfix/);
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ branches: [] }), repoRoot: REPO }), /포함 브랜치: 없음/);
});

test('isReleaseBranch: main·hotfix/* 만', () => {
  assert.equal(isReleaseBranch('origin/main'), true);
  assert.equal(isReleaseBranch('origin/hotfix/0.9.1'), true);
  assert.equal(isReleaseBranch('origin/mainline'), false);
  assert.equal(isReleaseBranch('origin/develop'), false);
});

test('태그 형식이 아니면 git 을 부르기 전에 거부한다', () => {
  const exec = gitFake();
  for (const tag of ['0.9.0', 'v0.9', 'v0.9.0-rc1', 'genia-works--v0.1.4']) {
    assert.throws(() => verifyTag({ tag, exec, repoRoot: REPO }), /릴리스 태그 형식/);
  }
  assert.equal(exec.calls.length, 0);
});

test('releases/<버전>.md 가 없으면 거부한다', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ hasNote: false }), repoRoot: REPO }), /releases\/0\.9\.0\.md 가 없다/);
});

test('기준은 HEAD 가 아니라 태그 커밋의 조상에서 찾는다', () => {
  const exec = gitFake();
  verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO });
  assert.ok(exec.calls.includes(`tag --merged ${SHA} --list v*`));
  assert.ok(!exec.calls.some((c) => c.includes('HEAD')));
});

test('조상에 같거나 더 높은 버전이 있으면 거부한다(순서가 뒤집힌 태그)', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ merged: ['v0.8.0', 'v0.10.0', 'v0.9.0'] }), repoRoot: REPO }), /v0\.9\.0 가 기준 릴리스 v0\.10\.0 보다 높지 않다/);
});

test('조상에 기준 태그가 없으면 거부한다(얕은 clone 이면 findBase 가 먼저 멈춘다)', () => {
  // 태그 자신만 있을 때 findBase 의 --allow-no-base 안내가 아니라 시드 안내를 낸다(verify-tag 엔 그 옵션이 없다).
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ merged: ['v0.9.0'] }), repoRoot: REPO }), (e) => /먼저 태그·시드한다/.test(e.message) && !/allow-no-base/.test(e.message));
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ shallow: true }), repoRoot: REPO }), /GIT_DEPTH/);
});

test('main: --env-out 에 VERSION·BASE_TAG·BASE_VERSION 을 dotenv 로 쓴다', async () => {
  const dir = makeTmp('verify-tag-test-');
  const out = join(dir, 'release.env');
  const logs = [];
  await main(['--tag', 'v0.9.0', '--env-out', out], { repoRoot: REPO, exec: gitFake(), log: (l) => logs.push(l) });
  assert.equal(readFileSync(out, 'utf8'), 'VERSION=0.9.0\nBASE_TAG=v0.8.0\nBASE_VERSION=0.8.0\n');
  assert.ok(logs.some((l) => l.includes('검증 통과')));
  rmSync(dir, { recursive: true, force: true });
});

test('main: --tag 가 없으면 거부한다', async () => {
  await assert.rejects(main([], { repoRoot: REPO, exec: gitFake(), log: () => {} }), /--tag 가 필요하다/);
});
