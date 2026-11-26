// 릴리스 태그 검증(verify-tag.mjs) 테스트 (WP-442) — git 은 가짜 exec(실제 저장소·네트워크 없음). 마지막의 `--` 스모크만 실제 git 을 쓴다(설치된 git 이 `--` 를 받아들이는지).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LS_REMOTE_TIMEOUT_MS, isReleaseBranch, main, verifyTag } from '../verify-tag.mjs';
import { MARKETPLACE_URL, REPO, SHA, answerAbandoned, makeTmp, marketplaceWithRef } from './helpers.mjs';
import { MARKETPLACE_PATH } from '../lib/build.mjs';

/**
 * 태그 검증에 필요한 git 질의만 답하는 가짜 exec — lsRemoteThrows 를 주면 ls-remote 만 네트워크 오류처럼 던진다.
 * ls-remote 는 marketplace `source.url`(설치 주소)로 온 호출에만 답한다 — 게이트가 다른 원격(GitLab origin)을 묻는 순간
 * 「예상 못한 git 호출」 으로 실패해, 대상이 url 인지 테스트가 잡는다(WP-2138).
 */
function gitFake({ branches = ['origin/main'], hasNote = true, merged = ['v0.8.0', 'v0.9.0'], allTags = merged, shallow = false, abandoned = null, leftNotes = [], marketplace = marketplaceWithRef('genia-works--v0.1.78'), pluginTag = 'genia-works--v0.1.78', lsRemoteThrows = false } = {}) {
  const calls = [];
  const optsSeen = [];
  const exec = (cmd, args, opts) => {
    calls.push(args.join(' '));
    optsSeen.push({ line: args.join(' '), opts });
    const line = args.join(' ');
    if (line === 'rev-parse v0.9.0^{commit}') return { stdout: `${SHA}\n` };
    if (line.startsWith('branch -r --contains')) return { stdout: branches.join('\n') };
    if (line.startsWith('cat-file -e')) {
      // 버린 버전의 노트는 leftNotes 에 든 것만 남아 있다.
      const abandonedNote = /:releases\/(\d+\.\d+\.\d+)\.md$/.exec(line)?.[1];
      // 검증하는 태그 자신(v0.9.0)의 노트는 hasNote 를 따른다.
      if (abandonedNote && abandonedNote !== '0.9.0' && abandoned?.[abandonedNote] !== undefined) {
        if (!leftNotes.includes(abandonedNote)) throw new Error('fatal: path does not exist');
        return { stdout: '' };
      }
      if (!hasNote) throw new Error('fatal: path does not exist');
      return { stdout: '' };
    }
    if (line === 'rev-parse --is-shallow-repository') return { stdout: `${shallow}\n` };
    const a = answerAbandoned(line, abandoned);
    if (a) return a;
    // marketplace: null 이면 파일 없음, pluginTag: null 이면 설치 주소에 없음
    // (answerAbandoned 뒤에 둔다 — 버린 릴리스의 `show` 답변을 가로채지 않게)
    if (line.startsWith('show ')) {
      if (marketplace === null) throw new Error('fatal: path ... did not match any files');
      // 읽는 위치가 태그 커밋인지를 고정한다 — HEAD(워킹트리)를 읽으면 CI 와 로컬에서 결과가 갈린다.
      if (line !== `show ${SHA}:${MARKETPLACE_PATH}`) throw new Error(`태그 커밋이 아닌 곳에서 marketplace.json 을 읽었다: ${line}`);
      return { stdout: marketplace };
    }
    // url 은 `--` 뒤에 온다 — 값을 옵션으로 읽히지 않게 막는다(WP-2138 리뷰 후속 ②).
    const ls = /^ls-remote --tags -- (\S+) refs\/tags\/(.+)$/.exec(line);
    if (ls) {
      const [, target, tag] = ls;
      // 설치 주소가 아닌 원격(GitLab origin 등)에 물으면 실패 — 대상이 url 인지를 테스트가 잡는다(WP-2138).
      if (target !== MARKETPLACE_URL) throw new Error(`설치 주소가 아닌 곳에 물었다: ${line}`);
      // 네트워크 오류는 defaultExec 이 던지는 모양 그대로 — 메시지가 안내 문구로 바뀌지 않는지 확인하는 데 쓴다.
      if (lsRemoteThrows) throw new Error(`git ${line} 실패 (종료 코드 128)\nfatal: unable to access 'https://github.com/bluleo78/smart-workplace/'`);
      return { stdout: pluginTag === tag ? `${SHA} refs/tags/${tag}\n` : '' };
    }
    if (line === `tag --merged ${SHA} --list v*`) return { stdout: merged.join('\n') };
    if (line === 'tag --list v*') return { stdout: allTags.join('\n') };
    throw new Error(`예상 못한 git 호출: ${line}`);
  };
  exec.calls = calls;
  exec.opts = optsSeen;
  return exec;
}

test('main 에 포함된 태그 + 노트 있음 → 기준(v0.8.0)과 버전을 돌려준다', () => {
  const r = verifyTag({ tag: 'v0.9.0', exec: gitFake(), repoRoot: REPO });
  assert.deepEqual(r, { version: '0.9.0', commit: SHA, baseTag: 'v0.8.0', baseVersion: '0.8.0', pluginTag: 'genia-works--v0.1.78', pluginUrl: MARKETPLACE_URL });
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
  // CI 로그로 「무엇을 확인했는지」 가 남는다(WP-2138) — 설치 주소와 플러그인 태그가 한 줄에 보인다.
  assert.ok(logs.some((l) => l.includes('검증 통과') && l.includes('genia-works--v0.1.78') && l.includes(MARKETPLACE_URL)));
  rmSync(dir, { recursive: true, force: true });
});

test('main: --tag 가 없으면 거부한다', async () => {
  await assert.rejects(main([], { repoRoot: REPO, exec: gitFake(), log: () => {} }), /--tag 가 필요하다/);
});

test('버린 릴리스(WP-454): 기준에서 빠지고, 그 버전 자체는 다시 태그할 수 없다', () => {
  // v0.9.0 태그를 검증하는데 조상에 버린 v0.8.1 이 있으면 기준은 그 아래 v0.8.0
  const exec = gitFake({ merged: ['v0.8.0', 'v0.8.1', 'v0.9.0'], abandoned: { '0.8.1': '빌드 실패' } });
  assert.equal(verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO }).baseTag, 'v0.8.0');
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ abandoned: { '0.9.0': '빌드 실패' } }), repoRoot: REPO }), /버린 릴리스로 적혀 있다/);
});

test('버린 릴리스(WP-454): 그 버전의 노트가 태그 커밋에 남아 있으면 거부', () => {
  const base = gitFake({ merged: ['v0.8.0', 'v0.8.1', 'v0.9.0'], abandoned: { '0.8.1': '빌드 실패' }, leftNotes: ['0.8.1'] });
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: base, repoRoot: REPO }), /releases\/0\.8\.1\.md/);
});

test('marketplace ref 태그가 설치 주소에 없으면 거부하고 올리라 안내한다 (WP-2138)', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ pluginTag: null }), repoRoot: REPO }),
    (e) => new RegExp(`genia-works--v0\\.1\\.78 태그가 설치 주소\\(${MARKETPLACE_URL}\\) 에 없다`).test(e.message) && /먼저/.test(e.message));
});

test('marketplace ref 태그가 설치 주소에 있으면 통과한다 (WP-2138)', () => {
  const r = verifyTag({ tag: 'v0.9.0', exec: gitFake(), repoRoot: REPO });
  assert.equal(r.pluginTag, 'genia-works--v0.1.78');
});

test('ls-remote 는 marketplace source.url 하나만 묻는다 — GitLab origin 을 묻지 않는다 (WP-2138 사고)', () => {
  // 사고: GitLab CI 의 origin 은 gitlab.iacloud.kr 이라 origin 기준 확인은 GitHub 에 없는 태그를 그대로 지나쳤다.
  const exec = gitFake();
  verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO });
  assert.deepEqual(exec.calls.filter((c) => c.startsWith('ls-remote ')), [`ls-remote --tags -- ${MARKETPLACE_URL} refs/tags/genia-works--v0.1.78`]);
});

test('설치 주소에 태그가 없어 거부할 때도 origin 을 대신 물어보지 않는다 (WP-2138 사고)', () => {
  const exec = gitFake({ pluginTag: null });
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO }), /설치 주소/);
  assert.deepEqual(exec.calls.filter((c) => c.startsWith('ls-remote ')), [`ls-remote --tags -- ${MARKETPLACE_URL} refs/tags/genia-works--v0.1.78`]);
});

test('marketplace source.url 이 없으면 확인할 주소가 없으니 거부한다 (WP-2138)', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ marketplace: marketplaceWithRef('genia-works--v0.1.78', null) }), repoRoot: REPO }),
    /source\.url 을 읽지 못했다/);
});

test('marketplace.json 을 태그 커밋에서 못 읽으면 git 오류 원인까지 싣고 거부한다 (WP-2138)', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ marketplace: null }), repoRoot: REPO }),
    (e) => /marketplace\.json/.test(e.message) && /fatal: path/.test(e.message));
});

test('marketplace ref 가 genia-works--v<버전> 모양이 아니면 거부한다 (WP-2138)', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ marketplace: marketplaceWithRef('main') }), repoRoot: REPO }), /genia-works--v<버전>/);
});

test('ls-remote 네트워크 오류는 「태그를 올리세요」 안내로 바꾸지 않고 그대로 흘려보낸다 (WP-2138)', () => {
  assert.throws(() => verifyTag({ tag: 'v0.9.0', exec: gitFake({ lsRemoteThrows: true }), repoRoot: REPO }),
    (e) => /실패/.test(e.message) && !/올리세요/.test(e.message));
});

test('marketplace source.url 이 https:// 로 시작하지 않으면 확인하기 전에 거부한다 (WP-2138 리뷰 후속 ②)', () => {
  for (const url of ['http://github.com/bluleo78/smart-workplace.git', 'git@github.com:bluleo78/smart-workplace.git', '/tmp/registry']) {
    const exec = gitFake({ marketplace: marketplaceWithRef('genia-works--v0.1.78', url) });
    assert.throws(() => verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO }), (e) => /source\.url 이 https:\/\/ 로 시작하지 않는다/.test(e.message) && e.message.includes(url));
    // 원격에 물어보기 전에 멈춘다 — 이상한 값을 가진 채로 네트워크로 나가지 않는다.
    assert.equal(exec.calls.some((c) => c.startsWith('ls-remote ')), false);
  }
});

test('ls-remote 의 url 은 `--` 바로 뒤에 온다 — 옵션으로 읽히지 않는다 (WP-2138 리뷰 후속 ②)', () => {
  const exec = gitFake();
  verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO });
  const [ls] = exec.calls.filter((c) => c.startsWith('ls-remote '));
  assert.equal(ls, `ls-remote --tags -- ${MARKETPLACE_URL} refs/tags/genia-works--v0.1.78`);
  // `--` 가 없으면 가짜 exec 이 예상 못한 호출로 실패한다(위 정규식이 `--` 를 요구).
  assert.equal(ls.split(' ')[3], MARKETPLACE_URL);
});

test('ls-remote 호출에는 시간 제한이 걸리고, 로컬 git 호출에는 걸리지 않는다 (WP-2138 리뷰 후속 ①)', () => {
  const exec = gitFake();
  verifyTag({ tag: 'v0.9.0', exec, repoRoot: REPO });
  const ls = exec.opts.filter((c) => c.line.startsWith('ls-remote '));
  assert.equal(ls.length, 1);
  // 문서·CI 주석이 말하는 값(60초)을 코드가 그대로 받는다 — 값이 줄면 릴리스가 흔들리니 하한도 함께 건다.
  assert.equal(ls[0].opts.timeout, LS_REMOTE_TIMEOUT_MS);
  assert.ok(ls[0].opts.timeout >= 10_000, '설치 주소 확인 시간은 10초 이상이어야 정상 릴리스가 흔들리지 않는다');
  const local = exec.opts.filter((c) => !c.line.startsWith('ls-remote '));
  assert.ok(local.length > 0);
  assert.ok(local.every((c) => c.opts.timeout === undefined));
});

// ---- 실제 git: `--` 를 받아들이는지(설치된 git 버전 회귀) — 가짜 exec 는 인자 모양만 본다 ----
test('실제 git: ls-remote 의 `--` 뒤에 온 주소가 그대로 원격이 되어 태그를 돌려준다 (WP-2138 리뷰 후속 ②)', { timeout: 30000 }, () => {
  const dir = makeTmp('verify-tag-real-git-');
  const src = join(dir, 'src');
  const ref = 'refs/tags/genia-works--v0.1.78';
  const inSrc = (...args) => spawnSync('git', ['-C', src, ...args], { encoding: 'utf8' });
  try {
    mkdirSync(src);
    assert.equal(spawnSync('git', ['init', '--quiet', src], { encoding: 'utf8' }).status, 0);
    assert.equal(inSrc('config', 'user.email', 'test@example.com').status, 0);
    assert.equal(inSrc('config', 'user.name', 'test').status, 0);
    writeFileSync(join(src, 'file.txt'), 'x\n');
    assert.equal(inSrc('add', 'file.txt').status, 0);
    assert.equal(inSrc('commit', '--quiet', '-m', 'init').status, 0);
    assert.equal(inSrc('tag', 'genia-works--v0.1.78').status, 0);
    // 게이트가 실제로 부르는 인자 모양(`--` 포함) — 설치된 git 이 여기서 실패하면 릴리스가 전량 막힌다.
    const r = spawnSync('git', ['ls-remote', '--tags', '--', src, ref], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(ref));
    // `--` 없이 옵션처럼 생긴 주소를 주면 git 이 옵션으로 읽어 실패한다 — `--` 없이는 값을 옵션으로 해석할 수 있다는 뜻.
    const bad = spawnSync('git', ['ls-remote', '--tags', '-c', src, ref], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
